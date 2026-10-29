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
import { adminUrl, isHlx6 } from '../../../tools/shared/hlx6.js';

function pingFetch(headers = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { status: 200, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
  };
  return { fetchFn, calls };
}

// isHlx6 remembers each site's answer, so every test uses its own site name.
describe('isHlx6', () => {
  it('is true when the admin ping announces the api upgrade', async () => {
    const { fetchFn, calls } = pingFetch({ 'x-api-upgrade-available': 'true' });
    assert.equal(await isHlx6('org', 'upgraded', fetchFn), true);
    assert.deepEqual(calls, ['https://admin.hlx.page/ping/org/upgraded']);
  });

  it('is false for legacy sites', async () => {
    const { fetchFn } = pingFetch();
    assert.equal(await isHlx6('org', 'legacy', fetchFn), false);
  });

  it('is false when the ping fails', async () => {
    assert.equal(await isHlx6('org', 'unreachable', async () => { throw new TypeError('network'); }), false);
  });

  it('pings each site once', async () => {
    const { fetchFn, calls } = pingFetch({ 'x-api-upgrade-available': 'true' });
    await Promise.all([isHlx6('org', 'once', fetchFn), isHlx6('org', 'once', fetchFn)]);
    assert.equal(await isHlx6('org', 'once', fetchFn), true);
    assert.deepEqual(calls, ['https://admin.hlx.page/ping/org/once']);
  });

  it('pings again after a failed ping', async () => {
    assert.equal(await isHlx6('org', 'flaky', async () => { throw new TypeError('network'); }), false);
    const { fetchFn } = pingFetch({ 'x-api-upgrade-available': 'true' });
    assert.equal(await isHlx6('org', 'flaky', fetchFn), true);
  });
});

describe('adminUrl', () => {
  const page = { org: 'org', site: 'site', path: '/drafts/x' };

  it('keeps admin.hlx.page with the ref for legacy sites', () => {
    assert.equal(adminUrl('preview', page, false), 'https://admin.hlx.page/preview/org/site/main/drafts/x');
    assert.equal(adminUrl('live', { ...page, ref: 'release-42' }, false), 'https://admin.hlx.page/live/org/site/release-42/drafts/x');
  });

  it('uses api.aem.live without a ref for Helix 6 sites', () => {
    assert.equal(adminUrl('preview', page, true), 'https://api.aem.live/org/sites/site/preview/drafts/x');
    assert.equal(adminUrl('live', { ...page, ref: 'release-42' }, true), 'https://api.aem.live/org/sites/site/live/drafts/x');
  });

  it('builds the bulk endpoints', () => {
    // admin.hlx.page takes bulk paths at /*; api.aem.live at the resource root.
    assert.equal(adminUrl('live', { ...page, path: '/*' }, false), 'https://admin.hlx.page/live/org/site/main/*');
    assert.equal(adminUrl('live', { ...page, path: '/' }, true), 'https://api.aem.live/org/sites/site/live/');
  });

  it('adds a leading slash', () => {
    assert.equal(adminUrl('preview', { ...page, path: 'drafts/x' }, true), 'https://api.aem.live/org/sites/site/preview/drafts/x');
    assert.equal(adminUrl('preview', { ...page, path: 'drafts/x' }, false), 'https://admin.hlx.page/preview/org/site/main/drafts/x');
  });
});
