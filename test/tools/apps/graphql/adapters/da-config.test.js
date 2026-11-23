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
import { createDaApi } from '../../../../../tools/apps/graphql/adapters/da-api.js';
import { loadServiceUrl } from '../../../../../tools/apps/graphql/adapters/da-config.js';
import { createFakeSdk, json, status } from './helpers/fake-sdk.js';

const ORG_CONFIG = 'GET https://admin.da.live/config/acme/';
const SITE_CONFIG = 'GET https://admin.da.live/config/acme/web/';
const sheet = (rows) => json({ ':type': 'sheet', data: rows });
const multiSheet = (rows) => json({
  ':type': 'multi-sheet', ':names': ['data', 'permissions'], data: { data: rows }, permissions: { data: [] },
});
const inFlags = (rows) => json({
  ':type': 'multi-sheet', ':names': ['data', 'flags'], data: { data: [] }, flags: { data: rows },
});
const serviceUrl = (value) => [{ key: 'sc.graphql.url', value }];

const loadUrl = (options) => {
  const { sdk } = createFakeSdk(options);
  return loadServiceUrl({ api: createDaApi(sdk), org: 'acme', site: 'web' });
};

describe('loadServiceUrl', () => {
  it('prefers the site\'s URL over the org\'s, without trailing slashes', async () => {
    const routes = {
      [ORG_CONFIG]: sheet(serviceUrl('https://org.example.com')),
      [SITE_CONFIG]: multiSheet(serviceUrl(' https://site.example.com/ ')),
    };
    assert.equal(await loadUrl({ routes }), 'https://site.example.com');
  });

  it('falls back to the org\'s URL', async () => {
    const routes = { [ORG_CONFIG]: multiSheet(serviceUrl('https://org.example.com')) };
    assert.equal(await loadUrl({ routes }), 'https://org.example.com');
  });

  it('reads a Helix 6 site\'s editor config from the source bus', async () => {
    const routes = {
      'GET https://api.aem.live/acme/sites/web/config/editor/da.json': json({ data: serviceUrl('https://site.example.com'), permissions: [] }),
    };
    assert.equal(await loadUrl({ hlx6: true, routes }), 'https://site.example.com');
  });

  it('ignores the key outside the first sheet', async () => {
    const routes = { [ORG_CONFIG]: inFlags(serviceUrl('https://org.example.com')) };
    assert.equal(await loadUrl({ routes }), undefined);
  });

  it('is undefined unless set to an https URL', async () => {
    assert.equal(await loadUrl({ routes: { [ORG_CONFIG]: status(403) } }), undefined);
    const values = ['not a url', 'http://insecure.example.com'];
    const urls = await Promise.all(values.map((value) => loadUrl({
      routes: { [ORG_CONFIG]: sheet(serviceUrl(value)) },
    })));
    assert.deepEqual(urls, [undefined, undefined]);
  });
});
