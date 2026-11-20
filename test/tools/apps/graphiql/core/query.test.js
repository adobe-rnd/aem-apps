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
import { firstListField, listQuery } from '../../../../../tools/apps/graphiql/core/query.js';

describe('listQuery', () => {
  it('queries the first page of a list field', () => {
    assert.match(listQuery('offerList'), /^\{\n {2}offerList\(first: 10\) \{/);
    assert.equal(listQuery(undefined), '{\n  \n}\n');
  });
});

describe('firstListField', () => {
  it('finds the first list query of an introspection result', () => {
    const schema = {
      __schema: {
        queryType: { name: 'Query' },
        types: [
          { name: 'Other', fields: [{ name: 'xList' }] },
          { name: 'Query', fields: [{ name: 'node' }, { name: 'offerList' }, { name: 'faqList' }] },
        ],
      },
    };
    assert.equal(firstListField(schema), 'offerList');
    assert.equal(firstListField({ __schema: { queryType: { name: 'Query' }, types: [] } }), undefined);
  });
});
