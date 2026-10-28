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
import createConfigProvider from '../../../../../tools/localization/core/providers/config.js';

const DA_ORIGIN = 'https://admin.example';

function fakeFetch(routes) {
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    const route = routes[url];
    if (!route) return new Response('', { status: 404 });
    return new Response(JSON.stringify(route.body ?? ''), { status: route.status ?? 200 });
  };
  return { fetch, requests };
}

const providerFor = (routes) => {
  const { fetch, requests } = fakeFetch(routes);
  return { provider: createConfigProvider({ org: 'acme', fetch, daOrigin: DA_ORIGIN }), requests };
};

describe('config provider: read', () => {
  it('returns the rows of the locations sheet from the site config', async () => {
    const rows = [{ path: '/en', language: 'en' }];
    const { provider, requests } = providerFor({
      [`${DA_ORIGIN}/config/acme/global`]: {
        body: { ':type': 'multi-sheet', locations: { data: rows }, other: { data: [] } },
      },
    });
    assert.deepEqual(await provider.read('global'), rows);
    assert.equal(requests[0].options.cache, 'no-store');
  });

  it('returns no rows when the site config has no locations sheet', async () => {
    const { provider } = providerFor({
      [`${DA_ORIGIN}/config/acme/global`]: { body: { ':type': 'multi-sheet', other: { data: [] } } },
    });
    assert.deepEqual(await provider.read('global'), []);
  });

  it('returns no rows when the site has no config', async () => {
    const { provider } = providerFor({});
    assert.deepEqual(await provider.read('global'), []);
  });

  it('returns null when the config is not readable', async () => {
    await Promise.all([401, 403].map(async (status) => {
      const { provider } = providerFor({ [`${DA_ORIGIN}/config/acme/global`]: { status } });
      assert.equal(await provider.read('global'), null, String(status));
    }));
  });

  it('throws on other failures', async () => {
    const { provider } = providerFor({ [`${DA_ORIGIN}/config/acme/global`]: { status: 500 } });
    await assert.rejects(provider.read('global'), /500/);
  });
});

describe('config provider: listSites', () => {
  it('returns the folder names of the org', async () => {
    const { provider } = providerFor({
      [`${DA_ORIGIN}/list/acme`]: {
        body: [
          { path: '/acme/global', name: 'global' },
          { path: '/acme/brand-b', name: 'brand-b' },
          { path: '/acme/readme.html', name: 'readme', ext: 'html' },
        ],
      },
    });
    assert.deepEqual(await provider.listSites(), ['global', 'brand-b']);
  });

  it('follows continuation tokens across pages', async () => {
    const requests = [];
    const pages = {
      first: { items: [{ path: '/acme/global', name: 'global' }], next: 'token-2' },
      'token-2': { items: [{ path: '/acme/brand-b', name: 'brand-b' }], next: null },
    };
    const fetch = async (url, options = {}) => {
      requests.push({ url, options });
      const token = options.headers?.['da-continuation-token'] ?? 'first';
      const { items, next } = pages[token];
      const headers = next ? { 'da-continuation-token': next } : {};
      return new Response(JSON.stringify(items), { status: 200, headers });
    };
    const provider = createConfigProvider({ org: 'acme', fetch, daOrigin: DA_ORIGIN });
    assert.deepEqual(await provider.listSites(), ['global', 'brand-b']);
    assert.equal(requests.length, 2);
  });

  it('throws when the org cannot be listed', async () => {
    const { provider } = providerFor({ [`${DA_ORIGIN}/list/acme`]: { status: 403 } });
    await assert.rejects(provider.listSites(), /403/);
  });
});
