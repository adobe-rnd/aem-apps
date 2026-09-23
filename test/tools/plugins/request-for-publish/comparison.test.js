import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    await assert.rejects(workspace.review('request'), /support/i);
    assert.equal(called, false);
  });

  it('surfaces host failures and refuses unsupported save handshakes', async () => {
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
    await assert.rejects(workflow.createWorkspaceActions().save(), /support/i);
  });

  it('removes the external comparison URL instead of retaining a tools fallback', () => {
    const links = workflow.pageLinks({ org: 'example', site: 'site', path: '/page' });
    assert.equal(links.diff, undefined);
    assert.equal(JSON.stringify(links).includes('tools.aem.live'), false);
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
});
