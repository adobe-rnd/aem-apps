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
import * as shared from '../../../../tools/shared/hlx6.js';

// The app and api.js import from da.live at load time, so the tests run their source in a VM.
const read = (path) => readFileSync(new URL(`../../../../tools/apps/publish-requests-inbox/${path}`, import.meta.url), 'utf8');
const between = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to));

const appSource = between(read('publish-requests-inbox.js'), 'class PublishRequestsApp', "customElements.define('publish-requests-app'");
const versionSource = between(read('api.js'), '// DA version', '// Workflow bookkeeping')
  .replace(/^export /gm, '');

// hlx6: what the admin ping says; sourceBus: whether the primary content is
// in the source bus (null: unknown).
function versionApi(daFetch, { hlx6 = false, sourceBus = hlx6 } = {}) {
  return vm.runInNewContext(`${versionSource}; ({ versionSourcePath, createVersion })`, {
    DA_ADMIN: 'https://admin.da.live',
    isHlx6: async () => {
      if (hlx6 === null) throw new Error('Could not check the setup. Try again.');
      return hlx6;
    },
    usesSourceBus: async () => sourceBus,
    fetchSiteConfig: async () => null,
    aemApiUrl: shared.aemApiUrl,
    pacedAemApiFetch: shared.pacedAemApiFetch,
    encodeURIComponent,
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

describe('v1 inbox DA versions', () => {
  it('maps request paths to DA source paths', () => {
    const { versionSourcePath } = versionApi();
    assert.equal(versionSourcePath('/drafts/page'), 'drafts/page.html');
    assert.equal(versionSourcePath('/data/sheet.json'), 'data/sheet.json');
    assert.equal(versionSourcePath('/v1.2/page'), 'v1.2/page.html');
    assert.equal(versionSourcePath('/'), 'index.html');
    assert.equal(versionSourcePath('/drafts/'), 'drafts/index.html');
    assert.equal(versionSourcePath('/assets/file.pdf'), null);
  });

  it('posts the Approved & Published label to versionsource', async () => {
    const calls = [];
    const { createVersion } = versionApi(async (url, opts) => {
      calls.push([url, opts.method, opts.body]);
      return { ok: true };
    });
    assert.equal((await createVersion('example', 'website', '/page')).success, true);
    assert.deepEqual(calls, [
      ['https://admin.da.live/source/example/website/page.html', 'HEAD', undefined],
      ['https://admin.da.live/versionsource/example/website/page.html', 'POST', '{"label":"Approved & Published"}'],
    ]);
  });

  it('does not try to version a missing DA source', async () => {
    const calls = [];
    const { createVersion } = versionApi(async (_url, { method }) => {
      calls.push(method);
      return { ok: false, status: 404 };
    });
    const result = await createVersion('example', 'website', '/page');
    assert.equal(result.success, false);
    assert.equal(result.error, 'Source check failed: 404');
    assert.deepEqual(calls, ['HEAD']);
  });

  it('creates a Helix 6 version in the source bus with the label as its comment', async () => {
    const calls = [];
    const { createVersion } = versionApi(async (url, opts) => {
      calls.push([url, opts.method, opts.body]);
      return { ok: true };
    }, { hlx6: true });
    assert.equal((await createVersion('example', 'website', '/page')).success, true);
    // No HEAD first: the version POST checks the source itself.
    assert.deepEqual(calls, [
      ['https://api.aem.live/example/sites/website/source/page.html/.versions?comment=Approved%20%26%20Published', 'POST', undefined],
    ]);
  });

  it('reports a missing Helix 6 source from the version POST, which creates nothing', async () => {
    const calls = [];
    const { createVersion } = versionApi(async (url) => {
      calls.push(url);
      return { ok: false, status: 404 };
    }, { hlx6: true });
    const result = await createVersion('example', 'website', '/page');
    assert.equal(result.error, 'Version failed: 404');
    assert.equal(calls.length, 1);
  });

  it('retries a Helix 6 version the API host rate-limited', async () => {
    let count = 0;
    const { createVersion } = versionApi(async () => {
      count += 1;
      return count === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '0' } }) : { ok: true };
    }, { hlx6: true });
    assert.equal((await createVersion('example', 'website', '/page')).success, true);
    assert.equal(count, 2);
  });

  it('versions a legacy page on DA when the site only has a source-bus overlay', async () => {
    const calls = [];
    const { createVersion } = versionApi(async (url, opts) => {
      calls.push([url, opts.method]);
      return { ok: true };
    }, { hlx6: true, sourceBus: false });
    assert.equal((await createVersion('example', 'website', '/page')).success, true);
    assert.deepEqual(calls, [
      ['https://admin.da.live/source/example/website/page.html', 'HEAD'],
      ['https://admin.da.live/versionsource/example/website/page.html', 'POST'],
    ]);
  });

  it('creates no version when the content source is unknown', async () => {
    const calls = [];
    const { createVersion } = versionApi(async (url) => {
      calls.push(url);
      return { ok: true };
    }, { hlx6: null, sourceBus: null });
    const result = await createVersion('example', 'website', '/page');
    assert.equal(result.success, false);
    assert.match(result.error, /Could not determine where the content is stored/);
    assert.deepEqual(calls, []);
  });

  it('records approval before creating a version after a single publish', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async (_org, _site, path) => { calls.push(`version ${path}`); return { success: true }; },
      publishContent: async () => { calls.push('publish'); return { success: true }; },
      approveRequests: async () => { calls.push('approve'); return { success: true }; },
    });
    await inbox.handleApprove();
    assert.deepEqual(calls, ['publish', 'approve', 'version /page']);
    assert.equal(inbox._state, 'approved');
    assert.equal(inbox._message, null);
  });

  it('does not version a failed publish from the inbox', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async () => { calls.push('version'); return { success: true }; },
      publishContent: async () => { calls.push('publish'); return { success: false, error: '403' }; },
    });
    inbox._pendingRequests = [{ path: '/page' }];
    await inbox.handleInboxApprove({ path: '/page' });
    assert.deepEqual(calls, ['publish']);
    assert.equal(inbox._message.type, 'error');
  });

  it('still publishes and warns when the version fails', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async () => { calls.push('version'); return { success: false, error: 'Version failed: 500' }; },
      approveRequests: async () => { calls.push('approve'); return { success: true }; },
      publishContent: async () => { calls.push('publish'); return { success: true }; },
    });
    inbox._pendingRequests = [{ path: '/page' }];
    await inbox.handleInboxApprove({ path: '/page' });
    assert.deepEqual(calls, ['publish', 'approve', 'version']);
    assert.equal(inbox._message.type, 'info');
    assert.match(inbox._message.text, /Published: \/page DA version not created \(Version failed: 500\)/);
  });

  it('versions only confirmed bulk resources and names version failures', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async (_org, _site, path) => {
        calls.push(`version ${path}`);
        return { success: path !== '/two', error: 'Version failed: 500' };
      },
      bulkPublishContent: async () => {
        calls.push('bulk');
        return { success: true, links: { self: 'https://admin.example/job' } };
      },
      pollJobStatus: async () => {
        calls.push('poll');
        return {
          success: true,
          job: {
            data: {
              resources: [
                { path: '/one', status: 200 },
                { path: '/two', status: 304 },
                { path: '/failed', status: 500 },
              ],
            },
          },
        };
      },
      approveRequests: async (_org, _site, paths) => {
        calls.push(`approve ${paths.join(', ')}`);
        return { success: true };
      },
    });
    inbox._pendingRequests = [{ path: '/one' }, { path: '/two' }, { path: '/failed' }, { path: '/unknown' }];
    await inbox.handleApproveAll();
    assert.deepEqual(calls, ['bulk', 'poll', 'approve /one, /two', 'version /one', 'version /two']);
    assert.equal(inbox._message.type, 'error');
    assert.match(inbox._message.text, /Published 2 of 4.*DA version not created for: \/two\./);
    assert.deepEqual(inbox._pendingRequests.map((row) => row.path), ['/failed', '/unknown']);
  });

  it('limits concurrent version requests', async () => {
    let inFlight = 0;
    let peak = 0;
    const calls = [];
    const inbox = app({
      createVersion: async (_org, _site, path) => {
        calls.push(path);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { success: true };
      },
    });
    const paths = Array.from({ length: 8 }, (_, index) => `/page-${index}`);
    assert.equal(await inbox.versionPublishedPaths(paths), '');
    assert.deepEqual(calls, paths);
    assert.equal(peak, 6);
  });

  it('does not approve or version a bulk response without a job link', async () => {
    const calls = [];
    const inbox = app({
      createVersion: async () => { calls.push('version'); return { success: true }; },
      bulkPublishContent: async () => ({ success: true }),
      approveRequests: async () => { calls.push('approve'); return { success: true }; },
    });
    inbox._pendingRequests = [{ path: '/page' }];
    await inbox.handleApproveAll();
    assert.deepEqual(calls, []);
    assert.equal(inbox._message.type, 'error');
    assert.equal(inbox._pendingRequests.length, 1);
  });
});
