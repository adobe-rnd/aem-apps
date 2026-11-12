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
// End to end: schemas built with the editor's commands must be exactly the JSON Schema we
// expect, follow schema-spec.md, and behave in the real SC SDK the way the editor says they do.

import { describe, it } from 'node:test';
import {
  validateSchema, validateData, createEngine, convertJsonToHtml, convertHtmlToJson,
} from '@adobe/da-sc-sdk';
import { expect } from '../../expect.js';
import {
  editor, specProblems, sdkView, newDocumentErrors,
} from './conformance.js';
import { COMPLETE_EXAMPLE } from './fixtures.js';
import { ELEMENTS, createModel, createNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import {
  CommandError, changeElement, deleteDef, detachRef, duplicateNode, insertNode, makeComponent,
  moveNode, removeNode, renameDef, updateNode,
} from '../../../../../../tools/apps/schema-editor/core/model/commands.js';
import {
  getNode, isDescendant, siblingKeys, walk,
} from '../../../../../../tools/apps/schema-editor/core/model/query.js';
import { parseSchema } from '../../../../../../tools/apps/schema-editor/core/model/parse.js';
import { serializeSchema } from '../../../../../../tools/apps/schema-editor/core/model/serialize.js';
import { checkValue, lint } from '../../../../../../tools/apps/schema-editor/core/model/lint.js';
import { checkWithSdk } from '../../../../../../tools/apps/schema-editor/core/model/sdk.js';
import { SchemaStore } from '../../../../../../tools/apps/schema-editor/core/session/store.js';
import { createSchemaBus } from '../../../../../../tools/apps/schema-editor/core/session/bus.js';

const PATTERNS = {
  slug: '^[a-z0-9]+(-[a-z0-9]+)*$',
  url: '^https?://',
  email: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
  digits: '^[0-9]+$',
};
// A new document may only miss what the author has to fill in.
const NEW_DOCUMENT_KEYWORDS = ['required', 'minItems'];

const errorsOf = (model) => lint(model).filter((i) => i.severity === 'error');

/** Asserts the model saves (no lint errors) and its JSON passes every check; returns it. */
function expectConformant(model, label = 'schema') {
  expect(errorsOf(model).map((i) => `${i.schemaPath} ${i.code}`), `${label}: lint`).to.deep.equal([]);
  const schema = serializeSchema(model);
  expect(validateSchema({ schema }), `${label}: SDK`).to.deep.equal({ valid: true, schemaIssues: [] });
  expect(specProblems(schema), `${label}: spec`).to.deep.equal([]);
  expect(checkWithSdk(model, validateSchema).valid, `${label}: save check`).to.equal(true);
  const keywords = Object.values(newDocumentErrors(schema));
  expect(keywords.filter((k) => !NEW_DOCUMENT_KEYWORDS.includes(k)), `${label}: new document`)
    .to.deep.equal([]);
  return schema;
}

function buildEvent() {
  const e = editor({ name: 'event', title: 'Event' });
  const { root } = e;
  e.add(root, 'text', {
    title: 'Full name', description: 'As printed on the badge.', required: true, minLength: 2, maxLength: 80,
  });
  e.add(root, 'text', { title: 'Slug', pattern: PATTERNS.slug, default: 'my-event' });
  e.add(root, 'longText', { title: 'Abstract', maxLength: 500 });
  e.add(root, 'choice', { title: 'Level', enum: ['Beginner', 'Expert'], default: 'Beginner' });
  e.add(root, 'integer', {
    title: 'Seats', minimum: 1, maximum: 500, default: 50,
  });
  e.add(root, 'number', { title: 'Price', minimum: 0 });
  e.add(root, 'boolean', { title: 'Published', readOnly: true });
  e.add(root, 'date', { title: 'Date', required: true });
  e.add(root, 'time', { title: 'Doors open', default: '09:30' });
  e.add(root, 'dateTime', { title: 'Starts at', default: '2026-03-01T09:00:00Z' });
  const venue = e.add(root, 'group', { title: 'Venue', description: 'Where it happens.' });
  e.add(venue, 'text', { title: 'City', required: true });
  e.add(venue, 'text', { title: 'Postal code', pattern: PATTERNS.digits });
  const tags = e.add(root, 'list', { title: 'Tags', minItems: 2, maxItems: 5 });
  e.add(tags, 'text', { title: 'Tag', maxLength: 20 });
  const speakers = e.add(root, 'list', { title: 'Speakers', required: true });
  const speaker = e.add(speakers, 'group', { title: 'Speaker' });
  e.add(speaker, 'text', { title: 'Name', required: true });
  e.add(speaker, 'text', { title: 'Email', pattern: PATTERNS.email });
  e.add(speaker, 'text', { title: 'Website', pattern: PATTERNS.url });
  const schedule = e.add(root, 'list', { title: 'Schedule' });
  const day = e.add(schedule, 'list', { title: 'Day', maxItems: 8 });
  e.add(day, 'time', { title: 'Slot' });
  return e;
}

const EVENT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  title: 'Event',
  required: ['fullName', 'date', 'speakers'],
  properties: {
    fullName: {
      type: 'string', title: 'Full name', description: 'As printed on the badge.', minLength: 2, maxLength: 80,
    },
    slug: {
      type: 'string', title: 'Slug', pattern: PATTERNS.slug, default: 'my-event',
    },
    abstract: {
      type: 'string', title: 'Abstract', 'x-semantic-type': 'long-text', maxLength: 500,
    },
    level: {
      type: 'string', title: 'Level', enum: ['Beginner', 'Expert'], default: 'Beginner',
    },
    seats: {
      type: 'integer', title: 'Seats', minimum: 1, maximum: 500, default: 50,
    },
    price: { type: 'number', title: 'Price', minimum: 0 },
    published: { type: 'boolean', title: 'Published', readOnly: true },
    date: { type: 'string', title: 'Date', format: 'date' },
    doorsOpen: {
      type: 'string', title: 'Doors open', format: 'time', default: '09:30',
    },
    startsAt: {
      type: 'string', title: 'Starts at', format: 'date-time', default: '2026-03-01T09:00:00Z',
    },
    venue: {
      type: 'object',
      title: 'Venue',
      description: 'Where it happens.',
      required: ['city'],
      properties: {
        city: { type: 'string', title: 'City' },
        postalCode: { type: 'string', title: 'Postal code', pattern: PATTERNS.digits },
      },
    },
    tags: {
      type: 'array',
      title: 'Tags',
      minItems: 2,
      maxItems: 5,
      items: { type: 'string', title: 'Tag', maxLength: 20 },
    },
    speakers: {
      type: 'array',
      title: 'Speakers',
      items: {
        type: 'object',
        title: 'Speaker',
        required: ['name'],
        properties: {
          name: { type: 'string', title: 'Name' },
          email: { type: 'string', title: 'Email', pattern: PATTERNS.email },
          website: { type: 'string', title: 'Website', pattern: PATTERNS.url },
        },
      },
    },
    schedule: {
      type: 'array',
      title: 'Schedule',
      items: {
        type: 'array',
        title: 'Day',
        maxItems: 8,
        items: { type: 'string', title: 'Slot', format: 'time' },
      },
    },
  },
};

const EVENT_DATA = {
  fullName: 'Ada Lovelace',
  slug: 'analytical-engines',
  abstract: 'Notes on the engine.',
  level: 'Expert',
  seats: 120,
  price: 9.5,
  published: false,
  date: '2026-03-01',
  doorsOpen: '08:45',
  startsAt: '2026-03-01T09:00:00Z',
  venue: { city: 'Basel', postalCode: '4051' },
  tags: ['ai', 'web'],
  speakers: [{ name: 'Grace Hopper', email: 'grace@example.com', website: 'https://example.com' }],
  schedule: [['09:00', '10:30'], ['11:00']],
};

describe('SC SDK conformance', () => {
  describe('a schema built with every element and setting', () => {
    const e = buildEvent();
    const schema = serializeSchema(e.model);

    it('is exactly the expected JSON Schema, in the expected key order', () => {
      expect(JSON.stringify(schema)).to.equal(JSON.stringify(EVENT_SCHEMA));
    });

    it('passes the SDK, the spec and the editor', () => {
      expectConformant(e.model);
    });

    it('reads in the SDK form engine as authored', () => {
      const { view, schemaIssues } = sdkView(schema);
      expect(schemaIssues).to.deep.equal([]);
      expect(view['/data/fullName']).to.deep.equal({
        kind: 'string',
        label: 'Full name',
        description: 'As printed on the badge.',
        required: true,
        readonly: false,
        validation: { minLength: 2, maxLength: 80 },
      });
      expect(view['/data/slug']).to.include({ defaultValue: 'my-event' });
      expect(view['/data/slug'].validation).to.deep.equal({ pattern: PATTERNS.slug });
      expect(view['/data/abstract']).to.include({ semanticType: 'long-text' });
      expect(view['/data/level']).to.deep.include({ enumValues: ['Beginner', 'Expert'], defaultValue: 'Beginner' });
      expect(view['/data/seats']).to.deep.include({
        kind: 'integer', defaultValue: 50, validation: { minimum: 1, maximum: 500 },
      });
      expect(view['/data/price']).to.deep.include({ kind: 'number', validation: { minimum: 0 } });
      expect(view['/data/published']).to.include({ kind: 'boolean', readonly: true });
      expect(view['/data/date']).to.include({ format: 'date', required: true });
      expect(view['/data/doorsOpen']).to.include({ format: 'time', defaultValue: '09:30' });
      expect(view['/data/startsAt']).to.include({ format: 'date-time', defaultValue: '2026-03-01T09:00:00Z' });
      expect(view['/data/venue']).to.include({ kind: 'object', description: 'Where it happens.', required: false });
      expect(view['/data/venue/city']).to.include({ required: true });
      expect(view['/data/tags']).to.include({
        kind: 'array', minItems: 2, maxItems: 5, itemLabel: 'Tag',
      });
      expect(view['/data/tags/0'].validation).to.deep.equal({ maxLength: 20 });
      expect(view['/data/speakers']).to.include({ required: true, itemLabel: 'Speaker' });
      expect(view['/data/speakers/0/name']).to.include({ required: true });
      expect(view['/data/schedule/0']).to.include({ kind: 'array', maxItems: 8, itemLabel: 'Slot' });
      expect(view['/data/schedule/0/0']).to.include({ format: 'time' });
    });

    it('starts new documents with valid defaults and only the required fields missing', () => {
      expect(newDocumentErrors(schema)).to.deep.equal({
        '/data/fullName': 'required',
        '/data/date': 'required',
        '/data/speakers': 'required',
        '/data/venue/city': 'required',
      });
      const { document } = createEngine({ schema, document: { metadata: { schemaName: 'event' }, data: {} } })
        .getState();
      expect(document.data).to.deep.include({
        slug: 'my-event', level: 'Beginner', seats: 50, doorsOpen: '09:30', startsAt: '2026-03-01T09:00:00Z',
      });
    });

    it('accepts a complete document', () => {
      expect(validateData({ schema, data: EVENT_DATA }))
        .to.deep.equal({ valid: true, errors: {}, schemaIssues: [] });
    });

    const violations = [
      ['fullName', 'A', '/data/fullName', 'minLength'],
      ['fullName', 'x'.repeat(81), '/data/fullName', 'maxLength'],
      ['fullName', undefined, '/data/fullName', 'required'],
      ['slug', 'My Event', '/data/slug', 'pattern'],
      ['abstract', 'x'.repeat(501), '/data/abstract', 'maxLength'],
      ['level', 'expert', '/data/level', 'enum'],
      ['seats', 0, '/data/seats', 'minimum'],
      ['seats', 501, '/data/seats', 'maximum'],
      ['seats', 1.5, '/data/seats', 'type'],
      ['price', -0.01, '/data/price', 'minimum'],
      ['published', 'yes', '/data/published', 'type'],
      ['date', '2026-02-30', '/data/date', 'format'],
      ['date', undefined, '/data/date', 'required'],
      ['doorsOpen', '9:30', '/data/doorsOpen', 'format'],
      ['startsAt', '2026-03-01T09:00:00+01:00', '/data/startsAt', 'format'],
      ['venue', { postalCode: '4051' }, '/data/venue/city', 'required'],
      ['venue', { city: 'Basel', postalCode: '40-51' }, '/data/venue/postalCode', 'pattern'],
      ['tags', ['ai'], '/data/tags', 'minItems'],
      ['tags', ['a', 'b', 'c', 'd', 'e', 'f'], '/data/tags', 'maxItems'],
      ['tags', ['ai', 'x'.repeat(21)], '/data/tags/1', 'maxLength'],
      ['speakers', [], '/data/speakers', 'required'],
      ['speakers', [{ email: 'grace@example.com' }], '/data/speakers/0/name', 'required'],
      ['speakers', [{ name: 'Grace', email: 'grace' }], '/data/speakers/0/email', 'pattern'],
      ['speakers', [{ name: 'Grace', website: 'example.com' }], '/data/speakers/0/website', 'pattern'],
      ['schedule', [Array(9).fill('09:00')], '/data/schedule/0', 'maxItems'],
      ['schedule', [['09:00'], ['25:00']], '/data/schedule/1/0', 'format'],
    ];

    it('makes the SDK enforce every constraint the editor wrote', () => {
      violations.forEach(([field, value, pointer, keyword]) => {
        const data = { ...EVENT_DATA, [field]: value };
        if (value === undefined) delete data[field];
        const { valid, errors } = validateData({ schema, data });
        const label = `${field} = ${JSON.stringify(value)}`;
        expect(valid, label).to.equal(false);
        expect(Object.keys(errors), label).to.deep.equal([pointer]);
        expect(errors[pointer].keyword, label).to.equal(keyword);
      });
    });

    it('keeps documents intact through DA storage (HTML) and the form engine', () => {
      const { html } = convertJsonToHtml({ json: { metadata: { schemaName: 'event' }, data: EVENT_DATA } });
      const { json } = convertHtmlToJson({ html });
      const { document, validation } = createEngine({ schema, document: json }).getState();
      expect(document.data).to.deep.equal(EVENT_DATA);
      expect(validation.errors).to.deep.equal({});
    });
  });

  describe('values the editor accepts are exactly the values the SDK accepts', () => {
    const cases = [
      ['text', { minLength: 2, maxLength: 3 }, { ok: ['ab', 'abc', '😀', 'e\u0301'], bad: ['a', 'abcd', '😀😀', '😀ab', '\u00e9'] }],
      ['text', { pattern: PATTERNS.slug }, { ok: ['my-event', 'a1'], bad: ['My Event', 'a--b', '-a'] }],
      ['text', { pattern: PATTERNS.url }, { ok: ['https://x', 'http://'], bad: ['ftp://x', 'example.com'] }],
      ['text', { pattern: PATTERNS.email }, { ok: ['a@b.co'], bad: ['a@b', 'a b@c.d'] }],
      ['text', { pattern: PATTERNS.digits }, { ok: ['123'], bad: ['12a', '1 2'] }],
      ['text', { pattern: '^\\d{3}\\-\\d{4}$' }, { ok: ['555-1234'], bad: ['5551234'] }],
      // Without the `u` flag `\p{L}` is the literal text "p{L}", as in the SDK.
      ['text', { pattern: '^\\p{L}+$' }, { ok: ['p{L}', 'p{L}}'], bad: ['héllo'] }],
      ['longText', { maxLength: 5 }, { ok: ['hello', 'a\nb'], bad: ['hello!'] }],
      ['choice', { enum: ['Beginner', 'Expert'] }, { ok: ['Beginner', 'Expert'], bad: ['beginner', 'Other'] }],
      ['choice', { enum: ['a', 'abc'], maxLength: 2 }, { ok: ['a'], bad: ['abc', 'b'] }],
      ['integer', { minimum: 1, maximum: 10 }, { ok: [1, 10, 5], bad: [0, 11, 5.5, '5'] }],
      ['number', { minimum: -1.5, maximum: 2.5 }, { ok: [-1.5, 2.5, 0.1], bad: [-2, 2.51, '1'] }],
      ['boolean', {}, { ok: [true, false], bad: ['true', 1] }],
      ['date', {}, {
        ok: ['2024-02-29', '2000-02-29', '0000-02-29', '2026-12-31'],
        bad: ['2023-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-01', '2026-02-28T00:00'],
      }],
      ['time', {}, {
        ok: ['00:00', '23:59', '09:30:59'],
        bad: ['24:00', '9:30', '09:60', '09:30:60', '09:30:5', '09:30Z'],
      }],
      ['dateTime', {}, {
        ok: ['2026-03-01T09:00:00Z', '2026-03-01T09:00:00.000Z', '2024-02-29T23:59:00Z'],
        bad: [
          '2026-03-01T09:00:30Z', '2026-03-01T09:00:00.5Z', '2026-03-01T09:00:00+01:00',
          '2026-02-30T09:00:00Z', '2026-03-01T24:00:00Z', '2026-03-01 09:00:00Z', '2026-03-01T09:00Z',
        ],
      }],
    ];

    cases.forEach(([element, settings, { ok, bad }]) => {
      it(`${element} ${JSON.stringify(settings)}`, () => {
        const e = editor();
        const id = e.add(e.root, element, { title: 'Value', ...settings });
        const node = getNode(e.model, id);
        const schema = serializeSchema(e.model);
        expect(validateSchema({ schema }).valid).to.equal(true);
        const samples = [...ok.map((v) => [v, true]), ...bad.map((v) => [v, false])];
        samples.forEach(([value, accepted]) => {
          const label = `${JSON.stringify(value)}`;
          const sdkError = validateData({ schema, data: { value } }).errors['/data/value'];
          expect(sdkError === undefined, `SDK ${label}`).to.equal(accepted);
          expect(checkValue(node, value) === null, `editor ${label}`).to.equal(accepted);
        });
      });
    });
  });

  describe('components', () => {
    it('keep the form identical when a field becomes, is renamed, detached or deleted', () => {
      const e = buildEvent();
      const viewOf = () => sdkView(serializeSchema(e.model)).view;
      const before = viewOf();
      const venue = [...walk(e.model)].find(({ node }) => node.key === 'venue').node.id;
      const speakers = [...walk(e.model)].find(({ node }) => node.key === 'speakers').node.id;

      const address = e.run(makeComponent, { nodeId: venue, name: 'Address' }).defId;
      const team = e.run(makeComponent, { nodeId: speakers, name: 'Team' }).defId;
      let schema = expectConformant(e.model, 'components');
      expect(schema.properties.venue).to.deep.equal({ $ref: '#/$defs/Address' });
      expect(schema.properties.speakers).to.deep.equal({ $ref: '#/$defs/Team' });
      expect(schema.required).to.deep.equal(['fullName', 'date', 'speakers']);
      expect(schema.$defs.Address).to.deep.equal(EVENT_SCHEMA.properties.venue);
      expect(schema.$defs.Team).to.deep.equal(EVENT_SCHEMA.properties.speakers);
      expect(viewOf()).to.deep.equal(before);

      const billing = e.use(e.root, address, { title: 'Billing address', description: 'For invoices.' });
      schema = expectConformant(e.model, 'second usage');
      expect(schema.properties.billingAddress).to.deep.equal({
        $ref: '#/$defs/Address', title: 'Billing address', description: 'For invoices.',
      });
      const withBilling = viewOf();
      expect(withBilling['/data/billingAddress']).to.include({ label: 'Billing address', description: 'For invoices.' });
      expect(withBilling['/data/billingAddress/city']).to.include({ required: true });

      e.run(renameDef, { defId: address, name: 'PostalAddress' });
      schema = expectConformant(e.model, 'renamed');
      expect(Object.keys(schema.$defs)).to.deep.equal(['PostalAddress', 'Team']);
      expect(schema.properties.billingAddress.$ref).to.equal('#/$defs/PostalAddress');
      expect(viewOf()).to.deep.equal(withBilling);

      // A component inside a component.
      const defNode = e.model.defs.find((d) => d.id === address).node.id;
      const geo = e.add(defNode, 'group', { title: 'Geo' });
      e.add(geo, 'number', { title: 'Latitude', minimum: -90, maximum: 90 });
      e.run(makeComponent, { nodeId: geo, name: 'Geo' });
      schema = expectConformant(e.model, 'nested');
      expect(schema.$defs.PostalAddress.properties.geo).to.deep.equal({ $ref: '#/$defs/Geo' });
      expect(viewOf()['/data/billingAddress/geo/latitude']).to.deep.include({ validation: { minimum: -90, maximum: 90 } });
      const nested = viewOf();

      e.run(detachRef, { nodeId: billing });
      expectConformant(e.model, 'detached');
      expect(viewOf()).to.deep.equal(nested);

      e.run(deleteDef, { defId: address });
      e.run(deleteDef, { defId: team });
      schema = expectConformant(e.model, 'deleted');
      expect(Object.keys(schema.$defs)).to.deep.equal(['Geo']);
      expect(viewOf()).to.deep.equal(nested);
    });

    it('can be a List entry and the root of a List schema', () => {
      const e = editor({ name: 'cards', title: 'Cards', rootElement: 'list' });
      const card = e.add(e.root, 'group', { title: 'Card' });
      e.add(card, 'text', { title: 'Heading', required: true });
      e.add(card, 'boolean', { title: 'Featured', default: false });
      let schema = expectConformant(e.model, 'list root');
      expect(schema).to.deep.include({ type: 'array', title: 'Cards' });
      expect(schema.items.required).to.deep.equal(['heading']);
      const before = sdkView(schema).view;

      e.run(makeComponent, { nodeId: card, name: 'Card' });
      schema = expectConformant(e.model, 'list root component');
      expect(schema.items).to.deep.equal({ $ref: '#/$defs/Card' });
      expect(sdkView(schema).view).to.deep.equal(before);
    });
  });

  it('changes any element into any other without producing an invalid schema', () => {
    const SETTINGS = {
      text: { maxLength: 10, pattern: PATTERNS.slug, default: 'abc' },
      longText: { minLength: 1, default: 'Long' },
      choice: { enum: ['Beginner', 'Expert'], default: 'Expert' },
      number: { minimum: 1.5, maximum: 9, default: 2.5 },
      integer: { minimum: 1, maximum: 9, default: 3 },
      boolean: { default: true, readOnly: true },
      date: { default: '2026-03-01' },
      time: { default: '09:30' },
      dateTime: { default: '2026-03-01T09:00:00Z' },
      group: {},
      list: { minItems: 1, maxItems: 4 },
    };
    const EXPECTED_VIEW = {
      text: { kind: 'string' },
      longText: { kind: 'string', semanticType: 'long-text' },
      choice: { kind: 'string' },
      number: { kind: 'number' },
      integer: { kind: 'integer' },
      boolean: { kind: 'boolean' },
      date: { kind: 'string', format: 'date' },
      time: { kind: 'string', format: 'time' },
      dateTime: { kind: 'string', format: 'date-time' },
      group: { kind: 'object' },
      list: { kind: 'array' },
    };
    const elements = Object.keys(ELEMENTS);
    expect(elements).to.have.members(Object.keys(SETTINGS));
    let conformant = 0;
    elements.forEach((from) => elements.forEach((to) => {
      const label = `${from} → ${to}`;
      const e = editor();
      const id = e.add(e.root, from, {
        title: 'Field', description: 'Help.', required: true, ...SETTINGS[from],
      });
      if (from === 'group') e.add(id, 'text', { title: 'Inner', required: true });
      if (from === 'list') e.add(id, 'group', { title: 'Entry' });
      if (from === 'list') e.add(getNode(e.model, id).item.id, 'date', { title: 'When' });
      expectConformant(e.model, `${label} (before)`);
      e.run(changeElement, { nodeId: id, element: to });
      const codes = errorsOf(e.model).map((i) => i.code);
      // A Group needs a field and a List an entry type: the editor asks for them before Save.
      const expected = { group: from === 'list' ? [] : ['empty-group'], list: ['group', 'list'].includes(from) ? [] : ['R6-missing-items'] };
      expect(codes, label).to.deep.equal(from === to ? [] : expected[to] ?? []);
      if (codes.length) return;
      const schema = expectConformant(e.model, label);
      expect(sdkView(schema).view['/data/field'], label).to.deep.include({
        ...EXPECTED_VIEW[to], label: 'Field', description: 'Help.', required: true,
      });
      conformant += 1;
    }));
    expect(conformant).to.be.greaterThan(100);
  });

  describe('imported schemas', () => {
    const wrap = (fragment) => ({
      type: 'object',
      title: 'Root',
      properties: { p: fragment, b: { type: 'string', title: 'B' }, c: { $ref: '#/$defs/Card' } },
      $defs: { Card: { type: 'object', title: 'Card', properties: { a: { type: 'string', title: 'A' } } } },
    });
    // [fragment, editor error, SDK reason (null: the SDK compiles it), breaks schema-spec.md]
    const cases = [
      [{ title: 'X' }, 'R1-missing-type', 'missing-type', true],
      [{ type: ['string', 'null'], title: 'X' }, 'R3-type-array', 'type-as-array', true],
      [{ type: 'null', title: 'X' }, 'R2-unsupported-type', 'unsupported-type', true],
      [{ title: 'X', oneOf: [{ type: 'string' }, { type: 'number' }] }, 'unsupported-composition', 'unsupported-composition', true],
      [{
        type: 'object', title: 'X', allOf: [{ properties: {} }], properties: { a: { type: 'string', title: 'A' } },
      }, 'unsupported-composition', 'unsupported-composition', true],
      [{ $ref: 'https://example.com/x.json' }, 'R8-external-ref', 'external-ref', true],
      [{ $ref: '#/$defs/Missing' }, 'R8-unresolved-ref', 'unresolved-ref', true],
      [{ type: 'array', title: 'X', items: [{ type: 'string', title: 'A' }] }, 'R6-tuple-items', 'missing-type', true],
      [{ type: 'array', title: 'X' }, 'R6-missing-items', 'missing-type', true],
      [{ type: 'string', title: 'X', pattern: '(' }, 'invalid-pattern', 'invalid-pattern', true],
      [{ type: 'string', title: 'X', pattern: '[\\u{1F600}-\\u{1F64F}]' }, 'invalid-pattern', 'invalid-pattern', true],
      [{ type: 'string' }, 'R4-missing-title', null, true],
      // Not schema errors, but documents could never be valid / authored.
      [{ type: 'object', title: 'X', properties: {} }, 'empty-group', null, false],
      [{
        type: 'string', title: 'X', format: 'date', default: '2026-02-30',
      }, 'default-invalid', null, false],
    ];

    cases.forEach(([fragment, code, reason, breaksSpec]) => {
      it(`${JSON.stringify(fragment)} blocks Save and is kept as-is`, () => {
        const json = wrap(fragment);
        const { model } = parseSchema(structuredClone(json), { name: 'imported' });
        const errors = errorsOf(model).filter((i) => i.schemaPath === '/properties/p').map((i) => i.code);
        expect(errors).to.deep.equal([code]);
        expect(serializeSchema(model)).to.deep.equal(json);
        const issues = validateSchema({ schema: json }).schemaIssues;
        if (reason) expect(issues.map((i) => i.reason)).to.include(reason);
        else expect(issues).to.deep.equal([]);
        expect(specProblems(json).length > 0).to.equal(breaksSpec);
      });
    });

    it('the spec example round-trips unchanged', () => {
      const { model } = parseSchema(structuredClone(COMPLETE_EXAMPLE), { name: 'example' });
      expect(expectConformant(model, 'complete example')).to.deep.equal(COMPLETE_EXAMPLE);
    });
  });

  it('never saves a schema the SDK or the spec rejects (randomized editing)', () => {
    const SEQUENCES = 200;
    const STEPS = 30;
    const VALID = {
      title: ['Name', 'Full name', 'E-mail address', 'Ünïcode label', 'Start date'],
      key: ['custom', 'my-key', 'camelCase'],
      description: [undefined, 'Shown under the field.'],
      flag: [undefined, true],
      count: [undefined, 0, 1, 3, 10],
      pattern: [undefined, ...Object.values(PATTERNS), '^\\d+\\-\\d+$', '^\\p{L}+$'],
      text: [undefined, 'a', 'abc', 'my-slug', 'Option 1', 'Expert', '😀', '2024-02-29', '09:30',
        '2026-03-01T09:00:00Z', '2026-03-01T09:00:00.000Z'],
      enum: [['Option 1', 'Option 2'], ['Beginner', 'Expert'], ['a', 'long-value']],
      number: [undefined, 0, 1, 5, 2.5, -10, 1000],
      boolean: [undefined, true, false],
    };
    const INVALID = {
      title: ['', '  ', '1st place', 'metadata', 'Section metadata', 'Name'],
      key: ['1x', 'metadata', 'a b', '', 'name'],
      count: [-1, 2.5],
      pattern: ['(', '[\\u{1F600}-\\u{1F64F}]'],
      text: ['', '2023-02-29', '24:00', '2026-03-01T09:00:30Z'],
      enum: [['A', 'A'], [], ['A', ' ']],
    };
    const FIELDS = {
      string: [['minLength', 'count'], ['maxLength', 'count'], ['pattern', 'pattern'], ['default', 'text']],
      number: [['minimum', 'number'], ['maximum', 'number'], ['default', 'number']],
      boolean: [['default', 'boolean']],
      array: [['minItems', 'count'], ['maxItems', 'count']],
      object: [],
      ref: [],
    };
    FIELDS.integer = FIELDS.number;
    const DEF_NAMES = ['Card', 'Address', 'card_2', '1bad', 'Card'];

    let clean = 0;
    let blocked = 0;
    let withDefs = 0;
    for (let seed = 1; seed <= SEQUENCES; seed += 1) {
      // Park–Miller PRNG: reproducible without bit operations.
      let state = seed * 7919;
      const random = () => {
        state = (state * 48271) % 2147483647;
        return state / 2147483647;
      };
      const pick = (list) => list[Math.floor(random() * list.length)];
      const value = (kind) => (INVALID[kind] && random() < 0.12
        ? pick(INVALID[kind]) : pick(VALID[kind]));
      const e = editor();
      const log = [];
      const entries = () => [...walk(e.model)];
      const nodes = (test) => entries().map((entry) => entry.node).filter(test);
      const containers = () => nodes((n) => n.kind === 'object' || n.kind === 'array');
      const patchFor = (node, isRoot) => {
        const patch = {};
        const options = isRoot ? [['title', 'title'], ['description', 'description']] : [
          ['title', 'title'], ['description', 'description'], ['required', 'flag'], ['key', 'key'],
          ...(node.kind === 'ref' ? [] : [['readOnly', 'flag']]),
          ...FIELDS[node.kind],
          ...(node.variant === 'choice' ? [['enum', 'enum']] : []),
        ];
        const count = 1 + Math.floor(random() * 3);
        for (let i = 0; i < count; i += 1) {
          const [field, kind] = pick(options);
          patch[field] = value(kind);
        }
        return patch;
      };
      const OPS = {
        add() {
          const parent = pick(containers());
          const element = pick(Object.keys(ELEMENTS));
          const id = e.add(parent.id, element, { title: value('title') });
          const node = getNode(e.model, id);
          e.edit(id, patchFor(node, false));
          return `add ${element} to ${parent.title}`;
        },
        use() {
          if (!e.model.defs.length) return 'use: none';
          const parent = pick(containers());
          const def = pick(e.model.defs);
          e.use(parent.id, def.id, random() < 0.5 ? { title: value('title') } : {});
          return `use ${def.name} in ${parent.title}`;
        },
        edit() {
          const node = pick(nodes(() => true));
          const patch = patchFor(node, node.id === e.root);
          e.edit(node.id, patch);
          return `edit ${node.title} ${JSON.stringify(patch)}`;
        },
        move() {
          const node = pick(nodes((n) => n.id !== e.root));
          const target = pick(containers().filter((c) => !isDescendant(node, c.id)));
          if (!node || !target) return 'move: none';
          const index = Math.floor(random() * ((target.children?.length ?? 0) + 1));
          e.run(moveNode, {
            nodeId: node.id, parentId: target.id, index, replace: target.kind === 'array',
          });
          return `move ${node.title} to ${target.title}`;
        },
        remove() {
          const node = pick(nodes((n) => n.id !== e.root));
          if (!node) return 'remove: none';
          e.run(removeNode, { nodeId: node.id });
          return `remove ${node.title}`;
        },
        duplicate() {
          const node = pick(nodes((n) => n.id !== e.root));
          if (!node) return 'duplicate: none';
          e.run(duplicateNode, { nodeId: node.id });
          return `duplicate ${node.title}`;
        },
        change() {
          const node = pick(nodes((n) => n.kind !== 'ref'));
          const element = pick(Object.keys(ELEMENTS));
          e.run(changeElement, { nodeId: node.id, element });
          return `change ${node.title} to ${element}`;
        },
        component() {
          let node = pick(nodes((n) => n.id !== e.root && ['object', 'array'].includes(n.kind)));
          if (!node) {
            const group = e.add(e.root, 'group', { title: value('title') });
            e.add(group, pick(['text', 'number', 'date']), { title: value('title') });
            node = getNode(e.model, group);
          }
          const name = random() < 0.5 ? undefined : pick(DEF_NAMES);
          e.run(makeComponent, { nodeId: node.id, name });
          return `make ${node.title} a component ${name ?? ''}`;
        },
        detach() {
          const node = pick(nodes((n) => n.kind === 'ref'));
          if (!node) return 'detach: none';
          e.run(detachRef, { nodeId: node.id });
          return 'detach';
        },
        deleteDef() {
          if (!e.model.defs.length) return 'delete: none';
          const def = pick(e.model.defs);
          e.run(deleteDef, { defId: def.id });
          return `delete ${def.name}`;
        },
        renameDef() {
          if (!e.model.defs.length) return 'rename: none';
          const def = pick(e.model.defs);
          const name = pick(DEF_NAMES);
          e.run(renameDef, { defId: def.id, name });
          return `rename ${def.name} to ${name}`;
        },
        fix() {
          const issue = pick(errorsOf(e.model).filter((i) => i.fix));
          if (!issue) return 'fix: none';
          e.run((model) => issue.fix.run(model));
          return `fix ${issue.code}`;
        },
      };
      const WEIGHTS = [
        ['add', 6], ['edit', 6], ['fix', 4], ['move', 2], ['remove', 2], ['duplicate', 1],
        ['change', 2], ['component', 2], ['use', 2], ['detach', 1], ['deleteDef', 1], ['renameDef', 1],
      ];
      const OP_NAMES = WEIGHTS.flatMap(([name, weight]) => Array(weight).fill(name));

      for (let step = 0; step < STEPS; step += 1) {
        const op = pick(OP_NAMES);
        const fail = (what, detail) => {
          throw new Error(`seed ${seed}, step ${step}: ${what}\n${JSON.stringify(detail, null, 1)}\n`
            + `steps: ${log.join(' → ')}\nschema: ${JSON.stringify(serializeSchema(e.model))}`);
        };
        try {
          log.push(OPS[op]());
        } catch (err) {
          if (!(err instanceof CommandError)) fail(`${op} threw`, err.stack);
          log.push(`${op}: ${err.message}`);
        }
        const schema = serializeSchema(e.model);
        const reopened = serializeSchema(parseSchema(structuredClone(schema), { name: 'event' }).model);
        if (JSON.stringify(reopened) !== JSON.stringify(schema)) fail('reopening changes the schema', reopened);

        if (errorsOf(e.model).length) {
          blocked += 1;
        } else {
          clean += 1;
          if (e.model.defs.length) withDefs += 1;
          const sdk = validateSchema({ schema });
          if (!sdk.valid) fail('SDK rejects a schema the editor would save', sdk.schemaIssues);
          const problems = specProblems(schema);
          if (problems.length) fail('spec violations in a schema the editor would save', problems);
          const missing = newDocumentErrors(schema);
          if (Object.values(missing).some((k) => !NEW_DOCUMENT_KEYWORDS.includes(k))) {
            fail('a new document starts with invalid defaults', missing);
          }
        }
      }
    }
    // Make sure both outcomes were exercised in volume, components included.
    expect(clean).to.be.greaterThan(SEQUENCES * STEPS * 0.25);
    expect(blocked).to.be.greaterThan(SEQUENCES * STEPS * 0.1);
    expect(withDefs).to.be.greaterThan(50);
  });

  it('saves through the store exactly what the SDK accepts, and keeps saved data valid', async () => {
    const saves = [];
    const repository = {
      read: async () => ({ json: structuredClone(saves.at(-1).json) }),
      save: async (args) => {
        saves.push(structuredClone(args));
        return { ok: true };
      },
    };
    const store = new SchemaStore({
      org: 'o', site: 's', name: 'event', repository, validateSchema, bus: createSchemaBus(),
    });
    store.open(createModel({ name: 'event', title: 'Event' }), { saved: false });
    const add = (parentId, element, patch) => {
      const parent = getNode(store.model, parentId);
      const node = createNode(element, { siblingKeys: siblingKeys(parent) });
      const { result } = store.dispatch(insertNode, { parentId, node, replace: parent.kind === 'array' });
      store.dispatch(updateNode, { nodeId: result.nodeId, patch: { title: patch.title } });
      store.dispatch(updateNode, { nodeId: result.nodeId, patch });
      return result.nodeId;
    };
    const root = store.model.root.id;
    add(root, 'text', { title: 'Headline', required: true, maxLength: 120 });
    const code = add(root, 'text', { title: 'Code', pattern: '(' });
    expect(await store.save()).to.deep.equal({ ok: false, error: 'Fix 1 error to save.' });
    expect(saves.length).to.equal(0);

    store.dispatch(updateNode, { nodeId: code, patch: { pattern: '^[A-Z]{3}$' } });
    const cards = add(root, 'list', { title: 'Cards', maxItems: 3 });
    const card = add(cards, 'group', { title: 'Card' });
    add(card, 'text', { title: 'Heading', required: true });
    store.dispatch(makeComponent, { nodeId: card, name: 'Card' });
    expect(await store.save()).to.deep.equal({ ok: true });

    const v1 = saves[0].json;
    expect(saves[0]).to.deep.include({ org: 'o', site: 's', name: 'event' });
    expect(v1).to.deep.equal({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {
        Card: {
          type: 'object', title: 'Card', required: ['heading'], properties: { heading: { type: 'string', title: 'Heading' } },
        },
      },
      type: 'object',
      title: 'Event',
      required: ['headline'],
      properties: {
        headline: { type: 'string', title: 'Headline', maxLength: 120 },
        code: { type: 'string', title: 'Code', pattern: '^[A-Z]{3}$' },
        cards: {
          type: 'array', title: 'Cards', maxItems: 3, items: { $ref: '#/$defs/Card' },
        },
      },
    });
    expect(validateSchema({ schema: v1 }).valid).to.equal(true);
    expect(specProblems(v1)).to.deep.equal([]);
    const document = { headline: 'Hello', code: 'ABC', cards: [{ heading: 'One' }] };
    expect(validateData({ schema: v1, data: document }).valid).to.equal(true);

    // Saved keys stay put when labels change, so documents written against v1 stay valid.
    const headline = [...walk(store.model)].find(({ node }) => node.key === 'headline').node.id;
    store.dispatch(updateNode, { nodeId: headline, patch: { title: 'Title' } });
    expect(await store.save()).to.deep.equal({ ok: true });
    const v2 = saves[1].json;
    expect(v2.properties.headline.title).to.equal('Title');
    expect(validateData({ schema: v2, data: document }).valid).to.equal(true);

    expect(await store.load()).to.equal(true);
    expect(serializeSchema(store.model)).to.deep.equal(v2);
  });
});
