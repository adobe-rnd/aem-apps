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
  camel, pascal, singular, toFieldName, toTypeName,
} from '../../../../tools/apps/graphql/utils/sdl.js';

describe('graphql naming', () => {
  it('pascal-cases kebab, camel and spaced values', () => {
    assert.equal(pascal('my-type'), 'MyType');
    assert.equal(pascal('firstName'), 'FirstName');
    assert.equal(pascal('Line item'), 'LineItem');
  });

  it('prefixes names that do not start with a letter', () => {
    assert.equal(pascal('123abc'), 'T123abc');
    assert.equal(pascal(''), 'Type');
  });

  it('camel-cases values', () => {
    assert.equal(camel('blog-post'), 'blogPost');
  });

  it('singularises common plurals', () => {
    assert.equal(singular('Tags'), 'Tag');
    assert.equal(singular('Categories'), 'Category');
    assert.equal(singular('Address'), 'Address');
    assert.equal(singular('Status'), 'Status');
    assert.equal(singular('Matrix'), 'Matrix');
  });

  it('suffixes reserved type names', () => {
    assert.equal(toTypeName('query'), 'QueryType');
    assert.equal(toTypeName('date'), 'DateType');
    assert.equal(toTypeName('article'), 'Article');
  });

  it('sanitises field names', () => {
    assert.equal(toFieldName('first-name'), 'first_name');
    assert.equal(toFieldName('title'), 'title');
    assert.equal(toFieldName('1st'), '_1st');
    assert.equal(toFieldName('__typename'), 'f__typename');
  });
});
