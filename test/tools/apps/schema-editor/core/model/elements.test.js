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
import {
  deriveKey,
  deriveSchemaName,
  deriveDefName,
  validateSchemaName,
  validateDefName,
} from '../../../../../../tools/apps/schema-editor/core/model/keys.js';
import {
  ELEMENTS,
  createNode,
  createRefNode,
  elementOf,
  paletteBySection,
} from '../../../../../../tools/apps/schema-editor/core/model/elements.js';

describe('schema model keys', () => {
  it('derives camelCase keys from titles', () => {
    expect(deriveKey('Publish date')).to.equal('publishDate');
    expect(deriveKey('URL')).to.equal('url');
    expect(deriveKey('H1 title')).to.equal('h1Title');
    expect(deriveKey('Café crème')).to.equal('cafeCreme');
  });

  it('handles leading digits, empty titles, reserved and duplicate keys', () => {
    expect(deriveKey('2nd line')).to.equal('field2ndLine');
    expect(deriveKey('  !! ')).to.equal('field');
    expect(deriveKey('Metadata')).to.equal('metadataField');
    expect(deriveKey('Title', ['title', 'title2'])).to.equal('title3');
  });

  it('derives schema and component names', () => {
    expect(deriveSchemaName('Product Page')).to.equal('product-page');
    expect(deriveSchemaName('Product Page', ['product-page'])).to.equal('product-page-2');
    expect(deriveSchemaName('')).to.equal('schema');
    expect(deriveDefName('contact person')).to.equal('ContactPerson');
    expect(deriveDefName('Contact', ['Contact'])).to.equal('Contact2');
  });

  it('validates names', () => {
    expect(validateSchemaName('product-page')).to.equal(null);
    expect(validateSchemaName('Product')).to.be.a('string');
    expect(validateSchemaName('page', ['page'])).to.contain('already');
    expect(validateDefName('Contact_v2')).to.equal(null);
    expect(validateDefName('a/b')).to.be.a('string');
  });
});

describe('schema model elements', () => {
  it('creates nodes per element', () => {
    const choice = createNode('choice', { siblingKeys: [] });
    expect(choice).to.include({
      kind: 'string', variant: 'choice', title: 'Choice', key: 'choice',
    });
    expect(choice.enum).to.deep.equal(['Option 1', 'Option 2']);
    expect(createNode('group').children).to.deep.equal([]);
    expect(createNode('list').item).to.equal(null);
    expect(createNode('text')).to.not.have.property('key');
    expect(createNode('text', { siblingKeys: ['text'] }).key).to.equal('text2');
  });

  it('maps nodes back to elements', () => {
    Object.keys(ELEMENTS).forEach((id) => {
      expect(elementOf(createNode(id))).to.equal(id);
    });
    const def = { id: 'd1', name: 'Contact', node: createNode('group', { title: 'Contact' }) };
    const ref = createRefNode(def, { siblingKeys: [] });
    expect(ref).to.include({ kind: 'ref', refDefId: 'd1', key: 'contact' });
    expect(elementOf(ref)).to.equal(null);
  });

  it('groups the palette by section', () => {
    const sections = paletteBySection();
    expect(sections.map((s) => s.id)).to.deep.equal(['basic', 'datetime', 'structure']);
    const count = sections.reduce((n, s) => n + s.elements.length, 0);
    expect(count).to.equal(Object.keys(ELEMENTS).length);
  });

  it('creates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createNode('text').id));
    expect(ids.size).to.equal(100);
  });
});
