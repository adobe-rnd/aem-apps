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
  compareText, isSameSort, matchKeywords, toggleSort,
} from '../../../../../tools/apps/graphql/ui/utils/list.js';

describe('toggleSort', () => {
  it('sorts a new column ascending', () => {
    assert.deepEqual(toggleSort({ key: 'title', direction: 'descending' }, 'id'), { key: 'id', direction: 'ascending' });
    assert.deepEqual(toggleSort(undefined, 'id'), { key: 'id', direction: 'ascending' });
  });

  it('reverses the sorted column', () => {
    assert.deepEqual(toggleSort({ key: 'id', direction: 'ascending' }, 'id'), { key: 'id', direction: 'descending' });
    assert.deepEqual(toggleSort({ key: 'id', direction: 'descending' }, 'id'), { key: 'id', direction: 'ascending' });
  });
});

describe('isSameSort', () => {
  it('compares key and direction only', () => {
    assert.equal(isSameSort({ key: 'name', direction: 'ascending', label: 'A' }, { key: 'name', direction: 'ascending' }), true);
    assert.equal(isSameSort({ key: 'name', direction: 'ascending' }, { key: 'name', direction: 'descending' }), false);
    assert.equal(isSameSort(undefined, { key: 'name', direction: 'ascending' }), false);
  });
});

describe('compareText', () => {
  it('ignores case and orders numbers numerically', () => {
    assert.deepEqual(['b', 'A', 'item10', 'item2'].sort(compareText), ['A', 'b', 'item2', 'item10']);
  });
});

describe('matchKeywords', () => {
  const values = [{ a: 'Product', b: 'shop' }, { a: 'Article', b: undefined }];
  const fields = ({ a, b }) => [a, b];

  it('keeps everything for a blank query', () => {
    assert.equal(matchKeywords({ values, query: '  ', fields }), values);
  });

  it('keeps values where any keyword is in any field, ignoring case', () => {
    assert.deepEqual(matchKeywords({ values, query: 'SHOP', fields }), [values[0]]);
    assert.deepEqual(matchKeywords({ values, query: 'nope art', fields }), [values[1]]);
    assert.deepEqual(matchKeywords({ values, query: 'nope', fields }), []);
  });
});
