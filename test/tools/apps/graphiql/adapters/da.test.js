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
/* eslint-disable no-template-curly-in-string */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDaAdapter } from '../../../../../tools/apps/graphiql/adapters/da.js';

const jsonResp = (body, status = 200) => new Response(JSON.stringify(body), { status });

function sdkWith(routes, { hlx6 = false, daOrigin = 'https://admin.da.live' } = {}) {
  const daFetch = async (url) => {
    if (url.startsWith('https://admin.hlx.page/ping/')) {
      return new Response('', { headers: hlx6 ? { 'x-api-upgrade-available': 'true' } : {} });
    }
    return routes[url] ?? new Response('', { status: 404 });
  };
  return { context: { daOrigin }, actions: { daFetch } };
}

describe('createDaAdapter().loadSite', () => {
  const site = { org: 'acme', site: 'web' };

  it('lists the endpoint folders of a DA site', async () => {
    const da = createDaAdapter(sdkWith({
      'https://admin.da.live/list/acme/web/.da/graphql/endpoints': jsonResp([
        { name: 'products', path: '/acme/web/.da/graphql/endpoints/products' },
        { name: 'cards', path: '/acme/web/.da/graphql/endpoints/cards' },
        { name: 'notes', ext: 'html' },
        { name: 'X', path: '/acme/web/.da/graphql/endpoints/X' },
      ]),
    }));
    assert.deepEqual(await da.loadSite(site), {
      endpoints: ['cards', 'products'],
    });
  });

  it('reads a Helix 6 site from the source bus', async () => {
    const da = createDaAdapter(sdkWith({
      'https://api.aem.live/acme/sites/web/source/.da/graphql/endpoints/': jsonResp([
        { name: 'products/' }, { name: 'readme.md' },
      ]),
    }, { hlx6: true }));
    assert.deepEqual(await da.loadSite(site), {
      endpoints: ['products'],
    });
  });

  it('treats a missing endpoints folder as no endpoints', async () => {
    const da = createDaAdapter(sdkWith({}));
    assert.deepEqual(await da.loadSite(site), { endpoints: [] });
  });

  it('reports a failed listing', async () => {
    const da = createDaAdapter(sdkWith({
      'https://admin.da.live/list/acme/web/.da/graphql/endpoints': new Response('', { status: 403 }),
    }));
    assert.ok((await da.loadSite(site)).error);
  });

  it('only uses known DA admins', async () => {
    const urls = [];
    const sdk = sdkWith({}, { daOrigin: 'https://evil.example' });
    const { daFetch } = sdk.actions;
    sdk.actions.daFetch = (url, init) => { urls.push(url); return daFetch(url, init); };
    await createDaAdapter(sdk).loadSite(site);
    assert.ok(urls.every((url) => !url.includes('evil.example')));
  });
});
