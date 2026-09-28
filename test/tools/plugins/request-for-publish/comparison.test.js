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
import * as workflow from '../../../../tools/plugins/request-for-publish/workflow.js';

describe('native workspace comparison adapter', () => {
  it('selects document/live for authors before and after submission, preview/live for approvers', async () => {
    assert.equal(typeof workflow.createWorkspaceActions, 'function');
    const calls = [];
    const workspace = workflow.createWorkspaceActions({
      capabilities: { comparison: 1 },
      actions: { openComparison: async (options) => { calls.push(options); return { ok: true }; } },
    });
    await workspace.review('request');
    await workspace.review('approver');
    await workspace.review('requester');
    assert.deepEqual(calls, [
      { candidate: 'document', baseline: 'live' },
      { candidate: 'preview', baseline: 'live' },
      { candidate: 'document', baseline: 'live' },
    ]);
  });

  it('does not confuse SDK method presence with host support', async () => {
    assert.equal(typeof workflow.createWorkspaceActions, 'function');
    let called = false;
    const workspace = workflow.createWorkspaceActions({
      actions: { openComparison: async () => { called = true; } },
    });
    assert.equal(workspace.canCompare, false);
    await assert.rejects(workspace.review('request'), { message: 'The editor could not complete this action.' });
    assert.equal(called, false);
  });

  it('surfaces host failures and refuses a comparison host without a save handshake', async () => {
    assert.equal(typeof workflow.createWorkspaceActions, 'function');
    const workspace = workflow.createWorkspaceActions({
      capabilities: { comparison: 1, saveDocument: 1 },
      actions: {
        openComparison: async () => ({ ok: false, error: 'stale-context' }),
        saveDocument: async () => ({ ok: false, error: 'save-failed' }),
      },
    });
    await assert.rejects(workspace.review('request'), /stale-context/);
    await assert.rejects(workspace.save(), /save-failed/);
    const compareOnly = workflow.createWorkspaceActions({
      capabilities: { comparison: 1 },
      actions: { openComparison: async () => ({ ok: true }) },
    });
    await assert.rejects(compareOnly.save(), { message: 'The editor could not complete this action.' });
  });

  it('skips the save handshake on hosts without native comparison or save support', async () => {
    let called = false;
    const workspace = workflow.createWorkspaceActions({
      actions: { saveDocument: async () => { called = true; return { ok: true }; } },
    });
    await workspace.save();
    await workflow.createWorkspaceActions().save();
    assert.equal(called, false);
  });

  it('does not include host rollout guidance in the panel', async () => {
    const panel = await readFile(new URL('../../../../tools/plugins/request-for-publish/panel.js', import.meta.url), 'utf8');
    assert.doesNotMatch(panel, /Native comparison is not available|updated Experience Workspace/);
  });

  it('links the Page Status preview/live comparison for the delivered page path', () => {
    const links = workflow.pageLinks({ org: 'example', site: 'site', path: '/drafts/page.html' });
    const diff = new URL(links.diff);
    assert.equal(`${diff.origin}${diff.pathname}`, 'https://tools.aem.live/tools/page-status/diff.html');
    assert.deepEqual(Object.fromEntries(diff.searchParams), { org: 'example', site: 'site', path: '/drafts/page' });
  });
});

describe('save before preview sequencing', () => {
  const context = { org: 'example', site: 'site', path: '/page' };
  it('waits for the editor save, then previews, then submits', async () => {
    const calls = [];
    const client = workflow.createClient({
      base: 'https://workflow.example',
      beforePreview: async () => { calls.push('save'); },
      preview: async () => { calls.push('preview'); return new Response(''); },
      request: async () => { calls.push('submit'); return new Response('{}'); },
    });
    await client.submit(context, 'note');
    assert.deepEqual(calls, ['save', 'preview', 'submit']);
  });

  it('does not preview or submit when save confirmation fails', async () => {
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

  it('previews and submits on a host that cannot save', async () => {
    const calls = [];
    const client = workflow.createClient({
      base: 'https://workflow.example',
      beforePreview: () => workflow.createWorkspaceActions().save(),
      preview: async () => { calls.push('preview'); return new Response(''); },
      request: async () => { calls.push('submit'); return new Response('{}'); },
    });
    await client.submit(context, 'note');
    assert.deepEqual(calls, ['preview', 'submit']);
  });
});
