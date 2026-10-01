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
import { unwrapCodeblock, wrapCodeblock } from '../../../../../tools/apps/graphql/core/codeblock.js';
import { NO_SCHEMAS_MESSAGE } from '../../../../../tools/apps/graphql/core/endpoint.js';
import { createMemoryStore } from './helpers/memory-store.js';

const SITE = '/acme/web';
const SCHEMAS = `${SITE}/.da/forms/schemas`;
const ENDPOINTS = `${SITE}/.da/graphql/endpoints`;
const NOW = new Date('2024-01-02T03:04:05Z');
const args = { org: 'acme', site: 'web' };

const schemaJson = (title) => ({ type: 'object', title, properties: { title: { type: 'string' } } });
const schemaDoc = (title) => wrapCodeblock(JSON.stringify(schemaJson(title)));
const configDoc = (schemas) => wrapCodeblock(JSON.stringify({ schemas }));
const readDoc = (store, path) => unwrapCodeblock(store.docs.get(path));
const writes = (store) => store.calls.filter(({ method }) => method === 'write').map(({ path }) => path);

function setup({
  files, permissions, fail, loadValidator,
} = {}) {
  const store = createMemoryStore({ files, permissions, fail });
  return { store, core: createGraphqlCore({ store, loadValidator, now: () => NOW }) };
}

const failOn = (method, path, status = 500) => (call) => (
  call.method === method && call.path === path ? status : undefined);

describe('listEndpoints', () => {
  it('finds a site with content and lists its endpoints', async () => {
    const { core } = setup({
      files: {
        [`${SITE}/index.html`]: 'x',
        [`${ENDPOINTS}/main/config.html`]: configDoc(['product']),
        [`${ENDPOINTS}/Bad/config.html`]: configDoc(['product']),
        [`${ENDPOINTS}/blog/config.html`]: configDoc(['product']),
        [`${ENDPOINTS}/notes.html`]: 'x',
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
    const { core } = setup({ files: { [`${ENDPOINTS}/main/config.html`]: configDoc(['b', 'a']) } });
    assert.deepEqual(await core.loadEndpoint({ ...args, name: 'main' }), { config: { name: 'main', schemas: ['a', 'b'] } });
  });

  it('reports missing and unreadable endpoints', async () => {
    assert.deepEqual(await setup().core.loadEndpoint({ ...args, name: 'main' }), {
      code: 'not-found', error: 'Endpoint "main" was not found.', status: 404,
    });
    const { core } = setup({ fail: failOn('read', `${ENDPOINTS}/main/config.html`) });
    assert.deepEqual(await core.loadEndpoint({ ...args, name: 'main' }), {
      code: 'load-failed', error: 'Could not load endpoint "main".', status: 500,
    });
  });

  it('reports a stored config that is not valid JSON', async () => {
    const { core } = setup({ files: { [`${ENDPOINTS}/main/config.html`]: wrapCodeblock('{') } });
    assert.deepEqual(await core.loadEndpoint({ ...args, name: 'main' }), {
      code: 'invalid-config', error: 'The endpoint configuration is not valid JSON.',
    });
  });
});

describe('saveEndpoint', () => {
  const files = { [`${SCHEMAS}/product.html`]: schemaDoc('Product') };
  const config = { name: 'main', schemas: ['product', 'product'], isNew: true };

  it('writes the config, then the generated schema', async () => {
    const { store, core } = setup({ files });
    const result = await core.saveEndpoint({ ...args, config });
    assert.deepEqual(result.config, { name: 'main', schemas: ['product'] });
    assert.deepEqual(result.warnings, []);
    assert.ok(result.sdl.includes('type Product {'));
    assert.deepEqual(writes(store), [`${ENDPOINTS}/main/config.html`, `${ENDPOINTS}/main/schema.html`]);
    assert.deepEqual(JSON.parse(readDoc(store, `${ENDPOINTS}/main/config.html`)), { name: 'main', schemas: ['product'] });
    const sdlDocument = readDoc(store, `${ENDPOINTS}/main/schema.html`);
    assert.ok(sdlDocument.startsWith('# @generated by aem-apps graphql - do not edit\n# endpoint: main\n# generatedAt: 2024-01-02T03:04:05.000Z\n\n'));
    assert.ok(sdlDocument.endsWith(result.sdl));
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
  });

  it('reports which document could not be written', async () => {
    const configFailure = setup({ files, fail: failOn('write', `${ENDPOINTS}/main/config.html`) });
    assert.deepEqual(await configFailure.core.saveEndpoint({ ...args, config }), {
      code: 'save-failed', error: 'Could not save the endpoint configuration.', status: 500,
    });
    const sdlFailure = setup({ files, fail: failOn('write', `${ENDPOINTS}/main/schema.html`) });
    assert.deepEqual(await sdlFailure.core.saveEndpoint({ ...args, config }), {
      code: 'save-failed',
      error: 'The configuration was saved, but the GraphQL schema could not be saved.',
      status: 500,
    });
    assert.ok(sdlFailure.store.docs.has(`${ENDPOINTS}/main/config.html`));
  });
});

describe('saveEndpoint over a stored endpoint', () => {
  const configPath = `${ENDPOINTS}/main/config.html`;
  const sdlPath = `${ENDPOINTS}/main/schema.html`;
  const files = (schemas) => ({
    [`${SCHEMAS}/product.html`]: schemaDoc('Product'),
    [configPath]: configDoc(schemas),
    [sdlPath]: wrapCodeblock('old'),
  });
  const save = (core, schemas) => core.saveEndpoint({ ...args, config: { name: 'main', schemas } });

  it('replaces the config and the schema together', async () => {
    const { store, core } = setup({ files: files(['product']) });
    const result = await save(core, ['product']);
    assert.deepEqual(writes(store), [configPath, sdlPath]);
    assert.ok(readDoc(store, sdlPath).endsWith(result.sdl));
  });

  it('keeps and skips selected schemas that no longer exist', async () => {
    const { store, core } = setup({ files: files(['gone', 'product']) });
    const { warnings } = await save(core, ['gone', 'product']);
    assert.deepEqual(warnings, [
      { schemaId: 'gone', pointer: '', message: 'The schema no longer exists and was skipped.' },
    ]);
    assert.deepEqual(JSON.parse(readDoc(store, configPath)).schemas, ['gone', 'product']);
  });

  it('keeps the stored endpoint when a selected schema cannot be read', async () => {
    const { store, core } = setup({ files: files(['product']), fail: failOn('read', `${SCHEMAS}/product.html`) });
    const result = await save(core, ['product']);
    assert.deepEqual(result.errors.map(({ schemaId, message }) => [schemaId, message]), [
      ['product', 'The schema could not be loaded.'],
      ['', 'There is no valid schema to generate from.'],
    ]);
    assert.deepEqual(writes(store), []);
    assert.equal(readDoc(store, sdlPath), 'old');
  });
});

describe('deleteEndpoint', () => {
  it('removes the config and the schema, even if one is missing', async () => {
    const { store, core } = setup({
      files: { [`${ENDPOINTS}/main/config.html`]: configDoc(['a']), [`${ENDPOINTS}/blog/config.html`]: configDoc(['a']) },
    });
    assert.deepEqual(await core.deleteEndpoint({ ...args, name: 'main' }), { ok: true });
    assert.deepEqual([...store.docs.keys()], [`${ENDPOINTS}/blog/config.html`]);
  });

  it('reports failed removals', async () => {
    const { core } = setup({
      files: { [`${ENDPOINTS}/main/config.html`]: configDoc(['a']) },
      fail: failOn('remove', `${ENDPOINTS}/main/config.html`),
    });
    assert.deepEqual(await core.deleteEndpoint({ ...args, name: 'main' }), {
      code: 'delete-failed', error: 'Could not delete endpoint "main".', status: 500,
    });
  });

  it('keeps the config when the schema cannot be removed', async () => {
    const config = `${ENDPOINTS}/main/config.html`;
    const { store, core } = setup({
      files: { [config]: configDoc(['a']), [`${ENDPOINTS}/main/schema.html`]: 'sdl' },
      fail: failOn('remove', `${ENDPOINTS}/main/schema.html`),
    });
    assert.equal((await core.deleteEndpoint({ ...args, name: 'main' })).code, 'delete-failed');
    assert.ok(store.docs.has(config));
  });
});
