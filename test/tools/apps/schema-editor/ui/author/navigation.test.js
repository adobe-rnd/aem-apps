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
import { parseSchema } from '../../../../../../tools/apps/schema-editor/core/model/parse.js';
import {
  visibleRows, treeKey, ancestorKeys, rowKey, inPreview, outerUse,
  NO_FOLDS, isFolded, withOpen, foldableKeys, allOpen,
} from '../../../../../../tools/apps/schema-editor/ui/author/navigation.js';

const SCHEMA = {
  type: 'object',
  title: 'Event',
  properties: {
    name: { type: 'string', title: 'Name' },
    venue: { $ref: '#/$defs/address' },
    host: { $ref: '#/$defs/person' },
  },
  $defs: {
    address: {
      type: 'object',
      title: 'Address',
      properties: { city: { type: 'string', title: 'City' } },
    },
    person: {
      type: 'object',
      title: 'Person',
      properties: {
        email: { type: 'string', title: 'Email' },
        home: { $ref: '#/$defs/address' },
      },
    },
    loop: {
      type: 'object',
      title: 'Loop',
      properties: { next: { $ref: '#/$defs/loop' } },
    },
  },
};

const byKey = (model, key) => model.root.children.find((c) => c.key === key);
const defNamed = (model, name) => model.defs.find((d) => d.name === name);

describe('canvas navigation', () => {
  let model;
  let city;

  beforeEach(() => {
    ({ model } = parseSchema(SCHEMA, { name: 'event' }));
    [city] = defNamed(model, 'address').node.children;
  });

  it('shows a component\'s fields under every use, each with its own key', () => {
    const rows = visibleRows(model, model.root);
    const venue = byKey(model, 'venue');
    const host = byKey(model, 'host');
    const home = defNamed(model, 'person').node.children[1];
    const cityRows = rows.filter((row) => row.id === city.id);
    expect(cityRows.map((row) => row.key)).to.deep.equal([
      rowKey(venue.id, city.id),
      rowKey(rowKey(host.id, home.id), city.id),
    ]);
    expect(cityRows.map((row) => row.level)).to.deep.equal([3, 4]);
    expect(new Set(rows.map((row) => row.key)).size).to.equal(rows.length);
  });

  it('opens a component use like a container', () => {
    const venue = byKey(model, 'venue');
    const row = visibleRows(model, model.root).find((r) => r.id === venue.id);
    expect(row.container).to.equal(true);
    expect(row.expanded).to.equal(true);
  });

  it('folds component uses by default and keeps containers open', () => {
    const folds = (state) => (key, open) => isFolded(state, key, open);
    const venue = byKey(model, 'venue');
    const host = byKey(model, 'host');
    const keys = (state) => visibleRows(model, model.root, folds(state)).map((row) => row.key);
    expect(keys(NO_FOLDS)).to.deep.equal([model.root.id, byKey(model, 'name').id, venue.id, host.id]);

    const opened = withOpen(NO_FOLDS, [venue.id], true);
    expect(keys(opened)).to.include(rowKey(venue.id, city.id));
    expect(keys(opened)).to.not.include(rowKey(host.id, defNamed(model, 'person').node.children[0].id));

    const closed = withOpen(opened, [venue.id, model.root.id], false);
    expect(keys(closed)).to.deep.equal([model.root.id]);
    expect(keys(withOpen(closed, [model.root.id], true))).to.have.length(4);
  });

  it('folds every row that opens but the top with Collapse all', () => {
    const all = visibleRows(model, model.root);
    expect(foldableKeys(all)).to.include.members([byKey(model, 'venue').id, byKey(model, 'host').id]);
    expect(foldableKeys(all)).to.not.include(model.root.id);
  });

  it('tells when every row that folds is open, for the Expand all switch', () => {
    const rows = (state) => visibleRows(model, model.root, (k, open) => isFolded(state, k, open));
    const expanded = withOpen(NO_FOLDS, foldableKeys(visibleRows(model, model.root)), true);
    expect(allOpen(rows(NO_FOLDS))).to.equal(false);
    expect(allOpen(rows(expanded))).to.equal(true);
    expect(allOpen(rows(withOpen(expanded, [byKey(model, 'host').id], false)))).to.equal(false);
  });

  it('stops at a use of a component it already shows under', () => {
    const loop = defNamed(model, 'loop');
    const rows = visibleRows(model, loop.node, undefined, loop);
    expect(rows).to.have.length(2);
    expect(rows[1].container).to.equal(false);
  });

  it('moves between rows by key', () => {
    const rows = visibleRows(model, model.root);
    const venue = byKey(model, 'venue');
    const first = rowKey(venue.id, city.id);
    expect(treeKey(rows, venue.id, 'ArrowRight')).to.deep.equal({ focus: first });
    expect(treeKey(rows, first, 'ArrowLeft')).to.deep.equal({ focus: venue.id });
    expect(treeKey(rows, venue.id, 'ArrowLeft')).to.deep.equal({ collapse: venue.id });
  });

  it('finds the rows to expand for a row', () => {
    const rows = visibleRows(model, model.root);
    const host = byKey(model, 'host');
    const home = defNamed(model, 'person').node.children[1];
    const nested = rowKey(rowKey(host.id, home.id), city.id);
    expect(ancestorKeys(rows, nested))
      .to.deep.equal([rowKey(host.id, home.id), host.id, model.root.id]);
  });

  it('previews component fields, owned by the outermost use', () => {
    const host = byKey(model, 'host');
    const home = defNamed(model, 'person').node.children[1];
    const homeScope = rowKey(host.id, home.id);
    expect(inPreview('')).to.equal(false);
    expect(inPreview(homeScope)).to.equal(true);
    expect(outerUse(host.id)).to.equal(host.id);
    expect(outerUse(homeScope)).to.equal(host.id);
  });
});
