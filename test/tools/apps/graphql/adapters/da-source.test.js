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
import { createDaStore } from '../../../../../tools/apps/graphql/adapters/da-source.js';
import { createFakeSdk, json, status } from './helpers/fake-sdk.js';

const DA = 'https://admin.da.live';
const BUS = 'https://api.aem.live/acme/sites/web';
const HLX = 'https://admin.hlx.page';
const SCHEMAS = '/acme/web/.da/forms/schemas';
const DOC = '/acme/web/.da/graphql/endpoints/main/endpoint.html';
const AEM_DOC = '/.da/graphql/endpoints/main/endpoint';

function setup(options) {
  const fake = createFakeSdk(options);
  return { ...fake, store: createDaStore(createDaApi(fake.sdk)) };
}

const summary = (fake) => fake.requests().map(({ method, url }) => `${method} ${url}`);

describe('createDaStore list', () => {
  it('lists every page of a DA folder, with the folder\'s permissions', async () => {
    const first = [{ name: 'a', ext: 'html', path: `${SCHEMAS}/a.html` }];
    const second = [{ name: 'old', path: `${SCHEMAS}/old` }];
    const { store, requests } = setup({
      routes: {
        [`GET ${DA}/list${SCHEMAS}`]: ({ headers }) => (headers['da-continuation-token'] === 'next'
          ? Response.json(second, { headers: { 'x-da-child-actions': `${SCHEMAS}=read,write` } })
          : Response.json(first, { headers: { 'da-continuation-token': 'next' } })),
      },
    });
    assert.deepEqual(await store.list({ path: SCHEMAS }), {
      items: [...first, ...second], permissions: ['read', 'write'],
    });
    assert.equal(requests().length, 2);
  });

  it('reads permissions from x-da-actions without x-da-child-actions', async () => {
    const { store } = setup({
      routes: { [`GET ${DA}/list/acme/web`]: json([], { headers: { 'x-da-actions': '/acme/web=read' } }) },
    });
    assert.deepEqual(await store.list({ path: '/acme/web' }), { items: [], permissions: ['read'] });
  });

  it('lists a Helix 6 folder as DA items, without hidden entries', async () => {
    const { store } = setup({
      hlx6: true,
      routes: {
        [`GET ${BUS}/source/.da/forms/schemas/`]: json([
          { name: 'product.html', 'content-type': 'text/html' },
          { name: 'v1.2.html', 'content-type': 'text/html' },
          { name: 'drafts/', 'content-type': 'application/folder' },
          { name: '.hidden', 'content-type': 'text/plain' },
          { 'content-type': 'text/plain' },
        ]),
      },
    });
    assert.deepEqual(await store.list({ path: SCHEMAS }), {
      items: [
        { name: 'product', ext: 'html', path: `${SCHEMAS}/product.html` },
        { name: 'v1.2', ext: 'html', path: `${SCHEMAS}/v1.2.html` },
        { name: 'drafts', path: `${SCHEMAS}/drafts` },
      ],
      permissions: undefined,
    });
  });

  it('fails with the listing\'s status, or none when there was no response', async () => {
    const { store } = setup({
      routes: {
        [`GET ${DA}/list/acme/web/forbidden`]: status(403),
        [`GET ${DA}/list/acme/web/broken`]: () => { throw new Error('IMS'); },
        [`GET ${DA}/list/acme/web/odd`]: json({ not: 'a list' }),
      },
    });
    assert.deepEqual(await store.list({ path: '/acme/web/missing' }), { error: 'Request failed.', status: 404 });
    assert.deepEqual(await store.list({ path: '/acme/web/forbidden' }), { error: 'Request failed.', status: 403 });
    assert.deepEqual(await store.list({ path: '/acme/web/broken' }), { error: 'Request failed.', status: undefined });
    assert.deepEqual(await store.list({ path: '/acme/web/odd' }), { error: 'Request failed.', status: 200 });
  });
});

describe('createDaStore read, write and remove', () => {
  it('reads a document, or fails with its status', async () => {
    const { store } = setup({
      routes: { [`GET ${DA}/source${DOC}`]: () => new Response('<main></main>') },
    });
    assert.deepEqual(await store.read({ path: DOC }), { text: '<main></main>' });
    assert.deepEqual(await store.read({ path: `${SCHEMAS}/gone.html` }), { error: 'Request failed.', status: 404 });
  });

  it('reads a Helix 6 document from the source bus', async () => {
    const { store } = setup({
      hlx6: true,
      routes: { [`GET ${BUS}/source${AEM_DOC}.html`]: () => new Response('<main></main>') },
    });
    assert.deepEqual(await store.read({ path: DOC }), { text: '<main></main>' });
  });

  it('writes a DA document as a form upload', async () => {
    const { store, requests } = setup({ routes: { [`POST ${DA}/source${DOC}`]: status(201) } });
    assert.deepEqual(await store.write({ path: DOC, text: '<main>x</main>' }), { ok: true });
    const { body } = requests()[0].opts;
    const data = body.get('data');
    assert.equal(data.type, 'text/html');
    assert.equal(await data.text(), '<main>x</main>');
  });

  it('writes a Helix 6 document as is', async () => {
    const { store, requests } = setup({
      hlx6: true, routes: { [`POST ${BUS}/source${AEM_DOC}.html`]: status(201) },
    });
    assert.deepEqual(await store.write({ path: DOC, text: '<main>x</main>' }), { ok: true });
    const { opts } = requests()[0];
    assert.equal(opts.body, '<main>x</main>');
    assert.equal(opts.headers['Content-Type'], 'text/html');
  });

  it('fails a write or remove with its status', async () => {
    const { store } = setup({ routes: { [`POST ${DA}/source${DOC}`]: status(403) } });
    assert.deepEqual(await store.write({ path: DOC, text: '' }), { error: 'Request failed.', status: 403 });
    assert.deepEqual(await store.remove({ path: DOC }), { error: 'Request failed.', status: 404 });
  });

  it('removes a document', async () => {
    const { store } = setup({ routes: { [`DELETE ${DA}/source${DOC}`]: status(204) } });
    assert.deepEqual(await store.remove({ path: DOC }), { ok: true });
  });
});

describe('createDaStore publish and unpublish', () => {
  const preview = `${HLX}/preview/acme/web/main${AEM_DOC}`;
  const live = `${HLX}/live/acme/web/main${AEM_DOC}`;

  it('previews, then publishes', async () => {
    const fake = setup({ routes: { [`POST ${preview}`]: status(200), [`POST ${live}`]: status(200) } });
    assert.deepEqual(await fake.store.publish({ path: DOC }), { ok: true });
    assert.deepEqual(summary(fake), [`POST ${preview}`, `POST ${live}`]);
  });

  it('publishes a Helix 6 document through the source bus', async () => {
    const fake = setup({
      hlx6: true,
      routes: { [`POST ${BUS}/preview${AEM_DOC}`]: status(200), [`POST ${BUS}/live${AEM_DOC}`]: status(200) },
    });
    assert.deepEqual(await fake.store.publish({ path: DOC }), { ok: true });
    assert.deepEqual(summary(fake), [`POST ${BUS}/preview${AEM_DOC}`, `POST ${BUS}/live${AEM_DOC}`]);
  });

  it('does not publish what could not be previewed', async () => {
    const fake = setup({ routes: { [`POST ${preview}`]: status(502) } });
    assert.deepEqual(await fake.store.publish({ path: DOC }), { error: 'Request failed.', status: 502 });
    assert.deepEqual(summary(fake), [`POST ${preview}`]);
  });

  it('unpublishes from live, then preview, even when not live', async () => {
    const fake = setup({ routes: { [`DELETE ${preview}`]: status(204) } });
    assert.deepEqual(await fake.store.unpublish({ path: DOC }), { ok: true });
    assert.deepEqual(summary(fake), [`DELETE ${live}`, `DELETE ${preview}`]);
  });

  it('keeps the preview when unpublishing from live fails', async () => {
    const fake = setup({ routes: { [`DELETE ${live}`]: status(500) } });
    assert.deepEqual(await fake.store.unpublish({ path: DOC }), { error: 'Request failed.', status: 500 });
    assert.deepEqual(summary(fake), [`DELETE ${live}`]);
  });
});
