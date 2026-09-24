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
  normalizeContext, deriveView, pageLinks, workerOrigin, createClient, buildStepModel,
} from '../../../../tools/plugins/request-for-publish/workflow.js';

const context = { org: 'example', site: 'website', path: '/drafts/page' };
const pending = {
  path: context.path,
  status: 'pending',
  requester: 'author@example.com',
  created: '2026-01-01T10:00:00Z',
  comment: 'Updated introduction',
};
const oneStep = [{
  index: 1, title: 'Review', description: 'Sign off before publishing.', approvers: ['reviewer@example.com'], cc: [],
}];
const twoSteps = [
  {
    index: 1, title: 'Legal review', description: 'Claims.', approvers: ['legal@example.com'], cc: [],
  },
  {
    index: 2, title: 'Brand review', description: 'Tone.', approvers: ['brand@example.com'], cc: ['watcher@example.com'],
  },
];
const data = (overrides = {}) => ({
  own: [],
  approvable: [],
  page: [],
  approvers: ['reviewer@example.com'],
  cc: [],
  steps: oneStep,
  settings: { commentsRequired: false, commentsMinLength: 1 },
  ...overrides,
});
const last = { step: 1, final: true };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fixture({
  own = [], approvable = [], page = [], fail, publishFail = false,
} = {}) {
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
      if (url.pathname === '/api/approvers') return response({ approvers: ['reviewer@example.com'], cc: [], steps: oneStep });
      if (url.pathname === '/api/requests' && !opts.method) {
        const role = url.searchParams.get('role');
        if (role === 'page') return response({ requests: page });
        return response({ requests: role === 'requester' ? own : approvable });
      }
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
    const legacy = { org: context.org, repo: context.site, path: context.path };
    assert.equal(normalizeContext(legacy).site, context.site);
    assert.equal(normalizeContext({ ...context, path: '/drafts/index' }).path, '/drafts/index');
  });
  it('rejects incomplete, non-page and unsafe context', () => {
    [{}, { ...context, path: '' }, { ...context, path: '/a/../b' }, { ...context, path: '/data.json' }, { ...context, org: 'a/b' }].forEach((ctx) => {
      assert.equal(normalizeContext(ctx), null);
    });
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
  it('opens the inbox on the plugin branch rather than the editor context ref', () => {
    const moduleUrl = 'https://ewws0926--aem-apps--adobe-rnd.aem.page/tools/plugins/request-for-publish/workflow.js';
    const links = pageLinks({
      org: 'scdemos', site: 'benp5', path: '/guided-journey.html', ref: 'main',
    }, undefined, moduleUrl);
    assert.equal(
      links.inbox,
      'https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox?org=scdemos&site=benp5&ref=ewws0926',
    );
    assert.equal(links.myRequests, `${links.inbox}&requester=true`);
    assert.equal(new URL(pageLinks(context, 'ci', moduleUrl).inbox).searchParams.get('env'), 'ci');
  });
  it('omits the inbox ref for main and non-AEM plugin origins', () => {
    [
      'https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/request-for-publish/workflow.js',
      'http://localhost:3000/tools/plugins/request-for-publish/workflow.js',
    ].forEach((moduleUrl) => {
      const links = pageLinks({ ...context, ref: 'other-branch' }, undefined, moduleUrl);
      assert.equal(new URL(links.inbox).searchParams.has('ref'), false);
      assert.equal(new URL(links.myRequests).searchParams.has('ref'), false);
    });
  });
  it('uses only explicit known worker environments', () => {
    assert.match(workerOrigin(new URL('http://localhost:3000/')), /localhost:8787/);
    assert.match(workerOrigin(new URL('http://localhost:3000/?env=ci')), /publish-requests-ci/);
    assert.equal(workerOrigin(new URL('http://localhost:3000/?env=prod')), 'https://publish-requests.aem-poc-lab.workers.dev');
    assert.throws(() => workerOrigin(new URL('https://example.com/?env=unknown')), /environment/i);
  });
});

describe('approval steps', () => {
  it('marks the first step current and the rest upcoming for a fresh request', () => {
    const model = buildStepModel(twoSteps, '');
    assert.deepEqual(model.steps.map((step) => step.state), ['current', 'upcoming']);
    assert.equal(model.current, 1);
    assert.equal(model.complete, false);
  });
  it('advances past an approved step and records who approved it and when', () => {
    const model = buildStepModel(twoSteps, 'legal@example.com:1:2026-01-02T09:30:00Z');
    assert.deepEqual(model.steps.map((step) => step.state), ['approved', 'current']);
    assert.equal(model.steps[0].approvedBy, 'legal@example.com');
    assert.equal(model.steps[0].approvedAt, '2026-01-02T09:30:00Z');
    assert.equal(model.current, 2);
  });
  it('reports completion once the last step is approved', () => {
    const model = buildStepModel(twoSteps, 'legal@example.com:1:T, brand@example.com:2:T');
    assert.equal(model.complete, true);
    assert.equal(model.current, 3);
  });
  it('skips a step with no approvers instead of deadlocking', () => {
    const unstaffed = {
      index: 2, title: 'Unstaffed', approvers: [], cc: [],
    };
    const gapped = [twoSteps[0], unstaffed, { ...twoSteps[1], index: 3 }];
    const model = buildStepModel(gapped, 'legal@example.com:1:T');
    assert.deepEqual(model.steps.map((step) => step.state), ['approved', 'skipped', 'current']);
    assert.equal(model.current, 3);
  });
  it('collapses duplicate approvals of one step rather than skipping the next', () => {
    const model = buildStepModel(twoSteps, 'legal@example.com:1:T, other@example.com:1:T');
    assert.equal(model.current, 2);
  });
  it('falls back to a generic title and tolerates a malformed log', () => {
    const model = buildStepModel([{ index: 1, approvers: ['a@example.com'], cc: [] }], 'garbage, :2:, a@example.com');
    assert.equal(model.steps[0].title, 'Step 1');
    assert.equal(model.current, 1);
  });
  it('marks a lone unlabelled step as bare so no stepper is shown', () => {
    assert.equal(buildStepModel([{ index: 1, approvers: ['a@example.com'], cc: [] }], '').bare, true);
    assert.equal(buildStepModel(oneStep, '').bare, false);
    assert.equal(buildStepModel(twoSteps, '').bare, false);
  });
  it('reports the last approvable step, ignoring an unstaffed tail', () => {
    const trailing = [
      twoSteps[0],
      { ...twoSteps[1], index: 2 },
      {
        index: 3, title: 'Empty', approvers: [], cc: [],
      },
      {
        index: 4, title: 'Also empty', approvers: [], cc: [],
      },
    ];
    assert.equal(buildStepModel(trailing, '').lastStaffed, 2);
    assert.equal(buildStepModel(twoSteps, '').lastStaffed, 2);
    assert.equal(buildStepModel([], '').lastStaffed, 0);
  });
  it('treats an untitled step as bare even when it carries a description', () => {
    const untitled = [{
      index: 1, title: '', description: 'Sign off.', approvers: ['a@example.com'], cc: [],
    }];
    assert.equal(buildStepModel(untitled, '').bare, true);
  });
  it('derives the current step for the view and defers approver eligibility to the worker', () => {
    const advanced = { ...pending, step: 'legal@example.com:1:T' };
    const view = deriveView(context, data({ steps: twoSteps, approvable: [advanced] }));
    assert.equal(view.current, 2);
    assert.equal(view.count, 2);
    assert.equal(view.canApprove, true);
    const blocked = { ...advanced, canApproveNow: false };
    const later = deriveView(context, data({ steps: twoSteps, approvable: [blocked] }));
    assert.equal(later.canApprove, false);
  });
  it('treats an advanced step log as a different request', () => {
    const view = deriveView(context, data({ steps: twoSteps, approvable: [{ ...pending, step: 'legal@example.com:1:T' }], own: [pending] }));
    assert.equal(view.view, 'blocked');
  });
});

describe('uninvolved viewers', () => {
  it('shows a read-only stepper instead of an initiation form', () => {
    const view = deriveView(context, data({ page: [pending] }));
    assert.equal(view.view, 'observer');
    assert.equal(view.canApprove, false);
    assert.equal(view.canWithdraw, false);
    assert.deepEqual(view.request, pending);
  });
  it('still derives the current step for an uninvolved viewer', () => {
    const advanced = { ...pending, step: 'legal@example.com:1:T' };
    const view = deriveView(context, data({ steps: twoSteps, page: [advanced] }));
    assert.equal(view.current, 2);
    assert.deepEqual(view.steps.map((step) => step.state), ['approved', 'current']);
  });
  it('prefers the role queues so participants keep their actions', () => {
    const asOwner = deriveView(context, data({ own: [pending], page: [pending] }));
    assert.equal(asOwner.view, 'requester');
    assert.equal(asOwner.canWithdraw, true);
    const asApprover = deriveView(context, data({ approvable: [pending], page: [pending] }));
    assert.equal(asApprover.view, 'approver');
    assert.equal(asApprover.canApprove, true);
  });
  it('offers initiation only when no request exists for the page', () => {
    assert.equal(deriveView(context, data()).view, 'request');
  });
  it('blocks on duplicate page records', () => {
    const view = deriveView(context, data({ page: [pending, { ...pending, requester: 'other@example.com' }] }));
    assert.equal(view.view, 'blocked');
  });
  it('reads the page queue without a role filter', async () => {
    const { client, calls } = fixture({ page: [pending] });
    const loaded = await client.load(context);
    assert.deepEqual(loaded.page, [pending]);
    const pageCall = calls.find((call) => call.role === 'page');
    assert.ok(pageCall, 'no page-scoped read issued');
  });
});

describe('workflow operations', () => {
  it('loads both role queues and server-resolved recipients', async () => {
    const { client, calls } = fixture({ own: [pending] });
    const loaded = await client.load(context);
    assert.equal(loaded.own[0].requester, pending.requester);
    assert.deepEqual(loaded.approvers, ['reviewer@example.com']);
    // requester, approver and page-scoped reads
    assert.equal(calls.filter((call) => call.path === '/api/requests').length, 3);
  });
  it('reads the site theme from the settings tab and leaves it empty when unset', async () => {
    const themed = fixture({
      fail: (url) => url.pathname === '/api/config' && response({
        config: {
          'publish-workflow-settings': {
            data: [
              { key: 'theme.accent-color', value: '#903' },
              { key: 'theme.accent-color-hover', value: '#730026' },
            ],
          },
        },
      }),
    });
    const { settings } = await themed.client.load(context);
    assert.equal(settings.accentColor, '#903');
    assert.equal(settings.accentColorHover, '#730026');
    const plain = await fixture().client.load(context);
    assert.equal(plain.settings.accentColor, '');
    assert.equal(plain.settings.accentColorHover, '');
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
    await client.approve(context, pending, last);
    assert.deepEqual(calls.map((call) => call.path), ['/api/requests', 'publish', '/api/requests/approve']);
    assert.equal(calls[2].body.step, 1);
  });
  it('does not publish a replaced or missing request', async () => {
    const { client, calls } = fixture({ approvable: [{ ...pending, created: '2026-02-01T10:00:00Z' }] });
    await assert.rejects(client.approve(context, pending, last), /changed|pending/i);
    assert.equal(calls.some((call) => call.path === 'publish'), false);
  });
  it('does not record approval after publishing fails', async () => {
    const { client, calls } = fixture({ approvable: [pending], publishFail: true });
    await assert.rejects(client.approve(context, pending, last), /publish/i);
    assert.equal(calls.some((call) => call.path.endsWith('/approve')), false);
  });
  it('keeps known publication success when recording fails', async () => {
    const { client } = fixture({ approvable: [pending], fail: (url) => url.pathname.endsWith('/approve') && response({ error: 'Email failed' }, 400) });
    await assert.rejects(client.approve(context, pending, last), (error) => error.published === true && /Email failed/.test(error.message));
  });
  it('checks per-path approval results even on HTTP 200', async () => {
    const { client } = fixture({ approvable: [pending], fail: (url) => url.pathname.endsWith('/approve') && response({ approved: [], unauthorized: [context.path], notFound: [] }) });
    await assert.rejects(client.approve(context, pending, last), (error) => error.published === true && /record|authoriz/i.test(error.message));
  });
  it('marks a failed publish response as an unknown publication outcome', async () => {
    const { client } = fixture({ approvable: [pending], publishFail: true });
    await assert.rejects(
      client.approve(context, pending, last),
      (error) => error.publishUnknown === true,
    );
  });
  it('approves an intermediate step without publishing', async () => {
    const { client, calls } = fixture({ approvable: [pending] });
    await client.approve(context, pending, { step: 1, final: false });
    assert.deepEqual(calls.map((call) => call.path), ['/api/requests', '/api/requests/approve']);
    assert.equal(calls[1].body.step, 1);
  });
  it('does not claim publication when an intermediate step fails to record', async () => {
    const { client } = fixture({ approvable: [pending], fail: (url) => url.pathname.endsWith('/approve') && response({ error: 'Email failed' }, 400) });
    const stepOnly = { step: 1, final: false };
    await assert.rejects(client.approve(context, pending, stepOnly), (e) => e.published === false);
  });
  it('reports a step the worker considers already advanced', async () => {
    const stale = {
      approved: [], notFound: [], unauthorized: [], stale: [context.path],
    };
    const { client } = fixture({ approvable: [pending], fail: (url) => url.pathname.endsWith('/approve') && response(stale) });
    await assert.rejects(client.approve(context, pending, last), /advanced|refresh/i);
  });

  it('retries completion without publishing a second time', async () => {
    const { client, calls } = fixture({ approvable: [pending] });
    await client.complete(context, pending, { step: 1 });
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
