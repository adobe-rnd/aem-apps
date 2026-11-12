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
import { createDaApi } from '../../../../../tools/apps/schema-editor/adapters/da-api.js';
import { createFakeSdk, status } from './helpers/fake-sdk.js';

const DOC = '/acme/web/.da/forms/schemas/article.html';

describe('createDaApi', () => {
  it('locates a DA site on the shell\'s DA admin and admin.hlx.page', async () => {
    const { sdk } = createFakeSdk({ daOrigin: 'https://stage-admin.da.live' });
    assert.deepEqual(await createDaApi(sdk).locate(DOC), {
      hlx6: false,
      source: `https://stage-admin.da.live/source${DOC}`,
      list: `https://stage-admin.da.live/list${DOC}`,
    });
  });

  it('locates a Helix 6 site on the source bus', async () => {
    const { sdk } = createFakeSdk({ hlx6: true });
    const base = 'https://api.aem.live/acme/sites/web';
    assert.deepEqual(await createDaApi(sdk).locate(DOC), {
      hlx6: true,
      source: `${base}/source/.da/forms/schemas/article.html`,
      list: `${base}/source/.da/forms/schemas/article.html/`,
    });
    assert.equal((await createDaApi(sdk).locate('/acme/web')).list, `${base}/source/`);
  });

  it('uses admin.da.live when the shell names no known DA admin', async () => {
    const unknown = createFakeSdk({ daOrigin: 'https://example.com' });
    assert.equal((await createDaApi(unknown.sdk).locate('/acme/web')).list, 'https://admin.da.live/list/acme/web');
    const missing = createFakeSdk({ daOrigin: undefined });
    assert.equal((await createDaApi(missing.sdk).locate('/acme/web')).list, 'https://admin.da.live/list/acme/web');
  });

  it('pings each site once, and again after a failed ping', async () => {
    let pingStatus = 500;
    const fake = createFakeSdk({ ping: () => new Response(null, { status: pingStatus }) });
    const { locate } = createDaApi(fake.sdk);
    await Promise.all([locate('/acme/web/a'), locate('/acme/web/b')]);
    assert.equal(fake.pings().length, 1);
    pingStatus = 200;
    await locate('/acme/web/a');
    await locate('/acme/web/b');
    await locate('/acme/blog');
    assert.deepEqual(fake.pings().map(({ url }) => url), [
      'https://admin.hlx.page/ping/acme/web',
      'https://admin.hlx.page/ping/acme/web',
      'https://admin.hlx.page/ping/acme/blog',
    ]);
  });

  it('sends the full referrer to the AEM admin APIs only', async () => {
    const fake = createFakeSdk();
    const { request } = createDaApi(fake.sdk);
    await request('https://admin.hlx.page/preview/acme/web/main/a', { method: 'POST' });
    await request('https://api.aem.live/acme/sites/web/source/a.html');
    await request('https://admin.da.live/source/acme/web/a.html');
    assert.deepEqual(fake.calls.map(({ opts }) => opts.referrerPolicy), ['unsafe-url', 'unsafe-url', undefined]);
    assert.equal(fake.calls[0].opts.method, 'POST');
  });

  it('resolves the response, or undefined when the fetch throws', async () => {
    const fake = createFakeSdk({
      routes: {
        'GET https://admin.da.live/source/acme/web/a.html': status(403),
        'GET https://admin.da.live/source/acme/web/b.html': () => { throw new Error('IMS'); },
      },
    });
    const { request } = createDaApi(fake.sdk);
    assert.equal((await request('https://admin.da.live/source/acme/web/a.html')).status, 403);
    assert.equal(await request('https://admin.da.live/source/acme/web/b.html'), undefined);
  });
});
