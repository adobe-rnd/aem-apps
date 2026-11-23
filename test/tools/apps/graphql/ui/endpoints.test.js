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
  filterEndpoints, sortEndpoints,
} from '../../../../../tools/apps/graphql/ui/endpoints-screen/helpers/endpoints.js';

const endpoints = ['products', 'blog-v10', 'blog-v2', 'articles'];

describe('filterEndpoints', () => {
  it('keeps names containing any keyword', () => {
    assert.deepEqual(filterEndpoints({ endpoints, query: 'BLOG' }), ['blog-v10', 'blog-v2']);
    assert.deepEqual(filterEndpoints({ endpoints, query: 'prod art' }), ['products', 'articles']);
    assert.deepEqual(filterEndpoints({ endpoints, query: '' }), endpoints);
  });
});

describe('sortEndpoints', () => {
  it('sorts by name, numbers numerically, without changing the input', () => {
    const copy = [...endpoints];
    assert.deepEqual(sortEndpoints({ endpoints }), ['articles', 'blog-v2', 'blog-v10', 'products']);
    assert.deepEqual(
      sortEndpoints({ endpoints, sort: { key: 'name', direction: 'descending' } }),
      ['products', 'blog-v10', 'blog-v2', 'articles'],
    );
    assert.deepEqual(endpoints, copy);
  });
});
