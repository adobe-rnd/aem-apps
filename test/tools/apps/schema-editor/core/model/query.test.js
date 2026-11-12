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
import { componentCrossing } from '../../../../../../tools/apps/schema-editor/core/model/query.js';

const SCHEMA = {
  type: 'object',
  title: 'Event',
  properties: {
    name: { type: 'string', title: 'Name' },
    venue: { $ref: '#/$defs/address' },
  },
  $defs: {
    address: {
      type: 'object',
      title: 'Address',
      properties: {
        city: { type: 'string', title: 'City' },
        geo: { type: 'object', title: 'Geo', properties: { lat: { type: 'number', title: 'Lat' } } },
      },
    },
    person: {
      type: 'object',
      title: 'Person',
      properties: { email: { type: 'string', title: 'Email' } },
    },
  },
};

describe('componentCrossing', () => {
  const { model } = parseSchema(SCHEMA, { name: 'event' });
  const def = (name) => model.defs.find((d) => d.name === name);
  const field = (name, key) => def(name).node.children.find((c) => c.key === key);
  const name = model.root.children.find((c) => c.key === 'name');

  it('is null within the schema or within one component', () => {
    expect(componentCrossing(model, name.id, model.root.id)).to.equal(null);
    const city = field('address', 'city');
    expect(componentCrossing(model, city.id, field('address', 'geo').id)).to.equal(null);
    expect(componentCrossing(model, city.id, def('address').node.id)).to.equal(null);
  });

  it('names the component a field leaves or joins', () => {
    const city = field('address', 'city');
    const out = componentCrossing(model, city.id, model.root.id);
    expect(out.from.id).to.equal(def('address').id);
    expect(out.to).to.equal(null);
    const into = componentCrossing(model, name.id, def('person').node.id);
    expect(into.from).to.equal(null);
    expect(into.to.id).to.equal(def('person').id);
  });

  it('names both components when moving between them', () => {
    const between = componentCrossing(model, field('address', 'city').id, def('person').node.id);
    expect(between.from.id).to.equal(def('address').id);
    expect(between.to.id).to.equal(def('person').id);
  });
});
