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
import { parseSchema } from '../../../../../../tools/apps/schema-editor/core/model/parse.js';
import {
  lint, countIssues, checkValue, worstSeverity, testPattern,
} from '../../../../../../tools/apps/schema-editor/core/model/lint.js';
import { createNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import { insertNode } from '../../../../../../tools/apps/schema-editor/core/model/commands.js';
import { COMPLETE_EXAMPLE } from './fixtures.js';

const load = (json) => parseSchema(json, { name: 't' }).model;
const wrap = (props, extra = {}) => ({
  type: 'object', title: 'R', properties: props, ...extra,
});
const codes = (issues) => issues.map((i) => i.code);

describe('schema model lint', () => {
  it('R-2: the complete example has no errors or warnings', () => {
    const issues = lint(load(COMPLETE_EXAMPLE));
    const { error, warning } = countIssues(issues);
    expect({ error, warning }).to.deep.equal({ error: 0, warning: 0 });
  });

  const CASES = [
    ['R4-missing-title', { type: 'string' }, 'error'],
    ['R1-missing-type', { title: 'T', properties: {} }, 'error'],
    ['R3-type-array', { type: ['string', 'null'], title: 'T' }, 'error'],
    ['R2-unsupported-type', { type: 'null', title: 'T' }, 'error'],
    ['R6-missing-items', { type: 'array', title: 'T' }, 'error'],
    ['R6-tuple-items', { type: 'array', title: 'T', items: [] }, 'error'],
    ['R8-external-ref', { $ref: 'https://x/y.json' }, 'error'],
    ['R8-unresolved-ref', { $ref: '#/$defs/Nope' }, 'error'],
    ['R8-non-defs-ref', { $ref: '#/properties/q' }, 'warning'],
    ['unsupported-composition', { oneOf: [] }, 'error'],
    ['string-exclusive', {
      type: 'string', title: 'T', enum: ['a'], format: 'date',
    }, 'warning'],
    ['unsupported-format', { type: 'string', title: 'T', format: 'email' }, 'warning'],
    ['keyword-not-applicable', { type: 'number', title: 'T', minLength: 1 }, 'warning'],
    ['unsupported-keyword', { type: 'number', title: 'T', multipleOf: 2 }, 'warning'],
    ['ignored-keyword', { type: 'number', title: 'T', examples: [1] }, 'info'],
    ['enum-empty', { type: 'string', title: 'T', enum: [] }, 'error'],
    ['enum-duplicate', { type: 'string', title: 'T', enum: ['a', 'a'] }, 'error'],
    ['enum-non-string', { type: 'string', title: 'T', enum: [1] }, 'error'],
    ['range-length', {
      type: 'string', title: 'T', minLength: 5, maxLength: 2,
    }, 'error'],
    ['range-number', {
      type: 'number', title: 'T', minimum: 5, maximum: 2,
    }, 'error'],
    ['range-items', {
      type: 'array', title: 'T', minItems: 5, maxItems: 2, items: { type: 'string', title: 'I' },
    }, 'error'],
    ['negative-length', { type: 'string', title: 'T', minLength: -1 }, 'error'],
    ['integer-bounds', { type: 'integer', title: 'T', minimum: 1.5 }, 'warning'],
    ['invalid-pattern', { type: 'string', title: 'T', pattern: '(' }, 'error'],
    ['pattern-for-closed-set', { type: 'string', title: 'T', pattern: '^(a|b|c)$' }, 'info'],
    ['default-invalid', {
      type: 'string', title: 'T', maxLength: 2, default: 'abc',
    }, 'error'],
    ['default-invalid', {
      type: 'string', title: 'T', format: 'date-time', default: '2020-01-01T10:00:30Z',
    }, 'error'],
    ['default-invalid', { type: 'integer', title: 'T', default: 1.5 }, 'error'],
    ['empty-group', { type: 'object', title: 'T', properties: {} }, 'error'],
    ['ref-sibling', { $ref: '#/$defs/D', type: 'object' }, 'warning'],
    ['choice-constraint', {
      type: 'string', title: 'T', enum: ['a'], maxLength: 3,
    }, 'info'],
  ];

  CASES.forEach(([code, prop, severity]) => {
    it(`reports ${code} (${JSON.stringify(prop)})`, () => {
      const model = load(wrap({ p: prop }, { $defs: { D: { type: 'object', title: 'D', properties: { a: { type: 'string', title: 'A' } } } } }));
      const issue = lint(model).find((i) => i.code === code && i.schemaPath === '/properties/p');
      expect(issue, code).to.not.equal(undefined);
      expect(issue.severity).to.equal(severity);
      if (issue.fix) {
        const fixed = issue.fix.run(model).model;
        const again = lint(fixed).find((i) => i.code === code && i.nodeId === issue.nodeId);
        expect(again, `${code} after fix`).to.equal(undefined);
      }
    });
  });

  it('reports an empty schema and empty groups as errors that block saving', () => {
    const model = load({
      type: 'object', title: 'S', properties: {}, $defs: { D: { type: 'object', title: 'D', properties: {} } },
    });
    const issues = lint(model).filter((i) => i.code === 'empty-group');
    expect(issues.map((i) => [i.schemaPath, i.severity, i.message])).to.deep.equal([
      ['', 'error', 'Add at least one field to the schema.'],
      ['/$defs/D', 'error', 'Add at least one field to this Group.'],
    ]);
  });

  it('reports key problems with fixes', () => {
    const model = load(wrap({ metadata: { type: 'string', title: 'Meta' }, '1x': { type: 'string', title: 'One' } }));
    const issues = lint(model);
    expect(codes(issues)).to.include.members(['R10-reserved-key', 'R9-invalid-key']);
    let fixed = model;
    issues.filter((i) => i.field === 'key').forEach((i) => { fixed = i.fix.run(fixed).model; });
    expect(fixed.root.children.map((c) => c.key)).to.deep.equal(['meta', 'one']);
  });

  it('reports duplicate keys, required-unknown and readonly-required', () => {
    let model = load(wrap(
      { a: { type: 'string', title: 'A', readOnly: true } },
      { required: ['a', 'ghost'] },
    ));
    const node = { ...createNode('text', { title: 'A' }), key: 'a', keyManual: true };
    model = insertNode(model, { parentId: model.root.id, node }).model;
    model.root.children[1].key = 'a';
    const found = codes(lint(model));
    expect(found).to.include.members(['dup-key', 'required-unknown', 'readonly-required-nodefault']);
  });

  it('reports component problems', () => {
    const model = load({
      type: 'object',
      title: 'R',
      properties: { n: { $ref: '#/$defs/Node' } },
      $defs: {
        Node: { type: 'object', title: 'Node', properties: { next: { $ref: '#/$defs/Node' } } },
        Unused: { type: 'object', title: 'U', properties: { a: { type: 'string', title: 'A' } } },
      },
    });
    const issues = lint(model);
    expect(codes(issues)).to.include.members(['ref-cycle', 'unused-component']);
    expect(issues[0].severity).to.equal('error');
  });

  it('checks values against nodes', () => {
    expect(checkValue({ kind: 'string', variant: 'time' }, '10:30')).to.equal(null);
    expect(checkValue({ kind: 'string', variant: 'time' }, '25:00')).to.be.a('string');
    expect(checkValue({ kind: 'string', variant: 'date' }, '2024-02-29')).to.equal(null);
    expect(checkValue({ kind: 'string', variant: 'date-time' }, '2024-02-29T10:00:00Z')).to.equal(null);
    expect(checkValue({ kind: 'string', variant: 'text', pattern: '^a' }, 'ba')).to.be.a('string');
    expect(checkValue({ kind: 'number', minimum: 0 }, -1)).to.be.a('string');
    expect(checkValue({ kind: 'boolean' }, false)).to.equal(null);
  });

  it('returns errors first', () => {
    const issues = lint(load(wrap({ a: { type: 'string', title: 'A', examples: [] }, b: { type: 'string' } })));
    expect(issues[0].code).to.equal('R4-missing-title');
  });
});

describe('issue helpers', () => {
  it('picks the most severe level', () => {
    const of = (...levels) => levels.map((severity) => ({ severity }));
    expect(worstSeverity(of('info', 'warning'))).to.equal('warning');
    expect(worstSeverity(of('warning', 'error', 'info'))).to.equal('error');
    expect(worstSeverity(of('info'))).to.equal('info');
    expect(worstSeverity([])).to.equal(null);
    expect(worstSeverity(undefined)).to.equal(null);
  });

  it('tries a sample against a pattern', () => {
    expect(testPattern('', 'x').state).to.equal('empty');
    expect(testPattern('(', 'x').state).to.equal('invalid');
    expect(testPattern('^a', '').state).to.equal('empty');
    expect(testPattern('^a', 'abc').state).to.equal('match');
    expect(testPattern('^a', 'b').state).to.equal('nomatch');
  });
});
