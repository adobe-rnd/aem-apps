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
import { annotateSchemas } from '../../../../../tools/apps/graphql/core/schemas.js';

const product = {
  type: 'object',
  properties: { title: { type: 'string' } },
};

describe('validation', () => {
  it('annotates schemas by load status and validator result', () => {
    const validate = (schema) => (schema.bad
      ? { valid: false, schemaIssues: [{ message: 'Nope.', schemaPath: '/properties/x' }] }
      : { valid: true });
    const result = annotateSchemas({
      schemas: [
        { id: 'a', status: 'loaded', schema: product },
        { id: 'b', status: 'loaded', schema: { bad: true } },
        { id: 'c', status: 'invalid-json' },
      ],
      validate,
    });
    assert.deepEqual(result.map(({ valid }) => valid), [true, false, false]);
    assert.deepEqual(result[1].issues, ['Nope (at #/properties/x)']);
    assert.ok(result[2].issues[0].includes('valid JSON'));
  });

  it('describes root issues and dedupes', () => {
    const issue = { reason: 'Bad', schemaPath: '/' };
    const validate = () => ({ valid: false, schemaIssues: [issue, issue] });
    const [result] = annotateSchemas({ schemas: [{ id: 'a', status: 'loaded', schema: product }], validate });
    assert.deepEqual(result.issues, ['Bad (at the schema root)']);
  });
});
