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
import createPageInfoProvider from '../../../../../tools/localization/core/providers/page-info.js';

const DA_ORIGIN = 'https://admin.example';
const SOURCE = `${DA_ORIGIN}/source/acme/global/en/x.html`;

function providerFor(routes) {
  const requests = [];
  const fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    requests.push({ url, method, options });
    const route = routes[`${method} ${url}`];
    if (!route) return new Response('', { status: 404 });
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: route.headers ?? {} });
  };
  return { provider: createPageInfoProvider({ org: 'acme', fetch, daOrigin: DA_ORIGIN }), requests };
}

describe('page-info provider: get', () => {
  it('reads id and ETag version from a HEAD request', async () => {
    const { provider, requests } = providerFor({
      [`HEAD ${SOURCE}`]: { headers: { 'X-da-id': 'page-1', ETag: '"etag-1"' } },
    });
    assert.deepEqual(await provider.get('global', '/en/x.html'), {
      exists: true, id: 'page-1', version: '"etag-1"',
    });
    assert.equal(requests[0].options.cache, 'no-store');
  });

  it('reports a missing page', async () => {
    const { provider } = providerFor({});
    assert.deepEqual(await provider.get('global', '/en/x.html'), { exists: false });
  });

  it('throws when the page cannot be read', async () => {
    const { provider } = providerFor({ [`HEAD ${SOURCE}`]: { status: 403 } });
    await assert.rejects(provider.get('global', '/en/x.html'), /403/);
  });
});

describe('page-info provider: needsReview', () => {
  it('is true when the content has diff markers', async () => {
    const markers = [
      '<da-diff-deleted><p>old</p></da-diff-deleted>',
      '<div class="hero" da-diff-added=""><p>new</p></div>',
      '<da-loc-added><p>legacy</p></da-loc-added>',
      '<da-loc-deleted><p>legacy</p></da-loc-deleted>',
    ];
    await Promise.all(markers.map(async (marker) => {
      const { provider } = providerFor({
        [`GET ${SOURCE}`]: { body: `<body><main><div>${marker}</div></main></body>` },
      });
      assert.equal(await provider.needsReview('global', '/en/x.html'), true, marker);
    }));
  });

  it('is false for clean content', async () => {
    const { provider } = providerFor({ [`GET ${SOURCE}`]: { body: '<body><main><p>da-diff mention</p></main></body>' } });
    assert.equal(await provider.needsReview('global', '/en/x.html'), false);
  });

  it('is false for a missing page', async () => {
    const { provider } = providerFor({});
    assert.equal(await provider.needsReview('global', '/en/x.html'), false);
  });

  it('throws on other failures', async () => {
    const { provider } = providerFor({ [`GET ${SOURCE}`]: { status: 500 } });
    await assert.rejects(provider.needsReview('global', '/en/x.html'), /500/);
  });
});

describe('page-info provider: list', () => {
  const LIST = `${DA_ORIGIN}/list/acme/global/en`;

  it('lists a folder with site-relative paths', async () => {
    const { provider } = providerFor({
      [`GET ${LIST}`]: {
        body: JSON.stringify([
          { path: '/acme/global/en/products', name: 'products' },
          {
            path: '/acme/global/en/x.html', name: 'x', ext: 'html', lastModified: 5,
          },
        ]),
      },
    });
    assert.deepEqual(await provider.list('global', '/en'), [
      { path: '/en/products', isFolder: true },
      { path: '/en/x.html', isFolder: false, lastModified: 5 },
    ]);
  });

  it('follows continuation tokens', async () => {
    const requests = [];
    const pages = {
      first: { items: [{ path: '/acme/global/en/a.html', name: 'a', ext: 'html' }], next: 'token-2' },
      'token-2': { items: [{ path: '/acme/global/en/b.html', name: 'b', ext: 'html' }], next: null },
    };
    const fetch = async (url, options = {}) => {
      requests.push(url);
      const { items, next } = pages[options.headers?.['da-continuation-token'] ?? 'first'];
      const headers = next ? { 'da-continuation-token': next } : {};
      return new Response(JSON.stringify(items), { status: 200, headers });
    };
    const provider = createPageInfoProvider({ org: 'acme', fetch, daOrigin: DA_ORIGIN });
    const items = await provider.list('global', '/en');
    assert.deepEqual(items.map((item) => item.path), ['/en/a.html', '/en/b.html']);
    assert.equal(requests.length, 2);
  });

  it('lists a whole site', async () => {
    const { provider, requests } = providerFor({ [`GET ${DA_ORIGIN}/list/acme/global`]: { body: '[]' } });
    assert.deepEqual(await provider.list('global', '/'), []);
    assert.equal(requests[0].url, `${DA_ORIGIN}/list/acme/global`);
  });

  it('throws when the folder cannot be listed', async () => {
    const { provider } = providerFor({ [`GET ${LIST}`]: { status: 403 } });
    await assert.rejects(provider.list('global', '/en'), /403/);
  });
});
