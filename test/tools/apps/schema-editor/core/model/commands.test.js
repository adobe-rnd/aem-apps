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
import { serializeSchema } from '../../../../../../tools/apps/schema-editor/core/model/serialize.js';
import { createNode, createRefNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import {
  CommandError,
  insertNode,
  moveNode,
  removeNode,
  duplicateNode,
  updateNode,
  changeElement,
  addDef,
  renameDef,
  deleteDef,
  detachRef,
  makeComponent,
  lockKeys,
} from '../../../../../../tools/apps/schema-editor/core/model/commands.js';
import {
  findNode, breadcrumb, cyclicDefs, wouldCreateCycle, refUsages, labelOf,
} from '../../../../../../tools/apps/schema-editor/core/model/query.js';
import { createHistory } from '../../../../../../tools/apps/schema-editor/core/model/history.js';
import { COMPLETE_EXAMPLE } from './fixtures.js';

const load = (json) => parseSchema(json, { name: 'test' }).model;
const child = (model, key, parent = model.root) => parent.children.find((c) => c.key === key);

const BASE = {
  type: 'object',
  title: 'Root',
  required: ['a'],
  properties: {
    a: {
      type: 'string', title: 'A', maxLength: 5, default: 'hi',
    },
    b: { type: 'integer', title: 'B', minimum: 1 },
    g: { type: 'object', title: 'G', properties: { x: { type: 'string', title: 'X' } } },
    l: { type: 'array', title: 'L', items: { type: 'string', title: 'Item' } },
  },
};

describe('schema model query', () => {
  it('finds nodes with pointers and breadcrumbs', () => {
    const model = load(COMPLETE_EXAMPLE);
    const links = child(model, 'links');
    const url = child(model, 'url', links.item);
    const entry = findNode(model, url.id);
    expect(entry.pointer).to.equal('/properties/links/items/properties/url');
    expect(entry.parent.id).to.equal(links.item.id);
    expect(breadcrumb(model, url.id)).to.deep.equal(['Project', 'Links', 'Link', 'URL']);
    const street = model.defs[0].node.children[0];
    expect(findNode(model, street.id).pointer).to.equal('/$defs/Address/properties/street');
    expect(breadcrumb(model, street.id)).to.deep.equal(['Address', 'Street']);
    expect(labelOf(model, child(model, 'owner'))).to.equal('Contact');
  });

  it('detects component cycles', () => {
    const model = load(COMPLETE_EXAMPLE);
    const [address, contact] = model.defs;
    expect(cyclicDefs(model)).to.have.length(0);
    expect(wouldCreateCycle(model, address.node.id, createRefNode(contact))).to.equal(true);
    expect(wouldCreateCycle(model, model.root.id, createRefNode(contact))).to.equal(false);
    expect(refUsages(model, contact.id)).to.have.length(3);
  });
});

describe('schema model commands', () => {
  it('inserts with unique keys and never mutates the input', () => {
    const model = load(BASE);
    const before = JSON.stringify(model);
    const { model: next, nodeId } = insertNode(model, { parentId: model.root.id, index: 1, node: createNode('text', { title: 'A' }) });
    expect(JSON.stringify(model)).to.equal(before);
    expect(next.root.children.map((c) => c.key)).to.deep.equal(['a', 'a2', 'b', 'g', 'l']);
    expect(findNode(next, nodeId).node.key).to.equal('a2');
    expect(next.defs).to.equal(model.defs);
    expect(next.root.children[3]).to.equal(model.root.children[2]);
  });

  it('fills an empty list slot and refuses a filled one', () => {
    let model = load(BASE);
    const l = child(model, 'l');
    expect(() => insertNode(model, { parentId: l.id, node: createNode('text') }))
      .to.throw(CommandError);
    model = removeNode(model, { nodeId: l.item.id }).model;
    model = insertNode(model, { parentId: l.id, node: { ...createNode('text', { siblingKeys: [] }), required: true } }).model;
    const { item } = child(model, 'l');
    expect(item).to.not.have.any.keys('key', 'required');

    const date = createNode('date');
    model = insertNode(model, { parentId: l.id, node: date, replace: true }).model;
    expect(child(model, 'l').item.id).to.equal(date.id);
  });

  it('moves within and across parents', () => {
    let model = load(BASE);
    const a = child(model, 'a');
    model = moveNode(model, { nodeId: a.id, parentId: model.root.id, index: 3 }).model;
    expect(model.root.children.map((c) => c.key)).to.deep.equal(['b', 'g', 'a', 'l']);
    const g = child(model, 'g');
    model = moveNode(model, { nodeId: a.id, parentId: g.id, index: 0 }).model;
    expect(child(model, 'g').children.map((c) => c.key)).to.deep.equal(['a', 'x']);
    expect(serializeSchema(model).properties.g.required).to.deep.equal(['a']);
    expect(() => moveNode(model, { nodeId: g.id, parentId: g.id, index: 0 }))
      .to.throw(CommandError);
  });

  it('re-keys moved nodes that collide', () => {
    let model = load(BASE);
    const g = child(model, 'g');
    model = insertNode(model, { parentId: g.id, node: createNode('text', { title: 'A', siblingKeys: ['x'] }) }).model;
    const inner = child(model, 'a', child(model, 'g'));
    model = moveNode(model, { nodeId: inner.id, parentId: model.root.id, index: 0 }).model;
    expect(model.root.children[0].key).to.equal('a2');
  });

  it('duplicates with new ids and keys', () => {
    const model = load(BASE);
    const g = child(model, 'g');
    const { model: next, nodeId } = duplicateNode(model, { nodeId: g.id });
    const copy = findNode(next, nodeId).node;
    expect(copy.key).to.equal('g2');
    expect(copy.children[0].id).to.not.equal(g.children[0].id);
    expect(next.root.children[3].id).to.equal(nodeId);
  });

  it('syncs keys with titles until locked or edited', () => {
    const base = load(BASE);
    let { model } = insertNode(base, { parentId: base.root.id, node: createNode('text', { siblingKeys: [] }) });
    const { id } = model.root.children.at(-1);
    model = updateNode(model, { nodeId: id, patch: { title: 'Publish date' } }).model;
    expect(findNode(model, id).node.key).to.equal('publishDate');
    model = updateNode(model, { nodeId: id, patch: { key: 'pub' } }).model;
    model = updateNode(model, { nodeId: id, patch: { title: 'Other' } }).model;
    expect(findNode(model, id).node).to.include({ key: 'pub', keyManual: true });
    const a = child(model, 'a');
    model = updateNode(model, { nodeId: a.id, patch: { title: 'Alpha', description: undefined } }).model;
    expect(child(model, 'a').title).to.equal('Alpha');
  });

  it('clears a default that is no longer a choice', () => {
    let model = load({
      type: 'object',
      title: 'R',
      properties: {
        s: {
          type: 'string', title: 'S', enum: ['x', 'y'], default: 'y',
        },
      },
    });
    const s = child(model, 's');
    model = updateNode(model, { nodeId: s.id, patch: { enum: ['x'] } }).model;
    expect(child(model, 's')).to.not.have.property('default');
  });

  it('changes elements within and across classes', () => {
    let model = load(BASE);
    const a = child(model, 'a');
    let result = changeElement(model, { nodeId: a.id, element: 'longText' });
    expect(child(result.model, 'a')).to.include({
      variant: 'long-text', maxLength: 5, default: 'hi', required: true,
    });
    result = changeElement(result.model, { nodeId: a.id, element: 'date' });
    expect(result.dropped).to.have.members(['maxLength', 'default']);
    model = changeElement(model, { nodeId: a.id, element: 'choice' }).model;
    expect(child(model, 'a').enum).to.deep.equal(['Option 1', 'Option 2', 'hi']);

    const g = child(model, 'g');
    model = changeElement(model, { nodeId: g.id, element: 'list' }).model;
    expect(child(model, 'g').item.children[0].key).to.equal('x');
    model = changeElement(model, { nodeId: g.id, element: 'group' }).model;
    expect(child(model, 'g').children[0].key).to.equal('x');

    const b = child(model, 'b');
    model = changeElement(model, { nodeId: b.id, element: 'number' }).model;
    expect(child(model, 'b')).to.include({ kind: 'number', minimum: 1 });
    expect(() => changeElement(model, { nodeId: model.root.id, element: 'text' }))
      .to.throw(CommandError);
  });

  it('makes, detaches, renames and deletes components', () => {
    let model = load(BASE);
    const g = child(model, 'g');
    const made = makeComponent(model, { nodeId: g.id });
    model = made.model;
    expect(child(model, 'g')).to.include({ kind: 'ref', key: 'g', refDefId: made.defId });
    expect(serializeSchema(model).properties.g).to.deep.equal({ $ref: '#/$defs/G' });
    expect(serializeSchema(model).$defs.G.properties.x.title).to.equal('X');

    model = renameDef(model, { defId: made.defId, name: 'Thing' }).model;
    expect(serializeSchema(model).properties.g.$ref).to.equal('#/$defs/Thing');
    expect(() => renameDef(model, { defId: made.defId, name: 'bad/name' })).to.throw(CommandError);

    model = updateNode(model, { nodeId: g.id, patch: { title: 'Override' } }).model;
    const detached = detachRef(model, { nodeId: g.id }).model;
    expect(child(detached, 'g')).to.include({ kind: 'object', title: 'Override', key: 'g' });

    model = deleteDef(model, { defId: made.defId }).model;
    expect(model.defs).to.have.length(0);
    expect(child(model, 'g').kind).to.equal('object');
  });

  it('adds components and rejects cycles', () => {
    let model = load(BASE);
    const added = addDef(model, { name: 'Card' });
    model = added.model;
    const def = model.defs[0];
    const ref = createRefNode(def, { siblingKeys: [] });
    expect(() => insertNode(model, { parentId: def.node.id, node: ref })).to.throw(CommandError);
    expect(() => addDef(model, { name: 'Card' })).to.throw(CommandError);
  });
});

describe('schema model history', () => {
  it('undoes, redoes and coalesces', () => {
    let time = 0;
    const history = createHistory({ limit: 3, now: () => time });
    const m = [0, 1, 2, 3, 4, 5].map((i) => ({ i }));
    history.push(m[0], m[1], { label: 'one' });
    history.push(m[1], m[2], { label: 'type', coalesceKey: 'n:title' });
    time = 500;
    history.push(m[2], m[3], { label: 'type', coalesceKey: 'n:title' });
    expect(history.undo().model).to.equal(m[1]);
    expect(history.redo().model).to.equal(m[3]);
    time = 5000;
    history.push(m[3], m[4], { label: 'a' });
    history.push(m[4], m[5], { label: 'b' });
    expect(history.undoLabel).to.equal('b');
    expect(history.undo().model).to.equal(m[4]);
    expect(history.undo().model).to.equal(m[3]);
    expect(history.undo().model).to.equal(m[1]);
    expect(history.undo()).to.equal(null);
    expect(history.canRedo).to.equal(true);
    history.push(m[1], m[2]);
    expect(history.canRedo).to.equal(false);
  });
});

describe('lockKeys', () => {
  it('locks every key and shares untouched nodes', () => {
    const { model } = parseSchema({ type: 'object', title: 'R', properties: {} });
    const node = createNode('text', { title: 'A', siblingKeys: [] });
    const { model: m1 } = insertNode(model, { parentId: model.root.id, node });
    expect(m1.root.children[0].keyLocked).to.not.equal(true);
    const locked = lockKeys(m1);
    expect(locked.root.children[0].keyLocked).to.equal(true);
    expect(lockKeys(locked).root).to.equal(locked.root);
  });
});
