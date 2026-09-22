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
import {
  normalizeContext, deriveView, pageLinks, workerOrigin, createClient,
} from '../../../../tools/plugins/request-for-publish/workflow.js';

const context = { org: 'example', site: 'website', path: '/drafts/page' };
const pending = {
  path: context.path, status: 'pending', requester: 'author@example.com',
  created: '2026-01-01T10:00:00Z', comment: 'Updated introduction',
};
const data = (overrides = {}) => ({
  own: [], approvable: [], approvers: ['reviewer@example.com'], cc: [],
  settings: { commentsRequired: false, commentsMinLength: 1 }, ...overrides,
});
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fixture({ own = [], approvable = [], fail, publishFail = false } = {}) {
  const calls = [];
  const client = createClient({
    base: 'https://workflow.example',
    request: async (href, opts = {}) => {
      const url = new URL(href);
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ path: url.pathname, role: url.searchParams.get('role'), body });
      if (fail) {
        const failed = fail(url, opts);
        if (failed) return failed;
      }
      if (url.pathname === '/api/config') return response({ config: { 'publish-workflow-settings': { data: [] } } });
      if (url.pathname === '/api/approvers') return response({ approvers: ['reviewer@example.com'], cc: [] });
      if (url.pathname === '/api/requests' && !opts.method) return response({ requests: url.searchParams.get('role') === 'requester' ? own : approvable });
      if (url.pathname.endsWith('/approve')) return response({ approved: [context.path], notFound: [], unauthorized: [] });
      return response({ success: true, notifiedApprovers: ['reviewer@example.com'] });
    },
    preview: async () => { calls.push({ path: 'preview' }); return response({}, publishFail ? 500 : 200); },
    publish: async () => { calls.push({ path: 'publish' }); return response({}, publishFail ? 500 : 200); },
  });
  return { client, calls };
}

describe('context-derived views', () => {
  it('accepts both EW site and legacy repo context, without changing the request path', () => {
    assert.deepEqual(normalizeContext({ ...context, ref: 'feature' }), { ...context, ref: 'feature' });
    assert.equal(normalizeContext({ org: context.org, repo: context.site, path: context.path }).site, context.site);
    assert.equal(normalizeContext({ ...context, path: '/drafts/index' }).path, '/drafts/index');
  });
  it('rejects incomplete, non-page and unsafe context', () => {
    for (const ctx of [{}, { ...context, path: '' }, { ...context, path: '/a/../b' }, { ...context, path: '/data.json' }, { ...context, org: 'a/b' }]) {
      assert.equal(normalizeContext(ctx), null);
    }
  });
  it('derives initiation only after loaded data and a matching rule', () => {
    assert.equal(deriveView(context, undefined).view, 'loading');
    assert.equal(deriveView(context, data()).view, 'request');
    assert.equal(deriveView(context, data({ approvers: [] })).view, 'blocked');
  });
  it('derives requester state from the worker own queue', () => {
    const view = deriveView(context, data({ own: [pending] }));
    assert.equal(view.view, 'requester');
    assert.equal(view.canWithdraw, true);
    assert.equal(view.canApprove, false);
    assert.deepEqual(view.request, pending);
  });
  it('derives approver state from the worker approvable queue, not a client email guess', () => {
    const view = deriveView(context, data({ approvable: [pending] }));
    assert.equal(view.view, 'approver');
    assert.equal(view.canWithdraw, false);
    assert.equal(view.canApprove, true);
  });
  it('handles overlapping roles without a role selector', () => {
    const view = deriveView(context, data({ own: [pending], approvable: [pending] }));
    assert.equal(view.view, 'approver');
    assert.equal(view.canWithdraw, true);
    assert.equal(view.canApprove, true);
  });
  it('does not treat requests on another page as this page', () => {
    assert.equal(deriveView(context, data({ own: [{ ...pending, path: '/other' }] })).view, 'request');
  });
  it('blocks anomalous duplicate rows rather than offering path-wide mutations', () => {
    const view = deriveView(context, data({ approvable: [pending, { ...pending, requester: 'other@example.com' }] }));
    assert.equal(view.view, 'blocked');
    assert.equal(view.canApprove, false);
  });
  it('preserves index identity but derives correct delivery and diff links', () => {
    const links = pageLinks({ ...context, path: '/drafts/index' });
    assert.equal(links.preview, 'https://main--website--example.aem.page/drafts/');
    assert.equal(new URL(links.diff).searchParams.get('path'), '/drafts/index');
    assert.equal(new URL(links.myRequests).searchParams.get('requester'), 'true');
  });
  it('uses only explicit known worker environments', () => {
    assert.match(workerOrigin(new URL('http://localhost:3000/')), /localhost:8787/);
    assert.match(workerOrigin(new URL('http://localhost:3000/?env=ci')), /publish-requests-ci/);
    assert.equal(workerOrigin(new URL('http://localhost:3000/?env=prod')), 'https://publish-requests.aem-poc-lab.workers.dev');
    assert.throws(() => workerOrigin(new URL('https://example.com/?env=unknown')), /environment/i);
  });
});

describe('workflow operations', () => {
  it('loads both role queues and server-resolved recipients', async () => {
    const { client, calls } = fixture({ own: [pending] });
    const loaded = await client.load(context);
    assert.equal(loaded.own[0].requester, pending.requester);
    assert.deepEqual(loaded.approvers, ['reviewer@example.com']);
    assert.equal(calls.filter((call) => call.path === '/api/requests').length, 2);
  });
  it('does not convert failed reads to an empty queue', async () => {
    const { client } = fixture({ fail: (url) => url.pathname === '/api/requests' && response({ error: 'Session expired' }, 401) });
    await assert.rejects(client.load(context), (error) => error.status === 401 && /Session expired/.test(error.message));
  });
  it('rejects a malformed successful queue response', async () => {
    const { client } = fixture({ fail: (url) => url.pathname === '/api/requests' && response({}) });
    await assert.rejects(client.load(context), /request list/i);
  });
  it('does not submit if preview fails', async () => {
    const { client, calls } = fixture({ publishFail: true });
    await assert.rejects(client.submit(context, 'A note'), /preview/i);
    assert.deepEqual(calls.map((call) => call.path), ['preview']);
  });
  it('previews before submission and sends no client-selected identity or approvers', async () => {
    const { client, calls } = fixture();
    await client.submit(context, 'A note');
    assert.deepEqual(calls.map((call) => call.path), ['preview', '/api/requests']);
    assert.deepEqual(calls[1].body, { ...context, comment: 'A note' });
  });
  it('revalidates before publishing and records only after success', async () => {
    const { client, calls } = fixture({ approvable: [pending] });
    await client.approve(context, pending);
    assert.deepEqual(calls.map((call) => call.path), ['/api/requests', 'publish', '/api/requests/approve']);
  });
  it('does not publish a replaced or missing request', async () => {
    const { client, calls } = fixture({ approvable: [{ ...pending, created: '2026-02-01T10:00:00Z' }] });
    await assert.rejects(client.approve(context, pending), /changed|pending/i);
    assert.equal(calls.some((call) => call.path === 'publish'), false);
  });
  it('does not record approval after publishing fails', async () => {
    const { client, calls } = fixture({ approvable: [pending], publishFail: true });
    await assert.rejects(client.approve(context, pending), /publish/i);
    assert.equal(calls.some((call) => call.path.endsWith('/approve')), false);
  });
  it('keeps known publication success when recording fails', async () => {
    const { client } = fixture({ approvable: [pending], fail: (url) => url.pathname.endsWith('/approve') && response({ error: 'Email failed' }, 400) });
    await assert.rejects(client.approve(context, pending), (error) => error.published === true && /Email failed/.test(error.message));
  });
  it('checks per-path approval results even on HTTP 200', async () => {
    const { client } = fixture({ approvable: [pending], fail: (url) => url.pathname.endsWith('/approve') && response({ approved: [], unauthorized: [context.path], notFound: [] }) });
    await assert.rejects(client.approve(context, pending), (error) => error.published === true && /record|authoriz/i.test(error.message));
  });
  it('retries completion without publishing a second time', async () => {
    const { client, calls } = fixture({ approvable: [pending] });
    await client.complete(context, pending);
    assert.deepEqual(calls.map((call) => call.path), ['/api/requests', '/api/requests/approve']);
  });
  it('rejects empty reasons without a network request', async () => {
    const { client, calls } = fixture({ approvable: [pending] });
    await assert.rejects(client.reject(context, pending, '  '), /reason/i);
    assert.equal(calls.length, 0);
  });
  it('does not report a no-op rejection as success', async () => {
    const { client } = fixture({ approvable: [pending], fail: (url) => url.pathname.endsWith('/reject') && response({ success: false }) });
    await assert.rejects(client.reject(context, pending, 'Please fix'), /pending|changed/i);
  });
  it('only resends a current own request and preserves its original note', async () => {
    const { client, calls } = fixture({ own: [pending] });
    await client.resend(context, pending);
    assert.equal(calls[0].role, 'requester');
    assert.deepEqual(calls[1].body, { ...context, resend: true, comment: pending.comment });
  });
  it('does not withdraw a request no longer in the own queue', async () => {
    const { client, calls } = fixture();
    await assert.rejects(client.withdraw(context, pending), /pending|changed/i);
    assert.equal(calls.length, 1);
  });
});
