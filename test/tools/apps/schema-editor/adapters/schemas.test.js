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
import { createDaSource } from '../../../../../tools/apps/schema-editor/adapters/da-source.js';
import { createSchemaRepository } from '../../../../../tools/apps/schema-editor/adapters/schemas.js';
import { wrapSchemaHtml } from '../../../../../tools/apps/schema-editor/core/codeblock.js';
import { createFakeSdk, json, status } from './helpers/fake-sdk.js';

const DA = 'https://admin.da.live';
const BUS = 'https://api.aem.live/acme/sites/web';
const SCHEMAS = '/acme/web/.da/forms/schemas';
const SITE = { org: 'acme', site: 'web' };
const ARTICLE = { type: 'object', title: 'Article', properties: {} };

function setup(options) {
  const fake = createFakeSdk(options);
  return { ...fake, repository: createSchemaRepository(createDaSource(createDaApi(fake.sdk))) };
}

describe('createSchemaRepository', () => {
  it('lists the schema documents of a site', async () => {
    const { repository } = setup({
      routes: {
        [`GET ${DA}/list${SCHEMAS}`]: json([
          {
            name: 'article', ext: 'html', path: `${SCHEMAS}/article.html`, lastModified: 5,
          },
          { name: 'notes', ext: 'json', path: `${SCHEMAS}/notes.json` },
          { name: 'drafts', path: `${SCHEMAS}/drafts` },
        ], { headers: { 'x-da-child-actions': `${SCHEMAS}=read,write` } }),
      },
    });
    assert.deepEqual(await repository.list(SITE), {
      items: [{ name: 'article', lastModified: 5 }], permissions: ['read', 'write'],
    });
  });

  it('lists a site without a schemas folder as empty, and fails on other errors', async () => {
    assert.deepEqual(await setup().repository.list(SITE), { items: [] });
    const { repository } = setup({ routes: { [`GET ${DA}/list${SCHEMAS}`]: status(403) } });
    assert.deepEqual(await repository.list(SITE), { error: 'Request failed.', status: 403 });
  });

  it('reads a schema out of its document', async () => {
    const { repository } = setup({
      routes: { [`GET ${DA}/source${SCHEMAS}/article.html`]: () => new Response(wrapSchemaHtml(ARTICLE)) },
    });
    const { json: read } = await repository.read({ ...SITE, name: 'article' });
    assert.deepEqual(read, ARTICLE);
    assert.deepEqual(await repository.read({ ...SITE, name: 'gone' }), { error: 'Not found', status: 404 });
  });

  it('saves a schema as a document on the source bus of a Helix 6 site', async () => {
    const { repository, requests } = setup({
      hlx6: true,
      routes: { [`POST ${BUS}/source/.da/forms/schemas/article.html`]: status(201) },
    });
    assert.deepEqual(await repository.save({ ...SITE, name: 'article', json: ARTICLE }), { ok: true });
    assert.equal(requests()[0].opts.body, wrapSchemaHtml(ARTICLE));
  });

  it('removes a schema document', async () => {
    const { repository } = setup({
      routes: { [`DELETE ${DA}/source${SCHEMAS}/article.html`]: status(204) },
    });
    assert.deepEqual(await repository.remove({ ...SITE, name: 'article' }), { ok: true });
  });
});
