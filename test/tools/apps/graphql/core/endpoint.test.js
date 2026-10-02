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
import {
  createConfig, getEndpointHref, getEndpointPath, isValidEndpointName,
  NO_SCHEMAS_MESSAGE, parseConfig, serializeEndpoint, validateConfig, validateEndpointName,
} from '../../../../../tools/apps/graphql/core/endpoint.js';

describe('config', () => {
  it('normalises schemas to a unique sorted list', () => {
    assert.deepEqual(createConfig({ name: 'a', schemas: ['b'] }), { name: 'a', schemas: ['b'] });
    assert.deepEqual(createConfig({ name: 'a', schemas: ['b', 'a', 'b', ''] }), { name: 'a', schemas: ['a', 'b'] });
  });

  it('round-trips through serialize and parse, taking the name from the path', () => {
    const text = serializeEndpoint({ config: { name: 'x', schemas: ['s'] }, generatedAt: 'now', sdl: 'x' });
    assert.deepEqual(parseConfig({ text, name: 'y' }).config, { name: 'y', schemas: ['s'] });
  });

  it('ignores unknown keys', () => {
    const text = '{"description":"d","name":"x","schemas":["b","a"]}';
    assert.deepEqual(parseConfig({ text, name: 'x' }).config, { name: 'x', schemas: ['a', 'b'] });
  });

  it('reports invalid configurations', () => {
    assert.equal(typeof parseConfig({ text: '{', name: 'a' }).error, 'string');
    assert.equal(typeof parseConfig({ text: '[]', name: 'a' }).error, 'string');
  });

  it('validates endpoint names', () => {
    assert.equal(validateEndpointName({ name: 'marketing-v2' }), undefined);
    assert.equal(typeof validateEndpointName({ name: '' }), 'string');
    assert.equal(typeof validateEndpointName({ name: 'Bad Name' }), 'string');
    assert.equal(typeof validateEndpointName({ name: '1abc' }), 'string');
    assert.equal(typeof validateEndpointName({ name: 'a'.repeat(64) }), 'string');
    assert.ok(validateEndpointName({ name: 'dup', existing: ['dup'] }).includes('already exists'));
    assert.equal(validateEndpointName({ name: 'global' }), undefined);
    assert.equal(validateEndpointName({ name: 'ab' }), 'The endpoint name must be 3–32 characters long.');
    assert.equal(validateEndpointName({ name: 'web' }), undefined);
    assert.equal(validateEndpointName({ name: 'abcd' }), undefined);
    assert.equal(validateEndpointName({ name: 'a'.repeat(32) }), undefined);
    assert.equal(validateEndpointName({ name: 'a'.repeat(33) }), 'The endpoint name must be 3–32 characters long.');
    assert.deepEqual([isValidEndpointName('main'), isValidEndpointName('ab'), isValidEndpointName(3)], [true, false, false]);
  });

  it('validates configs to store', () => {
    assert.equal(validateConfig({ name: 'main', schemas: ['a'] }), undefined);
    assert.equal(validateConfig({ name: 'main', schemas: [] }), NO_SCHEMAS_MESSAGE);
    assert.ok(validateConfig({ name: 'Bad', schemas: ['a'] }).includes('lowercase'));
  });
});

describe('endpoint URL', () => {
  const args = { name: 'shop', org: 'acme', site: 'web' };

  it('fills the pattern placeholders', () => {
    // eslint-disable-next-line no-template-curly-in-string
    const pattern = 'https://gql.example/graphql/${endpoint}?org=${org}&site=${site}';
    assert.equal(getEndpointHref({ pattern, ...args }), 'https://gql.example/graphql/shop?org=acme&site=web');
  });

  it('fills repeated placeholders and encodes values', () => {
    // eslint-disable-next-line no-template-curly-in-string
    const pattern = 'https://gql.example/${org}/${org}/${site}';
    assert.equal(getEndpointHref({ pattern, ...args, org: 'a&b' }), 'https://gql.example/a%26b/a%26b/web');
  });

  it('falls back to the engine path without a pattern', () => {
    assert.equal(getEndpointPath('shop'), '/graphql/shop');
    assert.equal(getEndpointHref(args), '/graphql/shop');
  });
});

describe('endpoint document', () => {
  it('stores the normalised config with the generated SDL', () => {
    const config = { name: 'e', schemas: ['b', 'a', 'b'], isNew: true };
    const text = serializeEndpoint({ config, generatedAt: 'now', sdl: 'type Query { a: String }' });
    assert.equal(text, JSON.stringify({
      name: 'e', schemas: ['a', 'b'], generatedAt: 'now', sdl: 'type Query { a: String }',
    }, null, 2));
  });
});
