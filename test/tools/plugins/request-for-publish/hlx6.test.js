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
import { isHlx6, previewApiUrl } from '../../../../tools/plugins/request-for-publish/hlx6.js';

function pingFetch(headers = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return { status: 200, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
  };
  return { fetchFn, calls };
}

describe('isHlx6', () => {
  it('is true when the admin ping announces the api upgrade', async () => {
    const { fetchFn, calls } = pingFetch({ 'x-api-upgrade-available': 'true' });
    assert.equal(await isHlx6('org', 'site', fetchFn), true);
    assert.deepEqual(calls, ['https://admin.hlx.page/ping/org/site']);
  });

  it('is false for legacy sites', async () => {
    const { fetchFn } = pingFetch();
    assert.equal(await isHlx6('org', 'site', fetchFn), false);
  });

  it('is false when the ping fails', async () => {
    assert.equal(await isHlx6('org', 'site', async () => { throw new TypeError('network'); }), false);
  });
});

describe('previewApiUrl', () => {
  it('previews legacy sites through admin.hlx.page', () => {
    assert.equal(previewApiUrl('org', 'site', '/drafts/x', false), 'https://admin.hlx.page/preview/org/site/main/drafts/x');
  });

  it('previews Helix 6 sites through api.aem.live', () => {
    assert.equal(previewApiUrl('org', 'site', '/drafts/x', true), 'https://api.aem.live/org/sites/site/preview/drafts/x');
  });

  it('adds a leading slash', () => {
    assert.equal(previewApiUrl('org', 'site', 'drafts/x', true), 'https://api.aem.live/org/sites/site/preview/drafts/x');
  });
});
