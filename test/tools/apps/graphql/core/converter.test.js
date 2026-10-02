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

  it('emits list and by-path query fields tagged with the schema id', () => {
    const { sdl } = generateSdl({ schemas: [{ id: 'blog-post', schema: obj({ x: { type: 'string', title: 'X' } }) }] });
    assert.ok(sdl.includes('blogPostList(first: Int = 20, after: String): BlogPostConnection! @schema(id: "blog-post")'));
    assert.ok(sdl.includes('blogPostByPath(path: String!): BlogPostItem @schema(id: "blog-post")'));
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

  it('suffixes nested names that collide with envelope types', () => {
    const { sdl, warnings } = generateSdl({
      schemas: [{ id: 'order', schema: obj({ item: obj({ sku: { type: 'string', title: 'SKU' } }) }) }],
    });
    assert.ok(sdl.includes('item: OrderItem2'));
    assert.ok(sdl.includes('type OrderItem2 {'));
    assert.ok(messages(warnings)[0].includes('"OrderItem" is already used'));
  });

  it('suffixes reserved root names', () => {
    const { sdl } = generateSdl({ schemas: [{ id: 'query', schema: obj({ q: { type: 'string', title: 'Q' } }) }] });
    assert.ok(sdl.includes('type QueryType {'));
    assert.ok(sdl.includes('queryTypeList('));
  });

  it('reports an error when two schema ids produce the same type', () => {
    const schema = obj({ x: { type: 'string', title: 'X' } });
    const { sdl, errors } = generateSdl({
      schemas: [{ id: 'my-type', schema }, { id: 'my_type', schema }],
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].schemaId, 'my_type');
    assert.ok(sdl.includes('type MyType {'));
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

  it('maps an array without items to [JSON]', () => {
    const { sdl } = generateSdl({ schemas: [{ id: 'list', schema: obj({ tags: { type: 'array', title: 'Tags' } }) }] });
    assert.ok(sdl.includes('tags: [JSON]'));
  });

  it('escapes triple quotes in descriptions', () => {
    const { sdl } = generateSdl({ schemas: [{ id: 'q', schema: obj({ x: { type: 'string', title: 'Say """hi"""' } }) }] });
    assert.ok(sdl.includes('Say \\"""hi\\"""'));
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
    assert.ok(sdl.includes('type Product {'));
    assert.ok(sdl.includes('type Article {'));
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
