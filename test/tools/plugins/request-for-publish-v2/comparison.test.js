/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as workflow from '../../../../tools/plugins/request-for-publish-v2/workflow.js';

describe('native workspace comparison adapter', () => {
  it('dispatches synchronous undefined review actions without capability declarations', async () => {
    const calls = [];
    const workspace = workflow.createWorkspaceActions({
      actions: {
        openComparison: (options) => { calls.push(options); },
        saveDocument: () => { throw new Error('Read-only review must not save'); },
      },
    });
    assert.equal(workspace.canCompare, true);
    assert.equal(await workspace.review('request'), undefined);
    assert.equal(await workspace.review('approver'), undefined);
    assert.equal(await workspace.review('requester'), undefined);
    assert.deepEqual(calls, [
      { candidate: 'document', baseline: 'live' },
      { candidate: 'preview', baseline: 'live' },
      { candidate: 'document', baseline: 'live' },
    ]);
  });

  it('does not wait for or validate a comparison reply', async () => {
    const workspace = workflow.createWorkspaceActions({
      actions: { openComparison: () => new Promise(() => {}) },
    });
    assert.equal(await workspace.review('request'), undefined);
  });

  it('detects only missing SDK methods, without claiming host support', async () => {
    const workspace = workflow.createWorkspaceActions();
    assert.equal(workspace.canCompare, false);
    await assert.rejects(workspace.review('request'), /editor could not complete/i);
    assert.equal(await workspace.close(), undefined);
    const present = workflow.createWorkspaceActions({ actions: { openComparison: () => {} } });
    assert.equal(present.canCompare, true);
  });

  it('dispatches synchronous undefined close actions with safe catch callers', async () => {
    let closed = 0;
    const workspace = workflow.createWorkspaceActions({
      actions: { closeComparison: () => { closed += 1; } },
    });
    const result = workspace.close();
    assert.equal(typeof result.catch, 'function');
    assert.equal(await result, undefined);
    assert.equal(closed, 1);
  });

  it('reports synchronous dispatch errors through the async adapter', async () => {
    const workspace = workflow.createWorkspaceActions({
      actions: {
        openComparison: () => { throw new Error('Open dispatch failed'); },
        closeComparison: () => { throw new Error('Close dispatch failed'); },
      },
    });
    await assert.rejects(workspace.review('request'), /Open dispatch failed/);
    await assert.rejects(workspace.close(), /Close dispatch failed/);
  });

  it('requires a confirmed save independently of comparison method presence', async () => {
    let saved = 0;
    const workspace = workflow.createWorkspaceActions({
      actions: { saveDocument: async () => { saved += 1; return { ok: true }; } },
    });
    assert.deepEqual(await workspace.save(), { ok: true });
    assert.equal(saved, 1);
    await assert.rejects(workflow.createWorkspaceActions().save(), /editor could not complete/i);
    const compareOnly = workflow.createWorkspaceActions({ actions: { openComparison: () => {} } });
    await assert.rejects(compareOnly.save(), /editor could not complete/i);
  });

  it('rejects failed, missing and invalid save replies', async () => {
    const failed = workflow.createWorkspaceActions({
      actions: { saveDocument: async () => ({ ok: false, error: 'save-failed' }) },
    });
    await assert.rejects(failed.save(), /save-failed/);
    await Promise.all([undefined, null, {}, { ok: 'true' }, { ok: 1 }].map(async (reply) => {
      const workspace = workflow.createWorkspaceActions({
        actions: { saveDocument: async () => reply },
      });
      await assert.rejects(workspace.save(), /unavailable/);
    }));
  });

  it('does not retain capability declarations or an external comparator fallback', async () => {
    const paths = ['request-for-publish.js', 'workflow.js', 'panel.js'];
    const sources = await Promise.all(paths.map((path) => readFile(new URL(`../../../../tools/plugins/request-for-publish-v2/${path}`, import.meta.url), 'utf8')));
    sources.forEach((source) => {
      assert.doesNotMatch(source, /capabilities|tools\.aem\.live|links\.diff/);
    });
    assert.equal(Object.hasOwn(workflow.pageLinks({ org: 'example', site: 'site', path: '/page' }), 'diff'), false);
  });
});

describe('save before preview sequencing', () => {
  const context = { org: 'example', site: 'site', path: '/page' };
  it('waits for editor confirmation before preview and request even without review', async () => {
    const calls = [];
    let confirmSave;
    const workspace = workflow.createWorkspaceActions({
      actions: {
        saveDocument: () => {
          calls.push('save');
          return new Promise((resolve) => { confirmSave = resolve; });
        },
        openComparison: () => { throw new Error('Submission must not open review'); },
      },
    });
    const phases = [];
    const client = workflow.createClient({
      base: 'https://workflow.example',
      beforePreview: () => workspace.save(),
      preview: async () => { calls.push('preview'); return new Response(''); },
      request: async () => { calls.push('submit'); return new Response('{}'); },
    });
    const submitting = client.submit(context, 'note', (phase) => phases.push(phase));
    await Promise.resolve();
    assert.deepEqual(calls, ['save']);
    confirmSave({ ok: true });
    await submitting;
    assert.deepEqual(calls, ['save', 'preview', 'submit']);
    assert.deepEqual(phases, ['Saving current edits…', 'Updating preview…', 'Sending request…']);
  });

  it('blocks preview and submission when the SDK save method is missing', async () => {
    let calls = 0;
    const client = workflow.createClient({
      base: 'https://workflow.example',
      beforePreview: () => workflow.createWorkspaceActions().save(),
      preview: async () => { calls += 1; return new Response(''); },
      request: async () => { calls += 1; return new Response('{}'); },
    });
    await assert.rejects(client.submit(context, 'note'), /editor could not complete/i);
    assert.equal(calls, 0);
  });

  it('blocks preview and submission for failed or invalid save confirmations', async () => {
    await Promise.all([undefined, null, {}, { ok: false, error: 'save-failed' }].map(async (reply) => {
      let calls = 0;
      const workspace = workflow.createWorkspaceActions({
        actions: { saveDocument: async () => reply },
      });
      const client = workflow.createClient({
        base: 'https://workflow.example',
        beforePreview: () => workspace.save(),
        preview: async () => { calls += 1; return new Response(''); },
        request: async () => { calls += 1; return new Response('{}'); },
      });
      await assert.rejects(client.submit(context, 'note'));
      assert.equal(calls, 0);
    }));
  });

  it('blocks preview and submission after a rejected save', async () => {
    let calls = 0;
    const client = workflow.createClient({
      base: 'https://workflow.example',
      beforePreview: async () => { throw new Error('Save not confirmed'); },
      preview: async () => { calls += 1; return new Response(''); },
      request: async () => { calls += 1; return new Response('{}'); },
    });
    await assert.rejects(client.submit(context, 'note'), /Save not confirmed/);
    assert.equal(calls, 0);
  });

  it('fails closed when the client is missing a save gate or its confirmation', async () => {
    await Promise.all([undefined, async () => undefined].map(async (beforePreview) => {
      let calls = 0;
      const client = workflow.createClient({
        base: 'https://workflow.example',
        beforePreview,
        preview: async () => { calls += 1; return new Response(''); },
        request: async () => { calls += 1; return new Response('{}'); },
      });
      await assert.rejects(client.submit(context, 'note'), /sav/i);
      assert.equal(calls, 0);
    }));
  });

  it('approves without saving or previewing for both intermediate and final steps', async () => {
    const pending = { path: context.path, status: 'pending', requester: 'author@example.com' };
    await Promise.all([false, true].map(async (final) => {
      const calls = [];
      const client = workflow.createClient({
        base: 'https://workflow.example',
        beforePreview: async () => { throw new Error('Approval must not save'); },
        preview: async () => { throw new Error('Approval must not preview'); },
        publish: async () => { calls.push('publish'); return new Response(''); },
        request: async (href) => {
          const route = new URL(href).pathname;
          calls.push(route);
          return new Response(JSON.stringify(route.endsWith('/approve')
            ? { approved: [context.path] } : { requests: [pending] }));
        },
      });
      await client.approve(context, pending, { step: 1, final });
      assert.deepEqual(calls, final
        ? ['/api/v2/requests', 'publish', '/api/v2/requests/approve']
        : ['/api/v2/requests', '/api/v2/requests/approve']);
    }));
  });
});
