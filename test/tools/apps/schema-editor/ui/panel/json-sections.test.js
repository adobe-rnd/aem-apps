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
import { jsonSections } from '../../../../../../tools/apps/schema-editor/ui/panel/json-sections.js';

const ADDRESS = {
  type: 'object',
  title: 'Address',
  properties: { city: { type: 'string', title: 'City' } },
};

describe('JSON sections', () => {
  const { model } = parseSchema(PERSON);
  const parsed = (section) => JSON.parse(section.json);

  it('shows the whole file for the schema root', () => {
    const sections = jsonSections(model, model.root);
    expect(sections.map((s) => s.title)).to.deep.equal(['The whole schema file']);
    expect(parsed(sections[0]).$defs.Address).to.deep.equal(ADDRESS);
  });

  it('shows a field as saved', () => {
    const sections = jsonSections(model, nodeByKey(model, 'name'));
    expect(sections.map((s) => s.title)).to.deep.equal(['JSON of this element']);
    expect(parsed(sections[0])).to.deep.equal({ type: 'string', title: 'Name' });
  });

  it('shows a component use as its reference, then the component', () => {
    const sections = jsonSections(model, nodeByKey(model, 'address'));
    expect(sections.map((s) => s.title)).to.deep.equal([
      'This field, saved as a reference',
      'The Address component',
    ]);
    expect(parsed(sections[0])).to.deep.equal({ $ref: '#/$defs/Address' });
    expect(parsed(sections[1])).to.deep.equal(ADDRESS);
    expect(sections[1].what).to.equal('Address JSON');
  });

  it('names the component at its own top', () => {
    const sections = jsonSections(model, model.defs[0].node);
    expect(sections.map((s) => s.title)).to.deep.equal(['The Address component']);
    expect(parsed(sections[0])).to.deep.equal(ADDRESS);
  });

  it('shows only the reference when the component is missing', () => {
    const ref = nodeByKey(model, 'address');
    const sections = jsonSections({ ...model, defs: [] }, ref);
    expect(sections.map((s) => s.title)).to.deep.equal(['JSON of this element']);
  });

  it('shows nothing without a selection', () => {
    expect(jsonSections(model, null)).to.deep.equal([]);
  });
});
