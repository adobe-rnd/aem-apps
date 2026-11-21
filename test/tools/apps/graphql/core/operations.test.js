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
import { createGraphqlCore } from '../../../../../tools/apps/graphql/core/operations.js';
import { unwrapCodeblocks, wrapCodeblocks } from '../../../../../tools/apps/graphql/core/codeblock.js';
import { NO_SCHEMAS_MESSAGE } from '../../../../../tools/apps/graphql/core/endpoint.js';
import { createMemoryStore } from './helpers/memory-store.js';

const SITE = '/acme/web';
const SCHEMAS = `${SITE}/.da/forms/schemas`;
const ENDPOINTS = `${SITE}/.da/graphql/endpoints`;
const NOW = new Date('2024-01-02T03:04:05Z');
const args = { org: 'acme', site: 'web' };

const schemaJson = (title) => ({ type: 'object', title, properties: { title: { type: 'string' } } });
const schemaDoc = (title) => wrapCodeblocks([JSON.stringify(schemaJson(title))]);
const configDoc = (schemas) => wrapCodeblocks([JSON.stringify({ schemas }), 'type Query']);
const readBlocks = (store, path) => unwrapCodeblocks(store.docs.get(path));
const callsTo = (store, name) => store.calls
  .filter(({ method }) => method === name).map(({ path }) => path);
const writes = (store) => callsTo(store, 'write');

function setup({
  files, published, permissions, fail, loadValidator,
} = {}) {
  const store = createMemoryStore({
    files, published, permissions, fail,
  });
  return { store, core: createGraphqlCore({ store, loadValidator, now: () => NOW }) };
}

const failOn = (method, path, status = 500) => (call) => (
  call.method === method && call.path === path ? status : undefined);

describe('listEndpoints', () => {
  it('finds a site with content and lists its endpoints', async () => {
    const { core } = setup({
      files: {
        [`${SITE}/index.html`]: 'x',
        [`${ENDPOINTS}/main/endpoint.html`]: configDoc(['product']),
        [`${ENDPOINTS}/Bad/endpoint.html`]: configDoc(['product']),
        [`${ENDPOINTS}/blog/endpoint.html`]: configDoc(['product']),
        [`${ENDPOINTS}/notes.txt`]: 'x',
        [`${ENDPOINTS}/single.html`]: configDoc(['product']),
      },
    });
    assert.deepEqual(await core.listEndpoints(args), { endpoints: ['blog', 'main'], found: true, canWrite: true });
  });

  it('treats an empty site as not found', async () => {
    const { core } = setup();
    assert.deepEqual(await core.listEndpoints(args), {
      endpoints: [], found: false, canWrite: false,
    });
  });

  it('is read-only without write permission', async () => {
    const { core } = setup({ files: { [`${SITE}/index.html`]: 'x' }, permissions: ['read'] });
    assert.equal((await core.listEndpoints(args)).canWrite, false);
  });

  it('finds a site with only schemas, as hlx6 lists no dot folders', async () => {
    const store = createMemoryStore({ files: { [`${SCHEMAS}/product.html`]: schemaDoc('Product') } });
    const list = async ({ path }) => (path === SITE ? { items: [] } : store.list({ path }));
    const core = createGraphqlCore({ store: { ...store, list } });
    const expected = { endpoints: [], found: true, canWrite: true };
    assert.deepEqual(await core.listEndpoints(args), expected);
  });

  it('treats a missing endpoints folder as no endpoints', async () => {
    const { core } = setup({
      files: { [`${SITE}/index.html`]: 'x' },
      fail: failOn('list', ENDPOINTS, 404),
    });
    const expected = { endpoints: [], found: true, canWrite: true };
    assert.deepEqual(await core.listEndpoints(args), expected);
  });

  it('reports a site or folder that cannot be listed', async () => {
    await Promise.all([SITE, ENDPOINTS, SCHEMAS].map(async (path) => {
      const { core } = setup({ fail: failOn('list', path) });
      assert.deepEqual(await core.listEndpoints(args), {
        code: 'load-failed', error: 'Could not load acme/web.', status: 500,
      });
    }));
  });
});

describe('loadSchemas', () => {
  const files = {
    [`${SCHEMAS}/product.html`]: schemaDoc('Product'),
    [`${SCHEMAS}/article.html`]: `<body><main><div><pre><code>${JSON.stringify(schemaJson('Article'))}</code></pre></div></main></body>`,
    [`${SCHEMAS}/broken.html`]: '<code>{</code>',
    [`${SCHEMAS}/gone.html`]: schemaDoc('Gone'),
    [`${SCHEMAS}/notes.txt`]: 'x',
  };

  it('reads, sorts and annotates the schema documents', async () => {
    const { core } = setup({ files, fail: failOn('read', `${SCHEMAS}/gone.html`) });
    const { schemas } = await core.loadSchemas(args);
    assert.deepEqual(schemas.map(({ id, status, valid }) => [id, status, valid]), [
      ['article', 'loaded', true],
      ['broken', 'invalid-json', false],
      ['gone', 'load-failed', false],
      ['product', 'loaded', true],
    ]);
    assert.deepEqual(schemas[0].schema, schemaJson('Article'));
  });

  it('validates schemas with the injected validator', async () => {
    const validate = (schema) => (schema.title === 'Product'
      ? { valid: false, schemaIssues: [{ schemaPath: '/', message: 'Nope.' }] }
      : { valid: true });
    const { core } = setup({ files, loadValidator: async () => validate });
    const product = (await core.loadSchemas(args)).schemas.find(({ id }) => id === 'product');
    assert.deepEqual([product.valid, product.issues], [false, ['Nope (at the schema root)']]);
  });

  it('accepts every parsed schema without a validator', async () => {
    const { core } = setup({ files });
    const product = (await core.loadSchemas(args)).schemas.find(({ id }) => id === 'product');
    assert.equal(product.valid, true);
  });

  it('reports a validator that cannot be loaded', async () => {
    const loaders = [() => Promise.reject(new Error('offline')), () => { throw new Error('offline'); }];
    await Promise.all(loaders.map(async (loadValidator) => {
      const { core } = setup({ files, loadValidator });
      assert.deepEqual(await core.loadSchemas(args), {
        code: 'load-failed', error: 'Could not load the schema validator.',
      });
    }));
  });

  it('treats a missing schemas folder as no schemas', async () => {
    const { core } = setup({ fail: failOn('list', SCHEMAS, 404) });
    assert.deepEqual(await core.loadSchemas(args), { schemas: [] });
  });

  it('reports schemas that cannot be listed', async () => {
    const { core } = setup({ files, fail: failOn('list', SCHEMAS) });
    assert.deepEqual(await core.loadSchemas(args), {
      code: 'load-failed', error: 'Could not load the schemas of acme/web.', status: 500,
    });
  });
});

describe('loadEndpoint', () => {
  it('reads and normalises a stored config', async () => {
    const { core } = setup({ files: { [`${ENDPOINTS}/main/endpoint.html`]: configDoc(['b', 'a']) } });
    assert.deepEqual(await core.loadEndpoint({ ...args, name: 'main' }), { config: { name: 'main', schemas: ['a', 'b'] } });
  });

  it('reports missing and unreadable endpoints', async () => {
    assert.deepEqual(await setup().core.loadEndpoint({ ...args, name: 'main' }), {
      code: 'not-found', error: 'Endpoint "main" was not found.', status: 404,
    });
    const { core } = setup({ fail: failOn('read', `${ENDPOINTS}/main/endpoint.html`) });
    assert.deepEqual(await core.loadEndpoint({ ...args, name: 'main' }), {
      code: 'load-failed', error: 'Could not load endpoint "main".', status: 500,
    });
  });

  it('reports a stored config that is not valid JSON', async () => {
    const { core } = setup({ files: { [`${ENDPOINTS}/main/endpoint.html`]: wrapCodeblocks(['{']) } });
    assert.deepEqual(await core.loadEndpoint({ ...args, name: 'main' }), {
      code: 'invalid-config', error: 'The endpoint configuration is not valid JSON.',
    });
  });
});

describe('saveEndpoint', () => {
  const files = { [`${SCHEMAS}/product.html`]: schemaDoc('Product') };
  const config = { name: 'main', schemas: ['product', 'product'], isNew: true };

  it('writes the config and the generated SDL as code blocks of one document, then publishes it', async () => {
    const { store, core } = setup({ files });
    const result = await core.saveEndpoint({ ...args, config });
    assert.deepEqual(result.config, { name: 'main', schemas: ['product'] });
    assert.deepEqual(result.warnings, []);
    assert.ok(result.sdl.includes('type Product {'));
    assert.deepEqual(store.calls.filter(({ method }) => ['write', 'publish'].includes(method)), [
      { method: 'write', path: `${ENDPOINTS}/main/endpoint.html` },
      { method: 'publish', path: `${ENDPOINTS}/main/endpoint.html` },
    ]);
    const [json, sdl] = readBlocks(store, `${ENDPOINTS}/main/endpoint.html`);
    assert.deepEqual(JSON.parse(json), {
      name: 'main', schemas: ['product'], generatedAt: '2024-01-02T03:04:05.000Z',
    });
    assert.equal(sdl, result.sdl);
  });

  it('refuses invalid configs and SDL errors without writing', async () => {
    const { store, core } = setup({ files });
    const badName = await core.saveEndpoint({ ...args, config: { name: 'Bad', schemas: ['product'] } });
    assert.equal(badName.code, 'invalid-config');
    assert.ok(badName.error.includes('lowercase'));
    assert.deepEqual(await core.saveEndpoint({ ...args, config: { name: 'main', schemas: [] } }), {
      code: 'invalid-config', error: NO_SCHEMAS_MESSAGE,
    });
    const result = await core.saveEndpoint({ ...args, config: { name: 'main', schemas: ['gone'] } });
    assert.equal(result.code, 'generation-failed');
    assert.equal(result.error, 'The GraphQL schema could not be generated.');
    assert.ok(result.errors.length > 0);
    assert.deepEqual(writes(store), []);
    assert.deepEqual(callsTo(store, 'publish'), []);
  });

  it('reports a document that could not be written, without publishing', async () => {
    const { store, core } = setup({ files, fail: failOn('write', `${ENDPOINTS}/main/endpoint.html`) });
    assert.deepEqual(await core.saveEndpoint({ ...args, config }), {
      code: 'save-failed', error: 'Could not save the endpoint.', status: 500,
    });
    assert.deepEqual(callsTo(store, 'publish'), []);
  });

  it('reports a saved document that could not be published', async () => {
    const { store, core } = setup({ files, fail: failOn('publish', `${ENDPOINTS}/main/endpoint.html`, 403) });
    assert.deepEqual(await core.saveEndpoint({ ...args, config }), {
      code: 'publish-failed',
      error: 'The endpoint was saved but could not be published. Save again to retry.',
      status: 403,
    });
    assert.ok(store.docs.has(`${ENDPOINTS}/main/endpoint.html`));
  });
});

describe('saveEndpoint over a stored endpoint', () => {
  const endpointPath = `${ENDPOINTS}/main/endpoint.html`;
  const files = (schemas) => ({
    [`${SCHEMAS}/product.html`]: schemaDoc('Product'),
    [endpointPath]: configDoc(schemas),
  });
  const save = (core, schemas) => core.saveEndpoint({ ...args, config: { name: 'main', schemas } });

  it('replaces the stored document', async () => {
    const { store, core } = setup({ files: files(['product']) });
    const result = await save(core, ['product']);
    assert.deepEqual(writes(store), [endpointPath]);
    assert.equal(readBlocks(store, endpointPath)[1], result.sdl);
  });

  it('keeps and skips selected schemas that no longer exist', async () => {
    const { store, core } = setup({ files: files(['gone', 'product']) });
    const { warnings } = await save(core, ['gone', 'product']);
    assert.deepEqual(warnings, [
      { schemaId: 'gone', pointer: '', message: 'The schema no longer exists and was skipped.' },
    ]);
    assert.deepEqual(JSON.parse(readBlocks(store, endpointPath)[0]).schemas, ['gone', 'product']);
  });

  it('keeps the stored endpoint when a selected schema cannot be read', async () => {
    const { store, core } = setup({ files: files(['product']), fail: failOn('read', `${SCHEMAS}/product.html`) });
    const result = await save(core, ['product']);
    assert.deepEqual(result.errors.map(({ schemaId, message }) => [schemaId, message]), [
      ['product', 'The schema could not be loaded.'],
      ['', 'There is no valid schema to generate from.'],
    ]);
    assert.deepEqual(writes(store), []);
    assert.equal(store.docs.get(endpointPath), configDoc(['product']));
  });
});

describe('deleteEndpoint', () => {
  const doc = `${ENDPOINTS}/main/endpoint.html`;
  const removes = (store) => callsTo(store, 'remove');

  it('unpublishes the endpoint, then removes its document and folder', async () => {
    const { store, core } = setup({
      files: { [doc]: configDoc(['a']), [`${ENDPOINTS}/blog/endpoint.html`]: configDoc(['a']) },
      published: [doc],
    });
    assert.deepEqual(await core.deleteEndpoint({ ...args, name: 'main' }), { ok: true });
    assert.deepEqual(store.calls.filter(({ method }) => ['unpublish', 'remove'].includes(method)), [
      { method: 'unpublish', path: doc },
      { method: 'remove', path: doc },
      { method: 'remove', path: `${ENDPOINTS}/main` },
    ]);
    assert.deepEqual([...store.published], []);
    assert.deepEqual([...store.docs.keys()], [`${ENDPOINTS}/blog/endpoint.html`]);
  });

  it('deletes an endpoint that was never published', async () => {
    const { store, core } = setup({ files: { [doc]: configDoc(['a']) } });
    assert.deepEqual(await core.deleteEndpoint({ ...args, name: 'main' }), { ok: true });
    assert.deepEqual([...store.docs.keys()], []);
  });

  it('keeps an endpoint that could not be unpublished', async () => {
    const { store, core } = setup({
      files: { [doc]: configDoc(['a']) },
      published: [doc],
      fail: failOn('unpublish', doc, 403),
    });
    assert.deepEqual(await core.deleteEndpoint({ ...args, name: 'main' }), {
      code: 'unpublish-failed', error: 'Could not unpublish endpoint "main". It was not deleted.', status: 403,
    });
    assert.deepEqual(removes(store), []);
    assert.ok(store.docs.has(doc));
  });

  it('reports failed removals and keeps the folder', async () => {
    const { store, core } = setup({
      files: { [`${ENDPOINTS}/main/endpoint.html`]: configDoc(['a']) },
      fail: failOn('remove', `${ENDPOINTS}/main/endpoint.html`),
    });
    assert.deepEqual(await core.deleteEndpoint({ ...args, name: 'main' }), {
      code: 'delete-failed', error: 'Could not delete endpoint "main".', status: 500,
    });
    assert.deepEqual(removes(store), [`${ENDPOINTS}/main/endpoint.html`]);
  });

  it('ignores a folder that cannot be removed', async () => {
    const { core } = setup({
      files: { [`${ENDPOINTS}/main/endpoint.html`]: configDoc(['a']) },
      fail: failOn('remove', `${ENDPOINTS}/main`),
    });
    assert.deepEqual(await core.deleteEndpoint({ ...args, name: 'main' }), { ok: true });
  });

  it('treats a missing endpoint as deleted', async () => {
    assert.deepEqual(await setup().core.deleteEndpoint({ ...args, name: 'main' }), { ok: true });
  });
});
