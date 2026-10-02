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
// Every construct of https://github.com/adobe/da-sc-sdk/blob/main/docs/schema-spec.md
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Kind, parse, buildASTSchema } from '../../../../../tools/deps/graphql/dist/index.js';
import { generateSdl } from '../../../../../tools/apps/graphql/core/sdl.js';

const gen = (schema, id = 'doc') => {
  const result = generateSdl({ schemas: [{ id, schema }] });
  assert.deepEqual(result.errors, []);
  return result;
};

const clean = (schema, id) => {
  const { sdl, warnings } = gen(schema, id);
  assert.deepEqual(warnings, []);
  return sdl;
};

const fields = (sdl, typeName) => Object.values(buildASTSchema(parse(sdl))
  .getType(typeName).getFields());
const fieldsOf = (sdl, typeName) => Object.fromEntries(fields(sdl, typeName)
  .map(({ name, type }) => [name, String(type)]));
const descriptionsOf = (sdl, typeName) => Object.fromEntries(fields(sdl, typeName)
  .map(({ name, description }) => [name, description]));
const typeNames = (sdl) => parse(sdl).definitions
  .filter(({ kind }) => kind !== Kind.DIRECTIVE_DEFINITION)
  .map(({ name }) => name.value)
  .sort();
const sources = (sdl) => [...sdl.matchAll(/(\w+): \S+ @source\(key: "([^"]+)"\)/g)]
  .map(([, field, key]) => [field, key]);
const pointers = (warnings) => warnings.map(({ pointer }) => pointer);

const str = (title, extra = {}) => ({ type: 'string', title, ...extra });
const doc = (properties, extra = {}) => ({
  type: 'object', title: 'Doc', properties, ...extra,
});
const ENVELOPE = ['PageInfo', 'Query'];

describe('schema spec §2: types', () => {
  it('maps every primitive type', () => {
    const sdl = clean(doc({
      name: str('Name'),
      score: { type: 'number', title: 'Score' },
      age: { type: 'integer', title: 'Age' },
      subscribed: { type: 'boolean', title: 'Subscribed' },
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      name: 'String', score: 'Float', age: 'Int', subscribed: 'Boolean',
    });
  });

  it('maps an object to a named type with exactly its properties', () => {
    const sdl = clean(doc({
      contact: {
        type: 'object',
        title: 'Contact',
        required: ['name'],
        properties: { name: str('Name'), email: str('Email') },
      },
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { contact: 'DocContact' });
    assert.deepEqual(fieldsOf(sdl, 'DocContact'), { name: 'String', email: 'String' });
    assert.deepEqual(typeNames(sdl), [...ENVELOPE, 'Doc', 'DocConnection', 'DocContact', 'DocItem'].sort());
  });

  it('maps arrays of primitives, objects and arrays', () => {
    const sdl = clean(doc({
      tags: { type: 'array', title: 'Tags', items: str('Tag') },
      scores: { type: 'array', title: 'Scores', items: { type: 'number', title: 'Score' } },
      ranks: { type: 'array', title: 'Ranks', items: { type: 'integer', title: 'Rank' } },
      flags: { type: 'array', title: 'Flags', items: { type: 'boolean', title: 'Flag' } },
      contacts: {
        type: 'array',
        title: 'Contacts',
        items: { type: 'object', title: 'Contact', properties: { name: str('Name') } },
      },
      matrix: {
        type: 'array',
        title: 'Matrix',
        items: { type: 'array', title: 'Row', items: { type: 'number', title: 'Cell' } },
      },
      rows: {
        type: 'array',
        title: 'Rows',
        items: {
          type: 'array',
          title: 'Row',
          items: { type: 'object', title: 'Cell', properties: { value: { type: 'number', title: 'Value' } } },
        },
      },
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      tags: '[String]',
      scores: '[Float]',
      ranks: '[Int]',
      flags: '[Boolean]',
      contacts: '[DocContact]',
      matrix: '[[Float]]',
      rows: '[[DocRowItem]]',
    });
    assert.deepEqual(fieldsOf(sdl, 'DocContact'), { name: 'String' });
    assert.deepEqual(fieldsOf(sdl, 'DocRowItem'), { value: 'Float' });
  });

  it('follows the nesting example', () => {
    const sdl = clean({
      type: 'object',
      title: 'Order',
      properties: {
        customer: {
          type: 'object',
          title: 'Customer',
          properties: {
            address: {
              type: 'object',
              title: 'Address',
              properties: { city: str('City'), country: str('Country') },
            },
          },
        },
        lineItems: {
          type: 'array',
          title: 'Line items',
          items: {
            type: 'object',
            title: 'Line item',
            properties: {
              sku: str('SKU'),
              quantity: { type: 'integer', title: 'Quantity', minimum: 1 },
            },
          },
        },
      },
    }, 'order');
    assert.deepEqual(fieldsOf(sdl, 'Order'), { customer: 'OrderCustomer', lineItems: '[OrderLineItem]' });
    assert.deepEqual(fieldsOf(sdl, 'OrderCustomer'), { address: 'OrderCustomerAddress' });
    assert.deepEqual(fieldsOf(sdl, 'OrderCustomerAddress'), { city: 'String', country: 'String' });
    assert.deepEqual(fieldsOf(sdl, 'OrderLineItem'), { sku: 'String', quantity: 'Int' });
    assert.deepEqual(typeNames(sdl), [...ENVELOPE, 'Order', 'OrderConnection', 'OrderCustomer',
      'OrderCustomerAddress', 'OrderItem', 'OrderLineItem'].sort());
  });
});

describe('schema spec R11: root', () => {
  const contact = { type: 'object', title: 'Contact', properties: { name: str('Name') } };

  it('maps an object root to the data type', () => {
    assert.equal(fieldsOf(clean(doc({ name: str('Name') })), 'DocItem').data, 'Doc');
  });

  it('maps an array root of primitives, objects, arrays and $refs', () => {
    const data = (schema) => fieldsOf(clean(schema, 'list'), 'ListItem').data;
    assert.equal(data({ type: 'array', title: 'Tags', items: str('Tag') }), '[String]');
    assert.equal(data({ type: 'array', title: 'Contacts', items: contact }), '[ListEntry]');
    assert.equal(data({
      type: 'array', title: 'Matrix', items: { type: 'array', title: 'Row', items: { type: 'integer', title: 'Cell' } },
    }), '[[Int]]');
    assert.equal(data({
      $defs: { Contact: contact }, type: 'array', title: 'Contacts', items: { $ref: '#/$defs/Contact' },
    }), '[ListContact]');
    assert.deepEqual(fieldsOf(clean({ type: 'array', title: 'Contacts', items: contact }, 'list'), 'ListEntry'), { name: 'String' });
  });
});

describe('schema spec R9/R10: property keys', () => {
  it('keeps letters and digits and maps hyphens to underscores with @source', () => {
    const sdl = clean(doc({
      name: str('A'),
      firstName: str('B'),
      'first-name': str('C'),
      'My-Field': str('D'),
      field1: str('E'),
      h1: str('F'),
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      name: 'String',
      firstName: 'String',
      first_name: 'String',
      My_Field: 'String',
      field1: 'String',
      h1: 'String',
    });
    assert.deepEqual(sources(sdl), [['first_name', 'first-name'], ['My_Field', 'My-Field']]);
  });

  it('suffixes a type name produced by two different keys', () => {
    const nested = (title) => ({ type: 'object', title, properties: { value: str('Value') } });
    const { sdl, warnings } = gen(doc({ 'first-name': nested('A'), firstName: nested('B') }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { first_name: 'DocFirstName', firstName: 'DocFirstName2' });
    assert.deepEqual(pointers(warnings), ['/properties/firstName']);
  });

  it('skips the reserved keys at any depth', () => {
    const { sdl, warnings } = gen(doc({
      metadata: str('Metadata'),
      'section-metadata': str('Section metadata'),
      title: str('Title'),
      hero: {
        type: 'object',
        title: 'Hero',
        properties: { metadata: str('Metadata'), heading: str('Heading') },
      },
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { title: 'String', hero: 'DocHero' });
    assert.deepEqual(fieldsOf(sdl, 'DocHero'), { heading: 'String' });
    assert.deepEqual(pointers(warnings), [
      '/properties/metadata',
      '/properties/section-metadata',
      '/properties/hero/properties/metadata',
    ]);
  });
});

describe('schema spec §3: annotations', () => {
  it('describes fields with title and description, and types with title', () => {
    const sdl = clean(doc({
      name: str('Name'),
      summary: str('Summary', { description: 'A short abstract.' }),
      same: str('Same', { description: 'Same' }),
      contact: {
        type: 'object',
        title: 'Contact',
        description: 'Who to call.',
        properties: { email: str('Email') },
      },
    }));
    assert.deepEqual(descriptionsOf(sdl, 'Doc'), {
      name: 'Name',
      summary: 'Summary\n\nA short abstract.',
      same: 'Same',
      contact: 'Contact\n\nWho to call.',
    });
    assert.equal(buildASTSchema(parse(sdl)).getType('DocContact').description, 'Contact');
  });

  it('adds nothing for default, readOnly and required, and keeps required fields nullable', () => {
    const bare = doc({
      title: str('Title'),
      priority: { type: 'integer', title: 'Priority' },
      archived: { type: 'boolean', title: 'Archived' },
      tags: { type: 'array', title: 'Tags', items: str('Tag') },
      owner: { type: 'object', title: 'Owner', properties: { name: str('Name') } },
    });
    const annotated = doc({
      title: str('Title', { default: 'Untitled', readOnly: true }),
      priority: {
        type: 'integer', title: 'Priority', default: 3, readOnly: true,
      },
      archived: { type: 'boolean', title: 'Archived', default: false },
      tags: {
        type: 'array', title: 'Tags', default: ['a'], items: str('Tag', { default: 'a' }),
      },
      owner: {
        type: 'object', title: 'Owner', required: ['name'], properties: { name: str('Name') },
      },
    }, { required: ['title', 'priority', 'archived', 'tags', 'owner'] });
    const sdl = clean(annotated);
    assert.equal(sdl, clean(bare));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      title: 'String', priority: 'Int', archived: 'Boolean', tags: '[String]', owner: 'DocOwner',
    });
  });

  it('adds nothing for x-semantic-type', () => {
    const bare = doc({ summary: str('Summary'), count: { type: 'integer', title: 'Count' } });
    const annotated = doc({
      summary: str('Summary', { 'x-semantic-type': 'long-text' }),
      count: { type: 'integer', title: 'Count', 'x-semantic-type': 'long-text' },
    });
    assert.equal(clean(annotated), clean(bare));
  });
});

describe('schema spec §4: constraints', () => {
  it('adds nothing for length, pattern, range and item-count constraints', () => {
    const bare = doc({
      slug: str('Slug'),
      priority: { type: 'integer', title: 'Priority' },
      score: { type: 'number', title: 'Score' },
      tags: { type: 'array', title: 'Tags', items: str('Tag') },
    });
    const constrained = doc({
      slug: str('Slug', { minLength: 3, maxLength: 30, pattern: '^[a-z0-9-]+$' }),
      priority: {
        type: 'integer', title: 'Priority', minimum: 1, maximum: 5,
      },
      score: {
        type: 'number', title: 'Score', minimum: 0, maximum: 100,
      },
      tags: {
        type: 'array', title: 'Tags', minItems: 1, maxItems: 10, items: str('Tag'),
      },
    });
    assert.equal(clean(constrained), clean(bare));
  });

  it('lists enum values in the description of a string field only', () => {
    const sdl = clean(doc({
      status: str('Status', { enum: ['Planning', 'Active', 'On Hold'] }),
      level: {
        type: 'integer', title: 'Level', enum: [1, 2],
      },
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { status: 'String', level: 'Int' });
    assert.deepEqual(descriptionsOf(sdl, 'Doc'), {
      status: 'Status\n\nAllowed values: "Planning", "Active", "On Hold"',
      level: 'Level',
    });
  });

  it('maps the date and time formats to scalars', () => {
    const sdl = clean(doc({
      publishDate: str('Publish date', { format: 'date' }),
      openingTime: str('Opening time', { format: 'time' }),
      eventStart: str('Event start', { format: 'date-time' }),
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { publishDate: 'Date', openingTime: 'Time', eventStart: 'DateTime' });
  });

  it('applies the precedence enum > format > x-semantic-type', () => {
    const sdl = clean(doc({
      enumFormat: str('A', { enum: ['x'], format: 'date' }),
      enumSemantic: str('B', { enum: ['x'], 'x-semantic-type': 'long-text' }),
      formatSemantic: str('C', { format: 'date', 'x-semantic-type': 'long-text' }),
      all: str('D', { enum: ['x'], format: 'time', 'x-semantic-type': 'long-text' }),
      emptyEnum: str('E', { enum: [], format: 'date-time' }),
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      enumFormat: 'String', enumSemantic: 'String', formatSemantic: 'Date', all: 'String', emptyEnum: 'DateTime',
    });
  });

  it('ignores unsupported formats and formats on other types', () => {
    const sdl = clean(doc({
      email: str('Email', { format: 'email' }),
      uri: str('URI', { format: 'uri' }),
      proto: str('Proto', { format: 'constructor' }),
      count: { type: 'integer', title: 'Count', format: 'date' },
      ratio: { type: 'number', title: 'Ratio', format: 'date-time' },
      flag: { type: 'boolean', title: 'Flag', format: 'time' },
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      email: 'String', uri: 'String', proto: 'String', count: 'Int', ratio: 'Float', flag: 'Boolean',
    });
    assert.deepEqual(typeNames(sdl), [...ENVELOPE, 'Doc', 'DocConnection', 'DocItem'].sort());
  });
});

describe('schema spec §5: $defs and $ref', () => {
  const contact = {
    type: 'object',
    title: 'Contact',
    required: ['name'],
    properties: { name: str('Name'), email: str('Email') },
  };

  it('emits one type for a definition referenced twice and none for unused ones', () => {
    const sdl = clean({
      $defs: { Contact: contact, Unused: { type: 'object', title: 'Unused', properties: { x: str('X') } } },
      type: 'object',
      title: 'Project',
      properties: {
        owner: { $ref: '#/$defs/Contact' },
        editor: { $ref: '#/$defs/Contact', title: 'Editor' },
      },
    }, 'project');
    assert.deepEqual(fieldsOf(sdl, 'Project'), { owner: 'ProjectContact', editor: 'ProjectContact' });
    assert.deepEqual(descriptionsOf(sdl, 'Project'), { owner: 'Contact', editor: 'Editor' });
    assert.deepEqual(fieldsOf(sdl, 'ProjectContact'), { name: 'String', email: 'String' });
    assert.deepEqual(typeNames(sdl), [...ENVELOPE, 'Project', 'ProjectConnection', 'ProjectContact', 'ProjectItem'].sort());
  });

  it('inlines references to primitive and array definitions', () => {
    const sdl = clean({
      $defs: {
        Day: str('Day', { format: 'date' }),
        Alias: { $ref: '#/$defs/Day' },
        Tags: { type: 'array', title: 'Tags', items: str('Tag') },
        Contacts: { type: 'array', title: 'Contacts', items: contact },
      },
      ...doc({
        day: { $ref: '#/$defs/Day' },
        alias: { $ref: '#/$defs/Alias' },
        tags: { $ref: '#/$defs/Tags' },
        contacts: { $ref: '#/$defs/Contacts' },
        backup: { $ref: '#/$defs/Contacts' },
      }),
    });
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      day: 'Date', alias: 'Date', tags: '[String]', contacts: '[DocContact]', backup: '[DocContact]',
    });
    assert.deepEqual(typeNames(sdl), [...ENVELOPE, 'Date', 'Doc', 'DocConnection', 'DocContact', 'DocItem'].sort());
  });

  it('shares one type between an inline object and a $ref to it', () => {
    const address = { type: 'object', title: 'Address', properties: { city: str('City') } };
    [
      doc({ address, billing: { $ref: '#/properties/address' } }),
      doc({ billing: { $ref: '#/properties/address' }, address }),
    ].forEach((schema) => {
      const sdl = clean(schema);
      assert.deepEqual(fieldsOf(sdl, 'Doc'), { address: 'DocAddress', billing: 'DocAddress' });
      assert.deepEqual(fieldsOf(sdl, 'DocAddress'), { city: 'String' });
    });
  });

  it('resolves definitions that reference each other, including recursion', () => {
    const sdl = clean({
      $defs: {
        Address: { type: 'object', title: 'Address', properties: { city: str('City') } },
        Contact: {
          type: 'object',
          title: 'Contact',
          properties: { name: str('Name'), address: { $ref: '#/$defs/Address' } },
        },
        Node: {
          type: 'object',
          title: 'Node',
          properties: {
            label: str('Label'),
            children: { type: 'array', title: 'Children', items: { $ref: '#/$defs/Node' } },
          },
        },
      },
      ...doc({ owner: { $ref: '#/$defs/Contact' }, tree: { $ref: '#/$defs/Node' } }),
    });
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { owner: 'DocContact', tree: 'DocNode' });
    assert.deepEqual(fieldsOf(sdl, 'DocContact'), { name: 'String', address: 'DocAddress' });
    assert.deepEqual(fieldsOf(sdl, 'DocAddress'), { city: 'String' });
    assert.deepEqual(fieldsOf(sdl, 'DocNode'), { label: 'String', children: '[DocNode]' });
  });
});

describe('schema spec §6: scope', () => {
  it('ignores keywords outside the spec', () => {
    const bare = doc({
      name: str('Name'),
      tags: { type: 'array', title: 'Tags', items: str('Tag') },
      box: { type: 'object', title: 'Box', properties: { size: { type: 'integer', title: 'Size' } } },
    });
    const noisy = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/doc',
      $comment: 'ignored',
      ...doc({
        name: str('Name', {
          const: 'x', examples: ['x'], deprecated: true, 'x-custom': 1, 'x-semantic-type': 'rich-text', items: str('X'), properties: { y: str('Y') },
        }),
        tags: {
          type: 'array', title: 'Tags', items: str('Tag'), uniqueItems: true, contains: str('Tag'),
        },
        box: {
          type: 'object',
          title: 'Box',
          properties: { size: { type: 'integer', title: 'Size', multipleOf: 2 } },
          additionalProperties: false,
          oneOf: [{ required: ['size'] }],
          patternProperties: { '^x': str('X') },
        },
      }, { additionalProperties: false, anyOf: [] }),
    };
    assert.equal(clean(noisy), clean(bare));
  });
});

describe('non-conformant input', () => {
  it('maps nodes that break R1-R3, R5, R6 or R8 to JSON with a warning', () => {
    const { sdl, warnings } = gen(doc({
      invalid: true,
      untyped: { title: 'Untyped' },
      nullType: { type: 'null', title: 'Null' },
      union: { type: ['string', 'null'], title: 'Union' },
      empty: { type: 'object', title: 'Empty' },
      noItems: { type: 'array', title: 'No items' },
      tuple: { type: 'array', title: 'Tuple', items: [str('X')] },
      external: { $ref: 'other.json#/$defs/X' },
      dangling: { $ref: '#/$defs/Missing' },
    }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), {
      invalid: 'JSON',
      untyped: 'JSON',
      nullType: 'JSON',
      union: 'JSON',
      empty: 'JSON',
      noItems: '[JSON]',
      tuple: '[JSON]',
      external: 'JSON',
      dangling: 'JSON',
    });
    assert.deepEqual(pointers(warnings), [
      '/properties/invalid',
      '/properties/untyped',
      '/properties/nullType',
      '/properties/union',
      '/properties/empty',
      '/properties/noItems',
      '/properties/tuple',
      '/properties/external',
      '/properties/dangling',
    ]);
  });

  it('suffixes a field name produced by an R9-invalid key', () => {
    const { sdl, warnings } = gen(doc({ 'a-b': str('A'), a_b: str('B') }));
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { a_b: 'String', a_b_2: 'String' });
    assert.deepEqual(sources(sdl), [['a_b', 'a-b'], ['a_b_2', 'a_b']]);
    assert.deepEqual(pointers(warnings), ['/properties/a_b']);
  });
});

describe('document envelope', () => {
  it('shapes items as path, schemaName, title and data', () => {
    const sdl = clean(doc({ title: str('Title') }));
    assert.deepEqual(fieldsOf(sdl, 'Query'), { docList: 'DocConnection!', docByPath: 'DocItem' });
    assert.deepEqual(fieldsOf(sdl, 'DocConnection'), { items: '[DocItem!]!', pageInfo: 'PageInfo!' });
    assert.deepEqual(fieldsOf(sdl, 'DocItem'), {
      path: 'String!', schemaName: 'String!', title: 'String', data: 'Doc',
    });
    assert.deepEqual(fieldsOf(sdl, 'PageInfo'), { endCursor: 'String', hasNextPage: 'Boolean!', total: 'Int' });
    assert.deepEqual(fieldsOf(sdl, 'Doc'), { title: 'String' });
  });
});
