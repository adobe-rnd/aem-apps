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
import { loadEndpointPattern } from '../../../../../tools/apps/graphql/adapters/da-config.js';
import { createFakeSdk, json, status } from './helpers/fake-sdk.js';

const ORG_CONFIG = 'GET https://admin.da.live/config/acme/';
const SITE_CONFIG = 'GET https://admin.da.live/config/acme/web/';
const sheet = (rows) => json({ ':type': 'sheet', data: rows });
const multiSheet = (rows) => json({
  ':type': 'multi-sheet', ':names': ['data', 'permissions'], data: { data: rows }, permissions: { data: [] },
});
const pattern = (value) => [{ key: 'other', value: 'x' }, { key: 'graphql.endpoint', value }];

const load = (options) => {
  const { sdk } = createFakeSdk(options);
  return loadEndpointPattern({ api: createDaApi(sdk), org: 'acme', site: 'web' });
};

describe('loadEndpointPattern', () => {
  it('prefers the site\'s pattern over the org\'s', async () => {
    const routes = { [ORG_CONFIG]: sheet(pattern('org')), [SITE_CONFIG]: multiSheet(pattern('site')) };
    assert.equal(await load({ routes }), 'site');
  });

  it('falls back to the org\'s pattern', async () => {
    const routes = { [ORG_CONFIG]: multiSheet(pattern('org')), [SITE_CONFIG]: sheet([]) };
    assert.equal(await load({ routes }), 'org');
  });

  it('reads a Helix 6 site\'s editor config from the source bus', async () => {
    const routes = {
      'GET https://api.aem.live/acme/sites/web/config/editor/da.json': json({ data: pattern('site'), permissions: [] }),
    };
    assert.equal(await load({ hlx6: true, routes }), 'site');
  });

  it('is undefined when unset or unreadable', async () => {
    assert.equal(await load({ routes: { [ORG_CONFIG]: status(403) } }), undefined);
    assert.equal(await load({ routes: { [ORG_CONFIG]: () => new Response('not json') } }), undefined);
  });
});
