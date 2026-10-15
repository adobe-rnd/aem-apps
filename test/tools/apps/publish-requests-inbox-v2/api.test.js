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
    assert.equal(api.isFinalStep({ stepInfo: { current: 2, lastStaffed: 2 } }), true);
    assert.equal(api.isFinalStep({ stepInfo: { current: 1, lastStaffed: null } }), false);
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
  it('groups approvals by the current step', async () => {
    const calls = [];
    const app = fixture({
      approveRequests: async (...args) => {
        calls.push(args);
        return { success: true, approved: args[2] };
      },
    });
    const result = await app.approveGrouped([
      { path: '/one', stepInfo: { current: 1 } },
      { path: '/two', stepInfo: { current: 2 } },
    ]);
    assert.deepEqual(calls.map((args) => args[4]), [1, 2]);
    assert.deepEqual(Array.from(result.approved), ['/one', '/two']);
  });

  it('never publishes an intermediate approval', async () => {
    const calls = [];
    const row = { path: '/page', canApproveNow: true, stepInfo: { current: 1, lastStaffed: 2 } };
    const app = fixture({
      publishContent: async () => { calls.push('publish'); return { success: true }; },
      approveRequests: async () => ({ success: true, advanced: [{ path: '/page', step: 2 }] }),
    });
    app._reviewRequest = row;
    await app.handleApprove();
    assert.deepEqual(calls, []);
  });
});
