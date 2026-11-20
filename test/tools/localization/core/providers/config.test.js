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
import createLegacyApi from '../../../../../tools/localization/core/api/legacy.js';

const DA_ORIGIN = 'https://admin.example';
const apiOver = (fetch) => createLegacyApi({ fetch, daOrigin: DA_ORIGIN });

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
  return { provider: createConfigProvider({ org: 'acme', api: apiOver(fetch) }), requests };
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
    const provider = createConfigProvider({ org: 'acme', api: apiOver(fetch) });
    assert.deepEqual(await provider.listSites(), ['global', 'brand-b']);
    assert.equal(requests.length, 2);
  });

  it('throws when the org cannot be listed', async () => {
    const { provider } = providerFor({ [`${DA_ORIGIN}/list/acme`]: { status: 403 } });
    await assert.rejects(provider.listSites(), /403/);
  });
});

describe('config provider: write', () => {
  const url = `${DA_ORIGIN}/config/acme/global`;

  function writing(existing) {
    const requests = [];
    const fetch = async (target, options = {}) => {
      requests.push({ url: target, options });
      if (options.method === 'POST') return new Response('', { status: 201 });
      if (existing === null) return new Response('', { status: 404 });
      return new Response(JSON.stringify(existing), { status: 200 });
    };
    return {
      provider: createConfigProvider({ org: 'acme', api: apiOver(fetch) }),
      requests,
      saved: () => JSON.parse(requests.find((r) => r.options.method === 'POST').options.body.get('config')),
    };
  }

  const rows = [{ path: '/en', language: 'en' }];

  it('replaces the locations sheet and keeps other sheets', async () => {
    const { provider, saved, requests } = writing({
      ':version': 3,
      ':names': ['locations', 'library'],
      ':type': 'multi-sheet',
      locations: { total: 0, data: [], ':colWidths': [1] },
      library: { total: 1, data: [{ title: 'x' }] },
    });
    await provider.write('global', rows);
    const config = saved();
    assert.deepEqual(config.locations.data, rows);
    assert.equal(config.locations.total, 1);
    assert.deepEqual(config.locations[':colWidths'], [1]);
    assert.deepEqual(config.library.data, [{ title: 'x' }]);
    assert.deepEqual(config[':names'], ['locations', 'library']);
    assert.equal(requests.at(-1).url, url);
  });

  it('adds the sheet name when the sheet is new', async () => {
    const { provider, saved } = writing({ ':names': ['library'], library: { data: [] } });
    await provider.write('global', rows);
    assert.deepEqual(saved()[':names'], ['library', 'locations']);
  });

  it('creates a multi-sheet config when the site has none', async () => {
    const { provider, saved } = writing(null);
    await provider.write('global', rows);
    const config = saved();
    assert.equal(config[':type'], 'multi-sheet');
    assert.deepEqual(config[':names'], ['locations']);
    assert.deepEqual(config.locations.data, rows);
  });

  it('refuses to overwrite a single-sheet config', async () => {
    const { provider, requests } = writing({ ':type': 'sheet', data: [{ key: 'a' }] });
    await assert.rejects(provider.write('global', rows), /single sheet/);
    assert.ok(!requests.some((r) => r.options.method === 'POST'));
  });

  it('throws when the config cannot be read or saved', async () => {
    const unreadable = createConfigProvider({
      org: 'acme',
      api: apiOver(async () => new Response('', { status: 403 })),
    });
    await assert.rejects(unreadable.write('global', rows), /403/);
    const rejecting = createConfigProvider({
      org: 'acme',
      api: apiOver(async (target, options = {}) => new Response('{}', { status: options.method ? 500 : 200 })),
    });
    await assert.rejects(rejecting.write('global', rows), /Saving config.*500/);
  });
});
