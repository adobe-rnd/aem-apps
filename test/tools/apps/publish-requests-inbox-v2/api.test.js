/* eslint-disable no-underscore-dangle */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as api from '../../../../tools/apps/publish-requests-inbox-v2/api.js';

const source = readFileSync(new URL('../../../../tools/apps/publish-requests-inbox-v2/publish-requests-inbox.js', import.meta.url), 'utf8');

function fixture(overrides = {}) {
  const scope = {
    ...api,
    LitElement: class { requestUpdate() { return this; } },
    URL,
    URLSearchParams,
    window: { location: { search: '', pathname: '/inbox' } },
    console,
    html: (strings, ...values) => strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, ''),
    nothing: '',
    ...overrides,
  };
  const start = source.indexOf('class PublishRequestsApp');
  const end = source.indexOf("customElements.define('publish-requests-app'");
  const App = vm.runInNewContext(`${source.slice(start, end)}; PublishRequestsApp`, scope);
  const app = new App();
  Object.assign(app, {
    _org: 'example', _site: 'website', _path: '/page', token: 'token',
  });
  return app;
}

describe('inbox v2 API', () => {
  it('can load approval helpers without loading the browser SDK', () => {
    assert.equal(typeof api.isFinalStep, 'function');
    assert.equal(typeof api.approveRequests, 'function');
  });

  it('distinguishes intermediate and final staffed steps', () => {
    assert.equal(api.isFinalStep({ stepInfo: { current: 1, lastStaffed: 2 } }), false);
    assert.equal(api.isFinalStep({
      isFinal: true, stepInfo: { current: 2, lastStaffed: 2 },
    }), true);
    assert.equal(api.isFinalStep({ stepInfo: { current: 1, lastStaffed: null } }), false);
  });

  it('fails closed without explicit worker finality or a current step', () => {
    [undefined, {}, { isFinal: true },
      { stepInfo: { current: 2, lastStaffed: 2 } },
      { stepInfo: { current: 3, lastStaffed: 2 } },
      { isFinal: true, stepInfo: { current: 3, lastStaffed: 2, complete: true } },
      { isFinal: false, stepInfo: { current: 2, lastStaffed: 2 } },
    ].forEach((row) => assert.equal(api.isFinalStep(row), false));
    assert.equal(api.isFinalStep({
      isFinal: true, stepInfo: { current: 1, lastStaffed: 2 },
    }), true);
  });

  it('preserves per-path worker outcomes including partial stale results', async (test) => {
    test.mock.method(global, 'fetch', async () => Response.json({
      approved: ['/page'],
      completed: [],
      advanced: [{ path: '/page', step: 2 }],
      stale: ['/stale'],
      unauthorized: ['/denied'],
      notFound: ['/gone'],
    }));
    global.window = { location: { hostname: 'localhost', search: '' } };
    test.after(() => { delete global.window; });
    const result = await api.approveRequests('example', 'website', ['/page', '/stale'], 'token', 1);
    assert.deepEqual(result.approved, ['/page']);
    assert.deepEqual(result.stale, ['/stale']);
    assert.deepEqual(result.advanced, [{ path: '/page', step: 2 }]);
    assert.deepEqual(result.unauthorized, ['/denied']);
    assert.deepEqual(result.notFound, ['/gone']);
  });
});

describe('inbox v2 approval handlers', () => {
  const finalRow = {
    path: '/page',
    isFinal: true,
    canApproveNow: true,
    stepInfo: { current: 1, lastStaffed: 1 },
  };

  it('replaces spoofed review metadata with worker data and a canonical preview', async () => {
    const app = fixture({
      checkPublishRequest: async () => ({
        ...finalRow, requester: 'author@example.com', comment: 'Actual request note',
      }),
    });
    app._authorEmail = 'ceo@attacker.example';
    app._comment = 'Approved by legal';
    app._previewUrl = ['javascript', 'alert(1)'].join(':');
    await app.initReview();
    assert.equal(app._authorEmail, 'author@example.com');
    assert.equal(app._comment, 'Actual request note');
    assert.equal(app._previewUrl, 'https://main--website--example.aem.page/page');
  });

  it('preserves env and ref across links and inline navigation', () => {
    const browser = {
      location: { search: '?env=ci&ref=rpfix&path=/old', pathname: '/inbox' },
      history: {
        replaceState: (_data, _unused, href) => {
          browser.location.search = new URL(href, 'https://example.com').search;
        },
      },
    };
    const app = fixture({ window: browser });
    app.context = { org: 'adobe-rnd', repo: 'aem-apps' };
    [app.getReviewUrl({ path: '/page' }), app.getInboxUrl()].forEach((href) => {
      const url = new URL(href);
      assert.equal(url.searchParams.get('env'), 'ci');
      assert.equal(url.searchParams.get('ref'), 'rpfix');
    });
    app.updateUrl({ org: 'other', site: 'another' });
    const params = new URLSearchParams(browser.location.search);
    assert.equal(params.get('env'), 'ci');
    assert.equal(params.get('ref'), 'rpfix');
    assert.equal(params.has('path'), false);
  });

  it('revalidates a final request before publishing', async () => {
    const calls = [];
    const app = fixture({
      checkPublishRequest: async () => { calls.push('read'); return null; },
      publishContent: async () => { calls.push('publish'); return { success: true }; },
      approveRequests: async () => ({ success: true, completed: ['/page'] }),
    });
    app._reviewRequest = finalRow;
    await app.handleApprove();
    assert.deepEqual(calls, ['read']);
    assert.match(app._message.text, /changed|refresh/i);
  });

  it('keeps a published request visible when the worker did not complete it', async () => {
    const app = fixture({
      checkPublishRequest: async () => finalRow,
      publishContent: async () => ({ success: true }),
      approveRequests: async () => ({ success: true, completed: [], advanced: [{ path: '/page' }] }),
    });
    app._pendingRequests = [finalRow];
    await app.handleInboxApprove(finalRow);
    assert.equal(app._pendingRequests.length, 1);
    assert.match(app._message.text, /published.*workflow.*not completed/i);
  });

  it('re-reads a conflicting approval and releases its processing guard', async () => {
    let reads = 0;
    const app = fixture({
      checkPublishRequest: async () => { reads += 1; return finalRow; },
      publishContent: async () => ({ success: true }),
      approveRequests: async () => ({ success: false, status: 409, error: 'Finality changed' }),
    });
    await app.handleInboxApprove(finalRow);
    assert.equal(reads, 2);
    assert.match(app._message.text, /conflict.*refresh/i);
    assert.equal(app._processingPaths.size, 0);
  });

  it('groups approvals by the current step', async () => {
    const calls = [];
    const app = fixture({
      approveRequests: async (...args) => {
        calls.push(args);
        return { success: true, approved: args[2], advanced: args[2].map((path) => ({ path })) };
      },
    });
    const result = await app.approveGrouped([
      { path: '/one', stepInfo: { current: 1 } },
      { path: '/two', stepInfo: { current: 2 } },
    ]);
    assert.deepEqual(calls.map((args) => args[4]), [1, 2]);
    assert.deepEqual(Array.from(result.approved), ['/one', '/two']);
  });

  it('retains successful paths in a group with stale and unauthorized requests', async () => {
    const app = fixture({
      approveRequests: async () => ({
        success: false,
        approved: ['/one', '/denied'],
        advanced: [{ path: '/one' }, { path: '/denied' }],
        stale: ['/stale'],
        unauthorized: ['/denied'],
        notFound: ['/gone'],
      }),
    });
    const rows = ['/one', '/stale', '/denied', '/gone'].map((path) => ({
      path, isFinal: false, stepInfo: { current: 1 },
    }));
    const result = await app.approveGrouped(rows);
    assert.deepEqual(Array.from(result.approved), ['/one']);
    assert.match(result.error, /stale|conflict/i);
    assert.match(result.error, /denied|authoriz/i);
    assert.match(result.error, /gone|not found/i);
  });

  it('separates final and intermediate requests on the same step', async () => {
    const calls = [];
    const app = fixture({
      approveRequests: async (...args) => {
        calls.push(args);
        return args[5] ? { completed: args[2] }
          : { advanced: args[2].map((path) => ({ path })) };
      },
    });
    const result = await app.approveGrouped([
      { path: '/final', isFinal: true, stepInfo: { current: 1 } },
      { path: '/next', isFinal: false, stepInfo: { current: 1 } },
    ]);
    assert.deepEqual(calls.map((args) => args[5]), [true, false]);
    assert.deepEqual(Array.from(result.approved), ['/final', '/next']);
  });

  it('advances intermediate requests even when bulk publishing fails', async () => {
    const calls = [];
    const rows = [finalRow, { ...finalRow, path: '/next', isFinal: false }];
    const app = fixture({
      checkPublishRequest: async (_org, _site, path) => rows.find((row) => row.path === path),
      bulkPublishContent: async () => {
        calls.push('bulk');
        return { success: false, error: 'Backend failed' };
      },
      approveRequests: async (_org, _site, paths) => {
        calls.push(...paths);
        return { advanced: paths.map((path) => ({ path })) };
      },
    });
    app._pendingRequests = rows;
    await app.handleApproveAll();
    assert.deepEqual(calls, ['/next', 'bulk']);
    assert.deepEqual(Array.from(app._pendingRequests, (row) => row.path), ['/page']);
    assert.match(app._message.text, /1 advanced/);
    assert.equal(app._approveAllProcessing, false);
  });

  it('records only confirmed published resources when a bulk job times out', async () => {
    const rows = [finalRow, { ...finalRow, path: '/unknown' }];
    const calls = [];
    const app = fixture({
      checkPublishRequest: async (_org, _site, path) => rows.find((row) => row.path === path),
      bulkPublishContent: async () => ({ success: true, links: { self: 'https://admin.example/job' } }),
      pollJobStatus: async () => ({
        success: false,
        error: 'Timed out',
        job: { data: { resources: [{ path: '/page', status: 200 }] } },
      }),
      approveRequests: async (_org, _site, paths) => {
        calls.push(...paths);
        return { completed: paths };
      },
    });
    app._pendingRequests = rows;
    await app.handleApproveAll();
    assert.deepEqual(calls, ['/page']);
    assert.deepEqual(Array.from(app._pendingRequests, (row) => row.path), ['/unknown']);
    assert.match(app._message.text, /1 published/);
  });

  it('never publishes an intermediate approval', async () => {
    const calls = [];
    const row = {
      path: '/page', isFinal: false, canApproveNow: true, stepInfo: { current: 1, lastStaffed: 2 },
    };
    const app = fixture({
      checkPublishRequest: async () => row,
      publishContent: async () => { calls.push('publish'); return { success: true }; },
      approveRequests: async () => ({ success: true, advanced: [{ path: '/page', step: 2 }] }),
    });
    app._reviewRequest = row;
    await app.handleApprove();
    assert.deepEqual(calls, []);
    assert.equal(app._state, 'advanced');
    assert.match(app.renderContent(), /Step approved|Waiting.*step 2/i);
    assert.doesNotMatch(app.renderContent(), /Published!|View Published|aem.live/);
  });
});
