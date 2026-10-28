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
import createLocIndexProvider from '../../../../../tools/localization/core/providers/loc-index.js';

const DA_ORIGIN = 'https://admin.example';
const NESTED_URL = `${DA_ORIGIN}/source/acme/global/.da/loc/emea/es/index.json`;

function createStore(files = {}) {
  const stored = Object.fromEntries(Object.entries(files).map(([url, content], number) => [
    url, { content, etag: `"v${number}"` },
  ]));
  const requests = [];
  let writes = 0;
  const conflicts = { count: 0 };

  const fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const headers = options.headers ?? {};
    requests.push({ url, method, headers });
    const file = stored[url];
    if (method === 'GET') {
      if (!file) return new Response('', { status: 404 });
      const body = JSON.stringify(file.content);
      return new Response(body, { status: 200, headers: { ETag: file.etag } });
    }
    if (conflicts.count > 0) {
      conflicts.count -= 1;
      return new Response('', { status: 412 });
    }
    if (headers['If-None-Match'] === '*' && file) return new Response('', { status: 412 });
    if (headers['If-Match'] && headers['If-Match'] !== file?.etag) {
      return new Response('', { status: 412 });
    }
    writes += 1;
    const content = JSON.parse(await options.body.get('data').text());
    stored[url] = { content, etag: `"w${writes}"` };
    return new Response('', { status: 201 });
  };
  return {
    fetch, stored, requests, conflicts,
  };
}

const providerFor = (store, extra = {}) => createLocIndexProvider({
  org: 'acme', fetch: store.fetch, daOrigin: DA_ORIGIN, ...extra,
});

const EMPTY = { pages: {}, pending: {} };

describe('loc-index provider: read', () => {
  it('reads the index mirrored under .da/loc', async () => {
    const index = { pages: { p1: { base: { sourceId: 's', sourceVersion: '"1"', via: 'rollout' } } }, pending: {} };
    const store = createStore({ [NESTED_URL]: index });
    assert.deepEqual(await providerFor(store).read('global:/emea/es'), index);
    assert.equal(store.requests[0].url, NESTED_URL);
  });

  it('uses .da/loc/index.json for a whole-site location', async () => {
    const store = createStore();
    await providerFor(store).read('brand-b:/');
    assert.equal(store.requests[0].url, `${DA_ORIGIN}/source/acme/brand-b/.da/loc/index.json`);
  });

  it('returns an empty index when none exists', async () => {
    assert.deepEqual(await providerFor(createStore()).read('global:/emea/es'), EMPTY);
  });

  it('fills in missing sections', async () => {
    const store = createStore({ [NESTED_URL]: { pages: { p1: {} } } });
    assert.deepEqual(await providerFor(store).read('global:/emea/es'), { pages: { p1: {} }, pending: {} });
  });

  it('throws on other failures', async () => {
    const fetch = async () => new Response('', { status: 403 });
    const provider = createLocIndexProvider({ org: 'acme', fetch, daOrigin: DA_ORIGIN });
    await assert.rejects(provider.read('global:/emea/es'), /403/);
  });
});

describe('loc-index provider: write', () => {
  const entry = (sourceVersion) => ({ base: { sourceId: 's', sourceVersion, via: 'rollout' } });

  it('creates a new index with If-None-Match', async () => {
    const store = createStore();
    const result = await providerFor(store).write('global:/emea/es', { pages: { p1: entry('"1"') } });
    assert.deepEqual(result, { pages: { p1: entry('"1"') }, pending: {} });
    assert.deepEqual(store.stored[NESTED_URL].content, result);
    const post = store.requests.find((request) => request.method === 'POST');
    assert.equal(post.headers['If-None-Match'], '*');
  });

  it('patches an existing index with If-Match, setting and deleting entries', async () => {
    const store = createStore({
      [NESTED_URL]: { pages: { p1: entry('"1"'), p2: entry('"1"') }, pending: { '/emea/es/new.html': { job: { state: 'translating' } } } },
    });
    const result = await providerFor(store).write('global:/emea/es', {
      pages: { p1: entry('"2"'), p2: null },
      pending: { '/emea/es/new.html': null },
    });
    assert.deepEqual(result, { pages: { p1: entry('"2"') }, pending: {} });
    const post = store.requests.find((request) => request.method === 'POST');
    assert.equal(post.headers['If-Match'], '"v0"');
  });

  it('retries after a conflict by re-reading the index', async () => {
    const store = createStore({ [NESTED_URL]: { pages: { p1: entry('"1"') }, pending: {} } });
    store.conflicts.count = 1;
    const result = await providerFor(store).write('global:/emea/es', { pages: { p2: entry('"1"') } });
    assert.deepEqual(Object.keys(result.pages), ['p1', 'p2']);
    assert.equal(store.requests.filter((request) => request.method === 'GET').length, 2);
  });

  it('gives up after the maximum attempts', async () => {
    const store = createStore();
    store.conflicts.count = 5;
    const provider = providerFor(store, { maxAttempts: 3 });
    await assert.rejects(provider.write('global:/emea/es', { pages: { p1: entry('"1"') } }), /conflict/i);
    assert.equal(store.requests.filter((request) => request.method === 'POST').length, 3);
  });

  it('throws on write failures', async () => {
    const fetch = async (url, options = {}) => new Response('', { status: options.method === 'POST' ? 500 : 404 });
    const provider = createLocIndexProvider({ org: 'acme', fetch, daOrigin: DA_ORIGIN });
    await assert.rejects(provider.write('global:/emea/es', { pages: {} }), /500/);
  });
});
