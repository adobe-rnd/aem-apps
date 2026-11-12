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
import { serializeSchema, stringifySchema } from '../../../../../../tools/apps/schema-editor/core/model/serialize.js';
import { createNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import { COMPLETE_EXAMPLE } from './fixtures.js';

const roundTrip = (json) => serializeSchema(parseSchema(json, { name: 'x' }).model);

function stripIds(value) {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => k !== 'id' && k !== 'refDefId')
      .map(([k, v]) => [k, stripIds(v)]));
  }
  return value;
}

describe('schema model parse/serialize', () => {
  it('R-2: round-trips the complete example', () => {
    expect(roundTrip(COMPLETE_EXAMPLE)).to.deep.equal(COMPLETE_EXAMPLE);
  });

  it('maps the complete example onto model fields', () => {
    const { model } = parseSchema(COMPLETE_EXAMPLE, { name: 'project' });
    expect(model.name).to.equal('project');
    expect(model.defs.map((d) => d.name)).to.deep.equal(['Address', 'Contact', 'Milestone']);
    const byKey = Object.fromEntries(model.root.children.map((c) => [c.key, c]));
    expect(byKey.title).to.include({ required: true, keyLocked: true, keyManual: true });
    expect(byKey.summary.variant).to.equal('long-text');
    expect(byKey.status).to.include({ variant: 'choice', default: 'Planning' });
    expect(byKey.publishedAt.variant).to.equal('date-time');
    expect(byKey.archived.default).to.equal(false);
    expect(byKey.owner).to.include({ kind: 'ref', refDefId: model.defs[1].id });
    expect(byKey.tags.item).to.include({ kind: 'string', title: 'Tag' });
    expect(byKey.links.item.children.map((c) => c.key)).to.deep.equal(['label', 'url']);
    expect(Object.values(byKey).every((c) => !c.extras)).to.equal(true);
  });

  it('serializes keywords in a deterministic order', () => {
    const json = roundTrip({
      required: ['a'],
      properties: {
        a: {
          pattern: 'x', title: 'A', type: 'string', maxLength: 3,
        },
      },
      title: 'Root',
      type: 'object',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    });
    expect(Object.keys(json)).to.deep.equal(['$schema', 'type', 'title', 'required', 'properties']);
    expect(Object.keys(json.properties.a)).to.deep.equal(['type', 'title', 'maxLength', 'pattern']);
  });

  it('applies string precedence and keeps losing keywords as extras', () => {
    const { model } = parseSchema({
      type: 'object',
      title: 'R',
      properties: {
        a: {
          type: 'string', title: 'A', enum: ['x'], format: 'date', 'x-semantic-type': 'long-text',
        },
        b: { type: 'string', title: 'B', format: 'email' },
      },
    });
    const [a, b] = model.root.children;
    expect(a.variant).to.equal('choice');
    expect(a.extras).to.deep.equal({ format: 'date', 'x-semantic-type': 'long-text' });
    expect(b.variant).to.equal('text');
    expect(b.extras).to.deep.equal({ format: 'email' });
  });

  it('R-3: preserves unsupported nodes and extras verbatim', () => {
    const input = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'urn:x',
      type: 'object',
      title: 'R',
      $comment: 'hello',
      additionalProperties: false,
      properties: {
        any: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        nullable: { type: ['string', 'null'], title: 'N' },
        nul: { type: 'null' },
        ext: { $ref: 'https://example.com/x.json' },
        local: { $ref: '#/properties/any' },
        missing: { $ref: '#/$defs/Nope' },
        tuple: { type: 'array', title: 'T', items: [{ type: 'string' }] },
        num: {
          type: 'number', title: 'Num', minLength: 2, examples: [1],
        },
        refWithType: { $ref: '#/$defs/D', type: 'object' },
      },
      $defs: { D: { type: 'object', title: 'D', properties: {} } },
    };
    const { model } = parseSchema(input);
    const reasons = Object.fromEntries(model.root.children.map((c) => [c.key, c.reason]));
    expect(reasons).to.include({
      any: 'unsupported-composition',
      nullable: 'R3-type-array',
      nul: 'R2-unsupported-type',
      ext: 'R8-external-ref',
      local: 'R8-non-defs-ref',
      missing: 'R8-unresolved-ref',
      tuple: 'R6-tuple-items',
    });
    expect(model.rootExtras).to.deep.equal({ $schema: input.$schema, $id: 'urn:x' });
    const out = serializeSchema(model);
    expect(out).to.deep.equal(input);
  });

  it('records missing type, unknown required names and missing items', () => {
    const { model } = parseSchema({
      type: 'object',
      title: 'R',
      required: ['ghost', 'list'],
      properties: {
        inferred: { title: 'I', properties: {} },
        list: { type: 'array', title: 'L' },
      },
    });
    const [inferred, list] = model.root.children;
    expect(inferred).to.include({ kind: 'object', missingType: true });
    expect(list).to.include({ kind: 'array', item: null, required: true });
    expect(model.root.requiredUnknown).to.deep.equal(['ghost']);
    const out = serializeSchema(model);
    expect(out.required).to.deep.equal(['list']);
    expect(out.properties.inferred).to.not.have.property('type');
  });

  it('marks non-object/array roots as unsupported (R11)', () => {
    expect(parseSchema({ type: 'string', title: 'S' }).model.root.reason).to.equal('R11-root-type');
    expect(parseSchema('nope').model.root.reason).to.equal('R11-root-type');
    expect(parseSchema({ type: 'array', title: 'A', items: { type: 'string', title: 'I' } })
      .model.root.kind).to.equal('array');
  });

  it('R-1: round-trips models built from elements', () => {
    const group = createNode('group', { siblingKeys: [] });
    group.children = [
      createNode('text', { siblingKeys: [] }),
      { ...createNode('integer', { siblingKeys: ['text'] }), minimum: 1, default: 2 },
    ];
    const list = createNode('list', { siblingKeys: ['group'] });
    list.item = createNode('dateTime');
    const root = createNode('group', { title: 'Root' });
    root.children = [
      group,
      list,
      { ...createNode('choice', { siblingKeys: ['group', 'list'] }), required: true },
      { ...createNode('boolean', { siblingKeys: ['group', 'list', 'choice'] }), readOnly: true },
      createNode('longText', { siblingKeys: ['group', 'list', 'choice', 'boolean'] }),
    ];
    const model = {
      version: 1, name: 'x', root, defs: [], rootExtras: {},
    };
    const reparsed = parseSchema(serializeSchema(model), { name: 'x' }).model;
    const normalize = (m) => stripIds(JSON.parse(JSON.stringify(m)));
    const lockKeys = (node) => {
      if (node.key) Object.assign(node, { keyLocked: true, keyManual: true });
      (node.children ?? []).forEach(lockKeys);
      if (node.item) lockKeys(node.item);
    };
    lockKeys(root);
    expect(normalize(reparsed)).to.deep.equal(normalize(model));
    expect(stringifySchema(reparsed)).to.equal(stringifySchema(model));
  });

  it('lists required keys once, in property order, while keys are duplicated', () => {
    const root = createNode('group', { title: 'Root' });
    root.children = [
      { ...createNode('text', { siblingKeys: [] }), key: 'name' },
      { ...createNode('number', { siblingKeys: [] }), key: 'age', required: true },
      { ...createNode('longText', { siblingKeys: [] }), key: 'name', required: true },
      { ...createNode('date', { siblingKeys: [] }), key: 'name', required: true },
    ];
    const json = serializeSchema({
      version: 1, name: 'x', root, defs: [], rootExtras: {},
    });
    expect(json.required).to.deep.equal(['name', 'age']);
    expect(JSON.stringify(serializeSchema(parseSchema(json, { name: 'x' }).model)))
      .to.equal(JSON.stringify(json));
  });
});
