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
import { getProbeTarget } from '../../../../tools/apps/block-library-generator/jobs.js';
import discoverCachedBlocks from '../../../../tools/apps/block-library-generator/discovery-cache.js';

const target = getProbeTarget('prod', { org: 'test-org', site: 'test-site' });
const source = `${target.adminOrigin}/source/${target.org}/${target.site}`;
const cacheURL = `${source}/.da/block-library-generator/cache/blocks-main.json`;
const configURL = 'https://admin.hlx.page/config/test-org/aggregated/test-site.json';
const codePath = '/code-owner/repos/code-repo/code/main/blocks/';
const codeURL = `https://api.aem.live${codePath}`;

function fixture(names = ['cards', 'columns']) {
  const state = {
    names,
    cache: null,
    version: 1,
    calls: [],
    cacheStatus: 200,
    writeStatus: 201,
    failDiscovery: false,
    alterReadback: false,
    onWrite: null,
  };
  const options = {
    target,
    async daFetch(url, request) {
      state.calls.push({ url, ...request });
      if (url === cacheURL) {
        if (request.method === 'PUT') {
          if (state.onWrite) state.onWrite();
          if (state.writeStatus !== 201) return new Response(null, { status: state.writeStatus });
          assert.equal(
            request.headers[state.cache ? 'If-Match' : 'If-None-Match'],
            state.cache ? `"v${state.version}"` : '*',
          );
          state.cache = JSON.parse(await request.body.get('data').text());
          state.version += 1;
          if (state.alterReadback) state.cache.updatedAt = '2020-01-01T00:00:00.000Z';
          return new Response(null, { status: 201 });
        }
        if (state.cacheStatus !== 200) return new Response(null, { status: state.cacheStatus });
        return state.cache === null ? new Response(null, { status: 404 }) : new Response(
          typeof state.cache === 'string' ? state.cache : JSON.stringify(state.cache),
          { headers: { 'Content-Type': 'application/json', ETag: `"v${state.version}"` } },
        );
      }
      if (url === configURL) {
        return state.failDiscovery ? new Response(null, { status: 503 })
          : Response.json({ code: { owner: 'code-owner', repo: 'code-repo' } });
      }
      if (url === codeURL) {
        return Response.json({
          children: state.names.map((name) => ({ type: 'folder', path: `${codePath}${name}/` })),
        });
      }
      if (url.startsWith(codeURL)) {
        const name = url.slice(codeURL.length).replace(/\/$/, '');
        return Response.json({
          children: ['css', 'js'].map((extension) => ({
            type: 'file', path: `${codePath}${name}/${name}.${extension}`, size: 0,
          })),
        });
      }
      return new Response(null, { status: 404 });
    },
    fetchPublic: async () => { throw new Error('Public fallback was not expected'); },
  };
  return { state, options };
}

describe('Shared code-inventory cache', () => {
  it('creates metadata once, then loads56 blocks with one cache GET and zero discovery requests', async () => {
    const data = fixture(Array.from({ length: 56 }, (_, index) => `block-${index}`));
    const first = await discoverCachedBlocks(data.options);
    assert.equal(first.complete, true);
    assert.equal(first.blocks.length, 56);
    assert.equal(first.cache.fromCache, false);
    assert.equal(first.cacheWarning, '');
    assert.equal(data.state.calls.filter(({ url }) => url.startsWith('https://api.aem.live')).length, 57);
    assert.equal(data.state.cache.kind, 'block-inventory');
    assert.ok(data.state.cache.blocks.every((block) => block.files.every((file) => !file.content)));
    data.state.cache.updatedAt = '2020-01-01T00:00:00.000Z';
    data.state.calls.length = 0;
    const reopened = await discoverCachedBlocks(data.options);
    assert.equal(reopened.cache.fromCache, true);
    assert.equal(reopened.blocks.length, 56);
    assert.deepEqual(data.state.calls.map(({ url, method }) => [url, method]), [[cacheURL, 'GET']]);
  });

  it('refreshes only explicitly, using conditional replacement and exact readback', async () => {
    const data = fixture();
    await discoverCachedBlocks(data.options);
    data.state.names.push('hero');
    assert.equal((await discoverCachedBlocks(data.options)).blocks.length, 2);
    data.state.calls.length = 0;
    const refreshed = await discoverCachedBlocks({ ...data.options, forceRefresh: true });
    assert.equal(refreshed.blocks.length, 3);
    assert.equal(refreshed.cache.fromCache, false);
    assert.equal(data.state.cache.blocks.length, 3);
    assert.equal(data.state.calls.find(({ method }) => method === 'PUT').headers['If-Match'], '"v2"');
  });

  it('retains the saved inventory with a warning when explicit discovery fails', async () => {
    const data = fixture();
    await discoverCachedBlocks(data.options);
    const before = JSON.stringify(data.state.cache);
    data.state.failDiscovery = true;
    data.state.calls.length = 0;
    const result = await discoverCachedBlocks({ ...data.options, forceRefresh: true });
    assert.equal(result.complete, true);
    assert.equal(result.cache.fromCache, true);
    assert.match(result.cacheWarning, /refresh.*failed|could not.*refresh/i);
    assert.equal(JSON.stringify(data.state.cache), before);
    assert.ok(data.state.calls.every(({ method }) => method === 'GET'));
  });

  it('does not save partial discovery, but does cache a valid empty inventory', async () => {
    const data = fixture([]);
    data.state.failDiscovery = true;
    assert.equal((await discoverCachedBlocks(data.options)).complete, false);
    assert.equal(data.state.cache, null);
    data.state.failDiscovery = false;
    assert.equal((await discoverCachedBlocks(data.options)).blocks.length, 0);
    assert.ok(data.state.cache);
    data.state.calls.length = 0;
    assert.equal((await discoverCachedBlocks(data.options)).cache.fromCache, true);
    assert.equal(data.state.calls.length, 1);
  });

  it('does not interpret a denied cache read as absence or overwrite it', async () => {
    const data = fixture();
    await discoverCachedBlocks(data.options);
    const before = JSON.stringify(data.state.cache);
    data.state.cacheStatus = 403;
    data.state.calls.length = 0;
    const result = await discoverCachedBlocks({ ...data.options, forceRefresh: true });
    assert.equal(result.complete, true);
    assert.match(result.cacheWarning, /403/);
    assert.equal(JSON.stringify(data.state.cache), before);
    assert.ok(data.state.calls.every(({ method }) => method === 'GET'));
  });

  it('reports corrupt metadata and replaces it only on an explicit refresh', async () => {
    const data = fixture();
    data.state.cache = '{invalid';
    const result = await discoverCachedBlocks(data.options);
    assert.equal(result.complete, true);
    assert.match(result.cacheWarning, /invalid|JSON/i);
    assert.equal(data.state.cache, '{invalid');
    const repaired = await discoverCachedBlocks({ ...data.options, forceRefresh: true });
    assert.equal(repaired.cacheWarning, '');
    assert.equal(data.state.cache.kind, 'block-inventory');
  });

  it('rejects foreign, incomplete and unsafe cached lists instead of using their paths', async () => {
    const mutations = [
      (cache) => { cache.target.site = 'another-site'; },
      (cache) => { cache.complete = false; },
      (cache) => { cache.blocks[0].files[0].path = '/other/secret.css'; },
      (cache) => { cache.blocks.push(cache.blocks[0]); },
      (cache) => { cache.coordinates.ref = 'another-branch'; },
    ];
    await Promise.all(mutations.map(async (mutate) => {
      const data = fixture();
      await discoverCachedBlocks(data.options);
      mutate(data.state.cache);
      data.state.calls.length = 0;
      const result = await discoverCachedBlocks(data.options);
      assert.equal(result.cache.fromCache, false);
      assert.ok(result.cacheWarning);
      assert.ok(data.state.calls.every(({ method }) => method === 'GET'));
    }));
  });

  it('keeps fresh session results but warns on a write conflict or different readback', async () => {
    await Promise.all(['conflict', 'readback'].map(async (failure) => {
      const data = fixture();
      await discoverCachedBlocks(data.options);
      data.state.names.push('hero');
      if (failure === 'conflict') data.state.writeStatus = 412;
      else data.state.alterReadback = true;
      const result = await discoverCachedBlocks({ ...data.options, forceRefresh: true });
      assert.equal(result.blocks.length, 3);
      assert.match(result.cacheWarning, /412|readback/i);
    }));
  });

  it('does not replace an existing cache without a specific ETag', async () => {
    const data = fixture();
    await discoverCachedBlocks(data.options);
    data.state.names.push('hero');
    data.state.calls.length = 0;
    const fetcher = data.options.daFetch;
    const result = await discoverCachedBlocks({
      ...data.options,
      forceRefresh: true,
      daFetch: async (url, request) => {
        const response = await fetcher(url, request);
        if (url !== cacheURL || request.method !== 'GET') return response;
        return Response.json(data.state.cache);
      },
    });
    assert.equal(result.blocks.length, 3);
    assert.match(result.cacheWarning, /ETag/);
    assert.equal(data.state.cache.blocks.length, 2);
    assert.ok(data.state.calls.every(({ method }) => method === 'GET'));
  });

  it('does not persist another cache after cancellation and never touches jobs or preview', async () => {
    const data = fixture();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(discoverCachedBlocks({ ...data.options, signal: controller.signal }));
    assert.equal(data.state.calls.length, 0);
    await discoverCachedBlocks(data.options);
    assert.ok(data.state.calls.every(({ url }) => !/\/jobs\/|\/preview\/|\/live\//.test(url)));
    assert.ok(data.state.calls.every(({ method }) => ['GET', 'PUT'].includes(method)));
  });

  it('bypasses shared caching for an explicit repository override', async () => {
    const data = fixture();
    const result = await discoverCachedBlocks({
      ...data.options, githubRepository: 'override/repository',
    });
    assert.equal(result.complete, true);
    assert.ok(data.state.calls.every(({ url }) => url !== cacheURL));
    assert.equal(data.state.cache, null);
  });

  it('scopes cache reads by site, branch and environment', async () => {
    const calls = [];
    const daFetch = async (url) => {
      calls.push(url);
      throw new Error('Read failed');
    };
    await discoverCachedBlocks({
      target: getProbeTarget('prod', { org: 'test-org', site: 'another-site', branch: 'release' }),
      daFetch,
      fetchPublic: async () => new Response(null, { status: 404 }),
    });
    assert.ok(calls[0].endsWith('/test-org/another-site/.da/block-library-generator/cache/blocks-release.json'));
    assert.ok(calls.every((url) => !url.includes('/test-site/')));
    const count = calls.length;
    await assert.rejects(discoverCachedBlocks({
      target: getProbeTarget('stage'), daFetch,
    }), /Production/);
    assert.equal(calls.length, count);
  });
});
