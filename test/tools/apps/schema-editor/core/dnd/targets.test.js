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
import { beforeEach, describe, it } from 'node:test';
import { expect } from '../../expect.js';
import {
  canDrop, dropHint, targetKey, toInsertTarget, insertionPoint, replacedItem,
} from '../../../../../../tools/apps/schema-editor/core/dnd/targets.js';
import { parseSchema } from '../../../../../../tools/apps/schema-editor/core/model/parse.js';
import { makeComponent, insertNode } from '../../../../../../tools/apps/schema-editor/core/model/commands.js';
import { createRefNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import { ARTICLE, nodeByKey } from '../../fixtures.js';

const palette = (id, type = 'element') => ({ source: 'palette', item: { type, id, label: id } });
const card = (nodeId) => ({ source: 'card', nodeId });

describe('dnd targets', () => {
  let model;
  let root;
  let author;
  let tags;

  beforeEach(() => {
    ({ model } = parseSchema(ARTICLE, { name: 'article' }));
    root = model.root;
    author = nodeByKey(model, 'author');
    tags = nodeByKey(model, 'tags');
  });

  describe('canDrop', () => {
    it('lets elements drop into Groups and List slots', () => {
      expect(canDrop(model, palette('text'), { parentId: root.id, index: 0 }).ok).to.equal(true);
      const slot = canDrop(model, palette('text'), { parentId: tags.id, slot: true });
      expect(slot).to.deep.equal({ ok: true, replace: true });
    });

    it('rejects targets that are not containers or the wrong kind of place', () => {
      const headline = nodeByKey(model, 'headline');
      expect(canDrop(model, palette('text'), { parentId: headline.id, index: 0 }).reason)
        .to.contain('Only Groups and Lists');
      expect(canDrop(model, palette('text'), { parentId: root.id, slot: true }).ok).to.equal(false);
      expect(canDrop(model, palette('text'), { parentId: tags.id, index: 0 }).ok).to.equal(false);
      expect(canDrop(model, palette('text'), null).ok).to.equal(false);
      expect(canDrop(model, null, { parentId: root.id, index: 0 }).ok).to.equal(false);
    });

    it('rejects moving a card into itself or its descendants', () => {
      expect(canDrop(model, card(author.id), { parentId: author.id, index: 0 }).reason)
        .to.contain('into itself');
      expect(canDrop(model, card(root.id), { parentId: author.id, index: 0 }).reason)
        .to.contain('cannot be moved');
    });

    it('treats dropping a card where it already is as a no-op', () => {
      const index = root.children.indexOf(author);
      expect(canDrop(model, card(author.id), { parentId: root.id, index }).noop).to.equal(true);
      expect(canDrop(model, card(author.id), { parentId: root.id, index: index + 1 }).noop)
        .to.equal(true);
      expect(canDrop(model, card(author.id), { parentId: root.id, index: 0 }).ok).to.equal(true);
      const item = tags.item.id;
      expect(canDrop(model, card(item), { parentId: tags.id, slot: true }).noop).to.equal(true);
    });

    it('rejects components that would contain themselves', () => {
      ({ model } = makeComponent(model, { nodeId: author.id, name: 'Person' }));
      const def = model.defs[0];
      const inside = { parentId: def.node.id, index: 0 };
      expect(canDrop(model, palette(def.id, 'component'), inside).reason)
        .to.contain('cannot contain itself');
      expect(canDrop(model, palette(def.id, 'component'), { parentId: model.root.id, index: 0 }).ok)
        .to.equal(true);

      const ref = createRefNode(def, { siblingKeys: [] });
      ({ model } = insertNode(model, { parentId: model.root.id, index: 0, node: ref }));
      expect(canDrop(model, card(ref.id), inside).reason).to.contain('cannot contain itself');
    });

    it('keeps moved fields in their own tree: the schema or one component', () => {
      ({ model } = makeComponent(model, { nodeId: author.id, name: 'Person' }));
      const def = model.defs[0];
      const [field] = def.node.children;
      const headline = nodeByKey(model, 'headline');
      expect(canDrop(model, card(headline.id), { parentId: def.node.id, index: 0 }).reason)
        .to.contain('within their own tree');
      expect(canDrop(model, card(field.id), { parentId: model.root.id, index: 0 }).reason)
        .to.contain('within their own tree');
      expect(canDrop(model, card(field.id), { parentId: def.node.id, index: 2 }).ok).to.equal(true);
    });
  });

  it('hints what an accepted drop does: insert, move or replace', () => {
    const gap = { parentId: root.id, index: 0 };
    const slot = { parentId: tags.id, slot: true };
    expect(dropHint(palette('text'), canDrop(model, palette('text'), gap))).to.equal('Insert here');
    expect(dropHint(card(author.id), canDrop(model, card(author.id), gap))).to.equal('Move here');
    expect(dropHint(card(author.id), canDrop(model, card(author.id), slot))).to.equal('Replace');
    expect(dropHint(palette('text'), canDrop(model, palette('text'), slot))).to.equal('Replace');
    const self = { parentId: author.id, index: 0 };
    expect(dropHint(card(author.id), canDrop(model, card(author.id), self))).to.equal('');
  });

  it('keys targets like the canvas zones and converts them for actions', () => {
    expect(targetKey({ parentId: 'p', index: 0 })).to.equal('p:0');
    expect(targetKey({ parentId: 'l', slot: true })).to.equal('l:slot');
    expect(targetKey(null)).to.equal('');
    expect(toInsertTarget({ parentId: 'l', slot: true, ok: true })).to.deep.equal({ parentId: 'l' });
    expect(toInsertTarget({ parentId: 'p', index: 1, ok: true }))
      .to.deep.equal({ parentId: 'p', index: 1 });
  });

  it('inserts a click into the selected Group or empty List, else after the selection', () => {
    const name = nodeByKey(model, 'name');
    expect(insertionPoint(model, author.id, root)).to.deep.equal({ parentId: author.id, index: 1 });
    expect(insertionPoint(model, name.id, root)).to.deep.equal({ parentId: author.id, index: 1 });
    expect(insertionPoint(model, tags.id, root)).to.deep.equal({ parentId: root.id, index: 2 });
    expect(insertionPoint(model, tags.item.id, root))
      .to.deep.equal({ parentId: root.id, index: 2 });
    expect(insertionPoint(model, null, root)).to.deep.equal({ parentId: root.id, index: 4 });
    expect(insertionPoint(model, null, null)).to.equal(null);

    const { model: rows } = parseSchema({
      type: 'array',
      title: 'Rows',
      items: { type: 'object', title: 'Row', properties: { cells: { type: 'array', title: 'Cells' } } },
    });
    const cells = nodeByKey(rows, 'cells');
    expect(insertionPoint(rows, cells.id, rows.root)).to.deep.equal({ parentId: cells.id });
    expect(insertionPoint(rows, null, rows.root)).to.deep.equal({ parentId: rows.root.id });
  });

  it('names the List item a target would replace', () => {
    expect(replacedItem(model, { parentId: tags.id })).to.equal(tags.item);
    expect(replacedItem(model, { parentId: tags.id }, tags.item.id)).to.equal(null);
    expect(replacedItem(model, { parentId: root.id, index: 0 })).to.equal(null);
  });
});
