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
import { PERSON, nodeByKey } from '../../fixtures.js';
import { parseSchema } from '../../../../../../tools/apps/schema-editor/core/model/parse.js';
import {
  MODES, pageTop, topNode, pageShows, pageFor, componentFor, selectionAfter,
} from '../../../../../../tools/apps/schema-editor/core/session/modes.js';

// Unused is not used by the schema; it uses Geo, which only shows under it.
const DEFS = {
  Unused: {
    type: 'object',
    title: 'Unused',
    properties: { note: { type: 'string', title: 'Note' }, geo: { $ref: '#/$defs/Geo' } },
  },
  Geo: {
    type: 'object',
    title: 'Geo',
    properties: { lat: { type: 'number', title: 'Latitude' } },
  },
};

function setup() {
  const { model } = parseSchema({ ...PERSON, $defs: { ...PERSON.$defs, ...DEFS } });
  const def = (name) => model.defs.find((d) => d.name === name);
  const defIds = { address: def('Address').id, unused: def('Unused').id, geo: def('Geo').id };
  const ids = {
    root: model.root.id,
    name: nodeByKey(model, 'name').id,
    use: nodeByKey(model, 'address').id,
    address: def('Address').node.id,
    city: nodeByKey(model, 'city').id,
    unused: def('Unused').node.id,
    note: nodeByKey(model, 'note').id,
    geoUse: nodeByKey(model, 'geo').id,
    geo: def('Geo').node.id,
    lat: nodeByKey(model, 'lat').id,
  };
  return { model, ids, defIds };
}

const BUILD = { mode: 'build', componentId: null };
const showing = (componentId) => ({ mode: 'components', componentId });

describe('pages', () => {
  it('lists Build and Components', () => {
    expect(MODES).to.deep.equal(['build', 'components']);
  });

  it('shows the schema in Build and one component on the Components page', () => {
    const { model, ids, defIds } = setup();
    expect(pageTop(model, BUILD)).to.deep.equal({ node: model.root, def: null });
    expect(pageTop(model, showing(defIds.geo)).node.id).to.equal(ids.geo);
    expect(pageTop(model, showing('missing'))).to.equal(null);
    expect(pageTop(model, showing(null))).to.equal(null);
    expect(pageTop(null, BUILD)).to.equal(null);
  });

  it('tops the selection with its component, else with the page tree', () => {
    const { model, ids, defIds } = setup();
    expect(topNode(model, null, BUILD)).to.equal(model.root);
    expect(topNode(model, defIds.address, BUILD).id).to.equal(ids.address);
    expect(topNode(model, null, showing(defIds.geo)).id).to.equal(ids.geo);
    expect(topNode(model, 'gone', BUILD)).to.equal(model.root);
    expect(topNode(model, null, showing(null))).to.equal(null);
    expect(topNode(null, null, BUILD)).to.equal(null);
  });

  it('shows its own tree, not the fields of the components it uses', () => {
    const { model, ids, defIds } = setup();
    const shown = (page) => Object.keys(ids).filter((key) => pageShows(model, ids[key], page));
    expect(shown(BUILD)).to.deep.equal(['root', 'name', 'use']);
    expect(shown(showing(defIds.address))).to.deep.equal(['address', 'city']);
    expect(shown(showing(defIds.unused))).to.deep.equal(['unused', 'note', 'geoUse']);
    expect(shown(showing(defIds.geo))).to.deep.equal(['geo', 'lat']);
    expect(shown(showing(null))).to.deep.equal([]);
    expect(pageShows(model, 'missing', BUILD)).to.equal(false);
    expect(pageShows(null, ids.root, BUILD)).to.equal(false);
  });

  it('keeps the page when it shows the node, else opens the one that does', () => {
    const { model, ids, defIds } = setup();
    const address = showing(defIds.address);
    expect(pageFor(model, ids.city, BUILD)).to.deep.equal(address);
    expect(pageFor(model, ids.city, address)).to.equal(address);
    expect(pageFor(model, ids.address, BUILD)).to.deep.equal(address);
    expect(pageFor(model, ids.note, BUILD)).to.deep.equal(showing(defIds.unused));
    expect(pageFor(model, ids.lat, address)).to.deep.equal(showing(defIds.geo));
    expect(pageFor(model, ids.name, address)).to.deep.equal({ mode: 'build', componentId: defIds.address });
  });

  it('opens Components on the component the user works in', () => {
    const { model, ids, defIds } = setup();
    expect(componentFor(model, ids.note, defIds.unused)).to.equal(defIds.unused);
    expect(componentFor(model, ids.lat, defIds.unused)).to.equal(defIds.geo);
    expect(componentFor(model, ids.lat, defIds.address)).to.equal(defIds.geo);
    expect(componentFor(model, ids.use, null)).to.equal(defIds.address);
    expect(componentFor(model, ids.geoUse, defIds.address)).to.equal(defIds.geo);
    expect(componentFor(model, ids.city, defIds.unused)).to.equal(defIds.address);
    expect(componentFor(model, ids.name, defIds.unused)).to.equal(defIds.unused);
    expect(componentFor(model, ids.name, 'gone')).to.equal(defIds.address);
    expect(componentFor(model, null, null)).to.equal(defIds.address);
    expect(componentFor(parseSchema({ type: 'object' }).model, null, null)).to.equal(null);
  });

  it('keeps the selection where the new page shows it', () => {
    const { model, ids, defIds } = setup();
    expect(selectionAfter(model, null, showing(defIds.address))).to.equal(null);
    expect(selectionAfter(model, ids.city, showing(defIds.address))).to.equal(ids.city);
    expect(selectionAfter(model, ids.name, showing(defIds.address))).to.equal(null);
    expect(selectionAfter(model, ids.address, BUILD)).to.equal(null);
    expect(selectionAfter(model, ids.lat, BUILD)).to.equal(null);
  });

  it('selects the component of a selected use on its page', () => {
    const { model, ids, defIds } = setup();
    expect(selectionAfter(model, ids.use, showing(defIds.address))).to.equal(ids.address);
    expect(selectionAfter(model, ids.geoUse, showing(defIds.geo))).to.equal(ids.geo);
    expect(selectionAfter(model, ids.use, showing(defIds.unused))).to.equal(null);
  });
});
