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
import { expect } from '../../expect.js';
import { checkWithSdk } from '../../../../../../tools/apps/schema-editor/core/model/sdk.js';
import { parseSchema } from '../../../../../../tools/apps/schema-editor/core/model/parse.js';

const { model } = parseSchema({
  type: 'object',
  title: 'R',
  properties: {
    group: { type: 'object', title: 'G', properties: { p: { type: 'string', title: 'P' } } },
  },
}, { name: 't' });
const group = model.root.children[0];

describe('schema model SDK check', () => {
  it('is skipped without a validator', () => {
    expect(checkWithSdk(model)).to.deep.equal({ valid: true, issues: [] });
  });

  it('passes the serialized schema to the validator', () => {
    let input;
    checkWithSdk(model, (arg) => {
      input = arg;
      return { valid: true };
    });
    expect(input.schema.properties.group.properties.p).to.include({ type: 'string' });
  });

  it('maps SDK issues to the nearest node of their schema path', () => {
    const { valid, issues } = checkWithSdk(model, () => ({
      valid: false,
      schemaIssues: [
        { reason: 'invalid-pattern', message: 'Bad', schemaPath: '/properties/group/properties/p/pattern' },
        { reason: 'unsupported', message: 'Nope', schemaPath: '/properties/group/minProperties' },
        { reason: 'odd', message: 'Root' },
      ],
    }));
    expect(valid).to.equal(false);
    expect(issues.map((i) => i.nodeId))
      .to.deep.equal([group.children[0].id, group.id, model.root.id]);
    expect(issues[0]).to.include({ code: 'sdk-invalid-pattern', severity: 'error', source: 'sdk' });
  });

  it('reports a validator crash on the root', () => {
    const { valid, issues } = checkWithSdk(model, () => { throw new Error('boom'); });
    expect(valid).to.equal(false);
    expect(issues[0]).to.include({ code: 'sdk-crash', nodeId: model.root.id });
    expect(issues[0].message).to.contain('boom');
  });
});
