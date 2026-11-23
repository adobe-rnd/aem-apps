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
/* eslint-disable no-underscore-dangle */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The app and api.js import from da.live at load time, so the tests run their source in a VM.
const read = (path) => readFileSync(new URL(`../../../../tools/apps/publish-requests-inbox/${path}`, import.meta.url), 'utf8');
const between = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to));

const appSource = between(read('publish-requests-inbox.js'), 'class PublishRequestsApp', "customElements.define('publish-requests-app'");
const versionSource = between(read('api.js'), '// DA version', '// Workflow bookkeeping')
  .replace(/^export /gm, '');

function versionApi(daFetch) {
  return vm.runInNewContext(`${versionSource}; ({ versionSourcePath, createVersion })`, {
    DA_ADMIN: 'https://admin.da.live',
    daFetch,
    console: { warn: () => {} },
    JSON,
  });
}

function app(overrides = {}) {
  const App = vm.runInNewContext(`${appSource}; PublishRequestsApp`, {
    LitElement: class { requestUpdate() { return this; } },
    URL,
    URLSearchParams,
    window: { location: { search: '', pathname: '/inbox' } },
    console,
    html: () => '',
    nothing: '',
    INFO_ICON: '',
    Promise,
    approveRequests: async () => ({ success: true }),
    ...overrides,
  });
  return Object.assign(new App(), {
    _org: 'example', _site: 'website', _path: '/page', token: 'token',
  });
}

describe('v1 inbox DA version before publish', () => {
  it('maps request paths to DA source paths', () => {
    const { versionSourcePath } = versionApi();
    assert.equal(versionSourcePath('/drafts/page'), 'drafts/page.html');
    assert.equal(versionSourcePath('/data/sheet.json'), 'data/sheet.json');
    assert.equal(versionSourcePath('/v1.2/page'), 'v1.2/page.html');
  });

  it('posts the Approved & Published label to versionsource', async () => {
    const calls = [];
    const { createVersion } = versionApi(async (url, opts) => {
      calls.push([url, opts.method, opts.body]);
      return { ok: true };
    });
    assert.equal((await createVersion('example', 'website', '/page')).success, true);
    assert.deepEqual(calls, [[
      'https://admin.da.live/versionsource/example/website/page.html', 'POST', '{"label":"Approved & Published"}',
    ]]);
  });

  it('reports a failed version without throwing', async () => {
    const { createVersion } = versionApi(async () => ({ ok: false, status: 404 }));
    const result = await createVersion('example', 'website', '/page');
    assert.equal(result.success, false);
    assert.equal(result.error, 'Version failed: 404');
  });

  it('creates a version before a single publish', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async (_org, _site, path) => { calls.push(`version ${path}`); return { success: true }; },
      publishContent: async () => { calls.push('publish'); return { success: true }; },
    });
    await inbox.handleApprove();
    assert.deepEqual(calls, ['version /page', 'publish']);
    assert.equal(inbox._state, 'approved');
    assert.equal(inbox._message, null);
  });

  it('still publishes and warns when the version fails', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async () => ({ success: false, error: 'Version failed: 500' }),
      publishContent: async () => { calls.push('publish'); return { success: true }; },
    });
    inbox._pendingRequests = [{ path: '/page' }];
    await inbox.handleInboxApprove({ path: '/page' });
    assert.deepEqual(calls, ['publish']);
    assert.equal(inbox._message.type, 'info');
    assert.match(inbox._message.text, /Published: \/page DA version not created \(Version failed: 500\)/);
  });

  it('versions every path before a bulk publish and names failures', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async (_org, _site, path) => {
        calls.push(`version ${path}`);
        return { success: path !== '/two', error: 'Version failed: 500' };
      },
      bulkPublishContent: async () => { calls.push('bulk'); return { success: true }; },
    });
    inbox._pendingRequests = [{ path: '/one' }, { path: '/two' }];
    await inbox.handleApproveAll();
    assert.deepEqual(calls, ['version /one', 'version /two', 'bulk']);
    assert.equal(inbox._message.type, 'info');
    assert.match(inbox._message.text, /All 2 requests published successfully! DA version not created for: \/two\./);
  });
});
