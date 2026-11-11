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
import { expect } from '../expect.js';
import { memoryRepository } from '../fixtures.js';
import {
  SchemaCatalog, summarize, filterItems, sortItems, parseImport, checkNewName,
} from '../../../../../tools/apps/schema-editor/core/catalog.js';

const PERSON = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Person',
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    address: { $ref: '#/$defs/Address' },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
  },
  $defs: {
    Address: {
      type: 'object',
      title: 'Address',
      properties: { city: { type: 'string', title: 'City' } },
    },
  },
};

describe('schema catalog', () => {
  it('summarizes fields (not components or array items) and components', () => {
    const summary = summarize(PERSON, 'person');
    expect(summary).to.include({
      title: 'Person', fields: 3, components: 1, errors: 0,
    });
  });

  it('falls back to the name when the schema has no title', () => {
    expect(summarize({ type: 'object', properties: {} }, 'empty').title).to.equal('empty');
  });

  it('filters on name and title', () => {
    const items = [{ name: 'person' }, { name: 'event' }];
    const summaries = new Map([['event', { title: 'Conference' }]]);
    expect(filterItems(items, 'conf', summaries).map((i) => i.name)).to.deep.equal(['event']);
    expect(filterItems(items, 'PERS', summaries).map((i) => i.name)).to.deep.equal(['person']);
    expect(filterItems(items, '  ', summaries)).to.have.length(2);
  });

  it('sorts by last modified, title and name', () => {
    const items = [
      { name: 'b', lastModified: 1 },
      { name: 'a', lastModified: 3 },
      { name: 'c', lastModified: 2 },
    ];
    const summaries = new Map([['a', { title: 'Zeta' }], ['b', { title: 'alpha' }]]);
    expect(sortItems(items, 'modified').map((i) => i.name)).to.deep.equal(['a', 'c', 'b']);
    expect(sortItems(items, 'name').map((i) => i.name)).to.deep.equal(['a', 'b', 'c']);
    expect(sortItems(items, 'title', summaries).map((i) => i.name)).to.deep.equal(['b', 'c', 'a']);
    expect(items[0].name).to.equal('b');
  });

  it('parses imported JSON', () => {
    expect(parseImport('{"type":"object"}').json).to.deep.equal({ type: 'object' });
    expect(parseImport('[1]').error).to.match(/JSON object/);
    expect(parseImport('{').error).to.match(/Not valid JSON/);
  });

  it('parseImport tells a JSON Schema from content', () => {
    const schema = (value) => parseImport(JSON.stringify(value));
    expect(schema({ properties: { a: { type: 'string' } } }).error).to.equal(undefined);
    expect(schema({ type: ['object', 'null'] }).error).to.equal(undefined);
    expect(schema({ $defs: {} }).error).to.equal(undefined);
    expect(schema({ title: 'Event', date: '2026-01-01' }).error).to.match(/looks like content/);
    expect(schema({ type: 'event', name: 'Launch' }).error).to.match(/looks like content/);
    expect(schema({ properties: { size: 3 } }).error).to.match(/looks like content/);
  });

  it('validates new names against existing ones', () => {
    expect(checkNewName('person', ['person'])).to.match(/already exists/);
    expect(checkNewName('Person', [])).to.match(/lowercase/);
    expect(checkNewName('event', ['person'])).to.equal(null);
  });

  it('creates a blank schema with the given title', async () => {
    const repository = memoryRepository();
    const catalog = new SchemaCatalog({ org: 'o', site: 's', repository });
    expect(await catalog.create({ name: 'faq', title: 'FAQ' })).to.deep.equal({ ok: true });
    expect(repository.store.faq).to.include({ title: 'FAQ', type: 'object' });
    expect(repository.store.faq.$schema).to.match(/2020-12/);
  });

  it('creates a schema from imported JSON', async () => {
    const repository = memoryRepository();
    const catalog = new SchemaCatalog({ org: 'o', site: 's', repository });
    await catalog.create({ name: 'person', json: PERSON });
    expect(repository.store.person.properties.name).to.deep.include({ type: 'string', title: 'Name' });
    expect(repository.store.person.$defs.Address).to.not.equal(undefined);
  });

  it('duplicates, summarizes, copies and deletes', async () => {
    const repository = memoryRepository({ person: PERSON });
    const catalog = new SchemaCatalog({ org: 'o', site: 's', repository });
    expect(await catalog.duplicate({ from: 'person', name: 'person-copy' })).to.deep.equal({ ok: true });
    expect(repository.store['person-copy']).to.deep.equal(PERSON);

    const { summary } = await catalog.summary({ name: 'person' });
    expect(summary.fields).to.equal(3);

    const { raw } = await catalog.rawJson({ name: 'person' });
    expect(JSON.parse(raw)).to.deep.equal(PERSON);

    await catalog.remove({ name: 'person' });
    expect(repository.store.person).to.equal(undefined);
    expect((await catalog.summary({ name: 'person' })).error).to.equal('Not found');
  });
});
