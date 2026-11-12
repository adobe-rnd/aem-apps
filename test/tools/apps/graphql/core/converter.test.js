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
import { readFile } from 'node:fs/promises';
import { Kind, parse } from '../../../../../tools/deps/graphql/dist/index.js';
import { buildSdl, generateSdl } from '../../../../../tools/apps/graphql/core/sdl.js';
import project from './fixtures/project.schema.js';
import edgeCases from './fixtures/edge-cases.schema.js';

const loadGolden = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const obj = (properties, extra = {}) => ({
  type: 'object', title: 'T', properties, ...extra,
});

const messages = (list) => list.map(({ message }) => message);

describe('generateSdl', () => {
  it('matches the golden SDL for the schema-spec example', async () => {
    const { sdl, warnings, errors } = generateSdl({ schemas: [{ id: 'project', schema: project }] });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
    assert.equal(sdl, await loadGolden('project.graphql'));
  });

  it('matches the golden SDL for edge cases', async () => {
    const { sdl, warnings } = generateSdl({ schemas: [{ id: 'menu', schema: edgeCases }] });
    assert.equal(sdl, await loadGolden('edge-cases.graphql'));
    assert.deepEqual(warnings.map(({ pointer }) => pointer), [
      '/items/properties/extra',
      '/items/properties/missing',
      '/items/properties/metadata',
      '/items/properties/unknown',
    ]);
  });

  it('is deterministic regardless of input order', () => {
    const a = { id: 'a', schema: obj({ x: { type: 'string', title: 'X' } }) };
    const b = { id: 'b', schema: obj({ y: { type: 'integer', title: 'Y' } }) };
    assert.equal(generateSdl({ schemas: [a, b] }).sdl, generateSdl({ schemas: [b, a] }).sdl);
  });

  it('marks each schema as a Content AI document type', () => {
    const { sdl } = generateSdl({ schemas: [{ id: 'blog-post', schema: obj({ x: { type: 'string', title: 'X' } }) }] });
    assert.ok(sdl.includes('type BlogPost @contentType(id: "blog-post") {'));
    assert.ok(sdl.includes('data: BlogPostData\n'));
  });

  it('declares only object types and scalars, without Query, directives or arguments', () => {
    const { sdl } = generateSdl({
      schemas: [{ id: 'project', schema: project }, { id: 'menu', schema: edgeCases }],
    });
    const { definitions } = parse(sdl);
    const kinds = [...new Set(definitions.map(({ kind }) => kind))].sort();
    assert.deepEqual(kinds, [Kind.OBJECT_TYPE_DEFINITION, Kind.SCALAR_TYPE_DEFINITION].sort());
    const names = definitions.map(({ name }) => name.value);
    ['Query', 'Mutation', 'Subscription', 'PageInfo'].forEach((name) => assert.ok(!names.includes(name)));
    const args = definitions
      .flatMap(({ fields = [] }) => fields.flatMap((field) => field.arguments));
    assert.deepEqual(args, []);
  });

  it('maps string formats to scalars and only emits used scalars', () => {
    const { sdl } = generateSdl({
      schemas: [{
        id: 'event',
        schema: obj({
          day: { type: 'string', title: 'Day', format: 'date' },
          status: {
            type: 'string', title: 'S', enum: ['A'], format: 'date',
          },
        }),
      }],
    });
    assert.ok(sdl.includes('day: Date'));
    assert.ok(sdl.includes('status: String'));
    assert.ok(sdl.includes('scalar Date\n'));
    assert.ok(!sdl.includes('scalar DateTime'));
    assert.ok(!sdl.includes('scalar Time'));
    assert.ok(!sdl.includes('scalar JSON'));
  });

  it('namespaces $defs by root type so schemas can reuse def names', () => {
    const withContact = (field) => ({
      $defs: { Contact: obj({ [field]: { type: 'string', title: field } }) },
      ...obj({ contact: { $ref: '#/$defs/Contact' } }),
    });
    const { sdl, errors } = generateSdl({
      schemas: [
        { id: 'a', schema: withContact('email') },
        { id: 'b', schema: withContact('phone') },
      ],
    });
    assert.deepEqual(errors, []);
    assert.ok(sdl.includes('type AContact {'));
    assert.ok(sdl.includes('type BContact {'));
  });

  it('renames nested types that collide with the data type or Content AI generated types', () => {
    const nested = obj({ x: { type: 'string', title: 'X' } });
    const { sdl, warnings, errors } = generateSdl({
      schemas: [{
        id: 'product',
        schema: obj({
          filter: nested, page: nested, orderBy: nested, data: nested,
        }),
      }],
    });
    assert.deepEqual(errors, []);
    ['filter: Product_Filter', 'page: Product_Page', 'orderBy: Product_OrderBy', 'data: ProductData2']
      .forEach((field) => assert.ok(sdl.includes(field), field));
    assert.deepEqual(messages(warnings), [
      'The type name "ProductFilter" is reserved by Content AI; generated "Product_Filter" instead.',
      'The type name "ProductPage" is reserved by Content AI; generated "Product_Page" instead.',
      'The type name "ProductOrderBy" is reserved by Content AI; generated "Product_OrderBy" instead.',
      'The type name "ProductData" is already used; generated "ProductData2" instead.',
    ]);
  });

  it('suffixes reserved root names', () => {
    const { sdl } = generateSdl({ schemas: [{ id: 'query', schema: obj({ q: { type: 'string', title: 'Q' } }) }] });
    assert.ok(sdl.includes('type QueryType @contentType(id: "query") {'));
  });

  it('reports an error when two schema ids produce the same type', () => {
    const schema = obj({ x: { type: 'string', title: 'X' } });
    const { sdl, errors } = generateSdl({
      schemas: [{ id: 'my-type', schema }, { id: 'my_type', schema }],
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].schemaId, 'my_type');
    assert.ok(sdl.includes('type MyType @contentType(id: "my-type") {'));
  });

  it('reports an error when a schema id produces a type Content AI generates for another', () => {
    const schema = obj({ x: { type: 'string', title: 'X' } });
    const { sdl, errors } = generateSdl({
      schemas: [{ id: 'product-page', schema }, { id: 'product', schema }],
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].schemaId, 'product-page');
    assert.ok(errors[0].message.includes('"ProductPage"'));
    assert.ok(!sdl.includes('type ProductPage'));
  });

  it('skips schema ids and property keys that are blank or contain a dot', () => {
    const str = { type: 'string', title: 'S' };
    const { sdl, warnings, errors } = generateSdl({
      schemas: [
        { id: 'a.b', schema: obj({ x: str }) },
        { id: 'ok', schema: obj({ 'x.y': str, ' ': str, z: str }) },
      ],
    });
    assert.deepEqual(errors, []);
    assert.ok(!sdl.includes('@contentType(id: "a.b")'));
    assert.ok(sdl.includes('type OkData {\n  z: String\n}'));
    assert.deepEqual(warnings.map(({ schemaId, pointer }) => `${schemaId}${pointer}`), [
      'a.b', 'ok/properties/x.y', 'ok/properties/ ',
    ]);
  });

  it('reports an error above 1,000 indexed fields', () => {
    const tree = (refs) => ({
      $defs: {
        Node: obj(Object.fromEntries([
          ['label', { type: 'string', title: 'L' }],
          ...refs.map((key) => [key, { $ref: '#/$defs/Node' }]),
        ])),
      },
      ...obj({ tree: { $ref: '#/$defs/Node' } }),
    });
    assert.deepEqual(generateSdl({ schemas: [{ id: 'menu', schema: tree(['child']) }] }).errors, []);
    // path and title, plus 3^0 + … + 3^7 labels from level 3 down to level 10.
    const { errors } = generateSdl({ schemas: [{ id: 'tree', schema: tree(['left', 'right', 'mid']) }] });
    assert.equal(
      messages(errors)[0],
      'The generated SDL has 3,282 indexed fields ("tree": 3,282); Content AI accepts at most 1,000. Remove fields, or object types that refer to themselves more than once.',
    );
  });

  it('checks the 1,000 generated filter and sort types', () => {
    // 2 × (2^0 + … + 2^7) nodes from level 3 down to level 10: 512 keys with
    // path and title, and a filter and an orderBy type per node, data and document.
    const binary = (n) => ({
      $defs: {
        Node: obj({
          n, left: { $ref: '#/$defs/Node' }, right: { $ref: '#/$defs/Node' },
        }),
      },
      ...obj({ left: { $ref: '#/$defs/Node' }, right: { $ref: '#/$defs/Node' } }),
    });
    const numbers = generateSdl({ schemas: [{ id: 'tree', schema: binary({ type: 'integer' }) }] });
    assert.deepEqual(messages(numbers.errors), [
      'The generated SDL needs 1,024 generated filter and sort types ("tree": 1,024); Content AI accepts at most 1,000. Remove nested objects, or object types that refer to themselves.',
    ]);
    // Text sorts only with the index's filter flag, so it may still fit.
    const text = generateSdl({ schemas: [{ id: 'tree', schema: binary({ type: 'string' }) }] });
    assert.deepEqual(text.errors, []);
    assert.deepEqual(messages(text.warnings), [
      'The generated SDL needs 512 to 1,024 generated filter and sort types, depending on which text keys have filtering enabled in the index; Content AI rejects the endpoint above 1,000.',
    ]);
    // Lists, Booleans and keys with whitespace can't be sorted.
    const ref = { $ref: '#/$defs/Node' };
    const nodes = binary({ type: 'integer' });
    const listed = { ...nodes, ...obj({ left: { type: 'array', items: ref }, right: ref }) };
    const spaced = { ...nodes, ...obj({ 'left side': ref, right: ref }) };
    [listed, spaced, binary({ type: 'boolean' })].forEach((schema) => {
      const result = generateSdl({ schemas: [{ id: 'tree', schema }] });
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.warnings, []);
    });
  });

  it('maps integers beyond 32 bits to Float', () => {
    const { sdl, warnings } = generateSdl({
      schemas: [{
        id: 'n',
        schema: obj({
          big: { type: 'integer', maximum: 2 ** 31 },
          small: { type: 'integer', minimum: -(2 ** 31) - 1 },
          edge: { type: 'integer', minimum: -(2 ** 31), exclusiveMaximum: 2 ** 31 },
        }),
      }],
    });
    assert.ok(sdl.includes('big: Float\n'));
    assert.ok(sdl.includes('small: Float\n'));
    assert.ok(sdl.includes('edge: Int\n'));
    assert.deepEqual(warnings.map(({ pointer }) => pointer), ['/properties/big', '/properties/small']);
  });

  it('reports an error above 64 KiB of SDL', () => {
    const properties = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`f${i}${'x'.repeat(70)}`, { type: 'string' }]));
    const { errors } = generateSdl({ schemas: [{ id: 'big', schema: obj(properties) }] });
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /^The generated SDL has [\d,]+ bytes; Content AI accepts at most 64 KiB/);
  });

  it('reports an error when no usable schema is given', () => {
    assert.equal(generateSdl({ schemas: [] }).errors.length, 1);
    const { errors, warnings } = generateSdl({ schemas: [{ id: 'x', schema: { type: 'string', title: 'X' } }] });
    assert.equal(errors.length, 1);
    assert.ok(messages(warnings)[0].includes('must be an object or an array'));
  });

  it('maps an object root without properties to JSON data', () => {
    const { sdl, warnings } = generateSdl({ schemas: [{ id: 'blank', schema: obj({}) }] });
    assert.ok(sdl.includes('data: JSON'));
    assert.equal(warnings.length, 1);
  });

  it('maps a recursive $ref chain without an object to JSON', () => {
    const schema = {
      $defs: { Loop: { $ref: '#/$defs/Loop' } },
      ...obj({ loop: { $ref: '#/$defs/Loop' } }),
    };
    const { sdl, warnings } = generateSdl({ schemas: [{ id: 'loop', schema }] });
    assert.ok(sdl.includes('loop: JSON'));
    assert.ok(messages(warnings)[0].includes('Recursive $ref'));
  });

  it('escapes quotes in directive arguments and validates the result', () => {
    const { sdl, errors } = generateSdl({ schemas: [{ id: 'q', schema: obj({ 'a "b"\\c': { type: 'string', title: 'A' } }) }] });
    assert.ok(sdl.includes('a__b__c: String @source(key: "a \\"b\\"\\\\c")'));
    assert.deepEqual(errors, []);
  });
});

const loaded = (id, schema = obj({ title: { type: 'string' } }, { title: id })) => ({
  id, status: 'loaded', schema, valid: true, issues: [],
});

describe('buildSdl', () => {
  it('builds from the usable selected schemas and warns about the rest', () => {
    const schemas = [loaded('product'), loaded('article'), {
      id: 'broken', status: 'loaded', schema: {}, valid: false,
    }];
    const { sdl, warnings, errors } = buildSdl({
      schemaIds: ['broken', 'gone', 'product', 'article'], schemas,
    });
    assert.deepEqual(errors, []);
    assert.ok(sdl.includes('type Product @contentType(id: "product") {'));
    assert.ok(sdl.includes('type Article @contentType(id: "article") {'));
    assert.deepEqual(warnings.slice(0, 2), [
      { schemaId: 'broken', pointer: '', message: 'The schema is invalid and was skipped.' },
      { schemaId: 'gone', pointer: '', message: 'The schema no longer exists and was skipped.' },
    ]);
  });

  it('is empty without selected schemas', () => {
    assert.deepEqual(buildSdl({ schemas: [loaded('product')] }), { sdl: '', warnings: [], errors: [] });
  });

  it('fails when no selected schema is usable', () => {
    const { errors } = buildSdl({ schemaIds: ['gone'], schemas: [] });
    assert.deepEqual(messages(errors), ['There is no valid schema to generate from.']);
  });

  it('fails when a selected schema could not be read', () => {
    const schemas = [loaded('product'), { id: 'article', status: 'load-failed', valid: false }];
    const { warnings, errors } = buildSdl({ schemaIds: ['article', 'product'], schemas });
    assert.deepEqual(errors, [{ schemaId: 'article', pointer: '', message: 'The schema could not be loaded.' }]);
    assert.deepEqual(warnings, []);
  });
});
