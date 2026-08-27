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
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBranches, parseCanonicalSource } from '../../../../tools/plugins/developer/api.js';

function fakeResponse({
  status, ok, headers = {}, body = {},
}) {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

// sessionStorage isn't available under node --test; api.js's readCache /
// writeCache both fall back gracefully when it throws, so a stub that always
// throws is enough to keep every test hitting the network path.
beforeEach(() => {
  global.sessionStorage = {
    getItem() { throw new Error('no sessionStorage'); },
    setItem() { throw new Error('no sessionStorage'); },
  };
});

describe('parseCanonicalSource', () => {
  it('extracts org/site from the end of the x-error message', () => {
    const header = '[admin] Code operation restricted to canonical source: attsites/att-da';
    assert.deepEqual(parseCanonicalSource(header), { org: 'attsites', site: 'att-da' });
  });

  it('returns null for a header with no org/site suffix', () => {
    assert.equal(parseCanonicalSource('[admin] some unrelated message'), null);
  });

  it('returns null for a missing header', () => {
    assert.equal(parseCanonicalSource(null), null);
  });
});

describe('fetchBranches', () => {
  it('returns branches on a plain success response', async () => {
    global.fetch = async () => fakeResponse({
      status: 200,
      body: { branches: ['/org/repos/site/code/main/', '/org/repos/site/code/feature/'] },
    });

    const result = await fetchBranches('org', 'site', 'token');
    assert.deepEqual(result, { branches: ['main', 'feature'], error: null });
  });

  it('maps 401 to an unauthorized error', async () => {
    global.fetch = async () => fakeResponse({ status: 401 });
    const result = await fetchBranches('org', 'site', 'token');
    assert.deepEqual(result, { branches: [], error: 'unauthorized' });
  });

  it('maps 404 to a not-found error', async () => {
    global.fetch = async () => fakeResponse({ status: 404 });
    const result = await fetchBranches('org', 'site', 'token');
    assert.deepEqual(result, { branches: [], error: 'not-found' });
  });

  it('retries against the canonical org/site on a 403 AEM_NOT_CANONICAL_CODE_SOURCE error', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(url);
      if (url.includes('/wrong-org/repos/wrong-site/')) {
        return fakeResponse({
          status: 403,
          headers: {
            'x-error-code': 'AEM_NOT_CANONICAL_CODE_SOURCE',
            'x-error': '[admin] Code operation restricted to canonical source: attsites/att-da',
          },
        });
      }
      if (url.includes('/attsites/repos/att-da/')) {
        return fakeResponse({
          status: 200,
          body: { branches: ['/attsites/repos/att-da/code/main/'] },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const result = await fetchBranches('wrong-org', 'wrong-site', 'token');
    assert.deepEqual(result, { branches: ['main'], error: null });
    assert.equal(calls.length, 2);
  });

  it('does not retry a 403 with a different error code', async () => {
    global.fetch = async () => fakeResponse({
      status: 403,
      headers: { 'x-error-code': 'SOME_OTHER_ERROR' },
    });

    const result = await fetchBranches('org', 'site', 'token');
    assert.deepEqual(result, { branches: [], error: 'http-403' });
  });

  it('falls back to the original 403 error when the x-error header cannot be parsed', async () => {
    global.fetch = async () => fakeResponse({
      status: 403,
      headers: {
        'x-error-code': 'AEM_NOT_CANONICAL_CODE_SOURCE',
        'x-error': 'no org/site here',
      },
    });

    const result = await fetchBranches('org', 'site', 'token');
    assert.deepEqual(result, { branches: [], error: 'http-403' });
  });

  it('maps network failures to a network error', async () => {
    global.fetch = async () => { throw new Error('boom'); };
    const result = await fetchBranches('org', 'site', 'token');
    assert.deepEqual(result, { branches: [], error: 'network' });
  });
});
