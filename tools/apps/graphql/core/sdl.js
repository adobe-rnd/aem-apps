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
import {
  Kind, parse, print, visit, buildASTSchema, validateSchema,
} from '../../../deps/graphql/dist/index.js';

// Type and field names.

const RESERVED_TYPE_NAMES = new Set([
  'Query', 'Mutation', 'Subscription',
  'String', 'Int', 'Float', 'Boolean', 'ID',
  'JSON', 'Date', 'Time', 'DateTime', 'PageInfo',
]);

const words = (value) => String(value ?? '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[^A-Za-z0-9]+/)
  .filter(Boolean);

export function pascal(value) {
  const result = words(value)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
  if (!result) return 'Type';
  return /^[A-Za-z]/.test(result) ? result : `T${result}`;
}

export function camel(value) {
  const name = pascal(value);
  return name[0].toLowerCase() + name.slice(1);
}

export function singular(value) {
  if (/ies$/.test(value)) return `${value.slice(0, -3)}y`;
  if (/(ss|us)$/.test(value)) return value;
  if (/s$/.test(value)) return value.slice(0, -1);
  return value;
}

export function toTypeName(value) {
  const name = pascal(value);
  return RESERVED_TYPE_NAMES.has(name) ? `${name}Type` : name;
}

export function toFieldName(key) {
  const name = String(key).replace(/[^_A-Za-z0-9]/g, '_');
  if (/^__/.test(name)) return `f${name}`;
  return /^[_A-Za-z]/.test(name) ? name : `_${name}`;
}

// SC JSON Schema → graphql-js document → SDL; unsupported content becomes JSON with a warning.

const RESERVED_KEYS = new Set(['metadata', 'section-metadata']);
const FORMAT_SCALARS = new Map([['date', 'Date'], ['time', 'Time'], ['date-time', 'DateTime']]);

// Definitions shared by every endpoint; unused scalars are dropped.
const PRELUDE = parse(`
"""Arbitrary JSON value."""
scalar JSON

"""Floating calendar date: YYYY-MM-DD."""
scalar Date

"""Floating 24-hour wall-clock time: HH:MM or HH:MM:SS."""
scalar Time

"""Absolute instant in UTC: YYYY-MM-DDTHH:MM:00Z."""
scalar DateTime

"""Original JSON key when it differs from the GraphQL field name."""
directive @source(key: String!) on FIELD_DEFINITION

"""
Structured Content schema id (document metadata.schemaName) backing a query field.
"""
directive @schema(id: String!) on FIELD_DEFINITION

type PageInfo {
  endCursor: String
  hasNextPage: Boolean!
  total: Int
}
`, { noLocation: true }).definitions;

const toName = (value) => ({ kind: Kind.NAME, value });
const named = (value) => ({ kind: Kind.NAMED_TYPE, name: toName(value) });
const nonNull = (type) => ({ kind: Kind.NON_NULL_TYPE, type });
const listOf = (type) => ({ kind: Kind.LIST_TYPE, type });
const describe = (text) => (text
  ? { kind: Kind.STRING, value: String(text).trim(), block: true }
  : undefined);

const inputValue = ({ name, type, defaultValue }) => ({
  kind: Kind.INPUT_VALUE_DEFINITION, name: toName(name), type, defaultValue, directives: [],
});

const applyDirective = ({ name, arg, value }) => ({
  kind: Kind.DIRECTIVE,
  name: toName(name),
  arguments: [{
    kind: Kind.ARGUMENT, name: toName(arg), value: { kind: Kind.STRING, value },
  }],
});

const fieldDef = ({
  name, type, description, args = [], directives = [],
}) => ({
  kind: Kind.FIELD_DEFINITION,
  description: describe(description),
  name: toName(name),
  arguments: args,
  type,
  directives,
});

const objectDef = ({ name, description, fields }) => ({
  kind: Kind.OBJECT_TYPE_DEFINITION,
  description: describe(description),
  name: toName(name),
  interfaces: [],
  directives: [],
  fields,
});

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

const byId = (a, b) => {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

const escapePointer = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const unescapePointer = (seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~');

const hasEnum = (node) => Array.isArray(node.enum) && node.enum.length > 0;

function fieldDescription(node) {
  if (!isPlainObject(node)) return '';
  const parts = [node.title, node.description !== node.title && node.description];
  if (node.type === 'string' && hasEnum(node)) {
    parts.push(`Allowed values: ${node.enum.map((value) => JSON.stringify(value)).join(', ')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

const usableProperties = (node) => (isPlainObject(node?.properties)
  ? Object.keys(node.properties).filter((key) => !RESERVED_KEYS.has(key))
  : []);

// The first `make(i)`, from i = 2, that is not taken.
const firstFree = ({ isTaken, make, i = 2 }) => (isTaken(make(i))
  ? firstFree({ isTaken, make, i: i + 1 })
  : make(i));

function registerRoots({ schemas, errors, warn }) {
  const owners = new Map();
  return [...schemas].filter((entry) => entry?.id).sort(byId).reduce((acc, { id, schema }) => {
    if (schema?.type !== 'object' && schema?.type !== 'array') {
      warn(id, '', 'The schema root must be an object or an array. The schema was skipped.');
      return acc;
    }
    const root = toTypeName(id);
    const names = [root, `${root}Item`, `${root}Connection`];
    const clash = names.find((name) => owners.has(name));
    if (clash) {
      errors.push({
        schemaId: id,
        pointer: '',
        message: `Schemas "${owners.get(clash)}" and "${id}" both produce the GraphQL type "${clash}". Rename one of them or leave one out of the endpoint.`,
      });
      return acc;
    }
    names.forEach((name) => owners.set(name, id));
    acc.push({ id, schema, root });
    return acc;
  }, []);
}

function envelope({ root, title, dataType }) {
  const label = title || root;
  return [
    objectDef({
      name: `${root}Item`,
      description: `A ${label} document.`,
      fields: [
        fieldDef({ name: 'path', type: nonNull(named('String')), description: 'DA path of the document.' }),
        fieldDef({ name: 'schemaName', type: nonNull(named('String')), description: 'Schema id of the document.' }),
        fieldDef({ name: 'title', type: named('String'), description: 'Document title.' }),
        fieldDef({ name: 'data', type: dataType, description: 'Structured content of the document.' }),
      ],
    }),
    objectDef({
      name: `${root}Connection`,
      description: `A page of ${label} documents.`,
      fields: [
        fieldDef({ name: 'items', type: nonNull(listOf(nonNull(named(`${root}Item`)))) }),
        fieldDef({ name: 'pageInfo', type: nonNull(named('PageInfo')) }),
      ],
    }),
  ];
}

function queryFields({ id, root, title }) {
  const label = title || root;
  const directives = [applyDirective({ name: 'schema', arg: 'id', value: id })];
  return [
    fieldDef({
      name: `${camel(root)}List`,
      description: `List ${label} documents.`,
      args: [
        inputValue({ name: 'first', type: named('Int'), defaultValue: { kind: Kind.INT, value: '20' } }),
        inputValue({ name: 'after', type: named('String') }),
      ],
      type: nonNull(named(`${root}Connection`)),
      directives,
    }),
    fieldDef({
      name: `${camel(root)}ByPath`,
      description: `Get a single ${label} document by its DA path.`,
      args: [inputValue({ name: 'path', type: nonNull(named('String')) })],
      type: named(`${root}Item`),
      directives,
    }),
  ];
}

function buildSchemaTypes({ entry, taken, warn }) {
  const { id, schema, root } = entry;
  const order = [];
  const defs = new Map();
  const refCache = new Map();
  const resolving = new Set();

  const json = () => named('JSON');

  const reserve = (base, pointer) => {
    const name = toTypeName(base);
    if (!taken.has(name)) {
      taken.add(name);
      order.push(name);
      return name;
    }
    const next = firstFree({ isTaken: (candidate) => taken.has(candidate), make: (i) => `${name}${i}` });
    warn(id, pointer, `The type name "${name}" is already used; generated "${next}" instead.`);
    taken.add(next);
    order.push(next);
    return next;
  };

  const resolvePointer = (ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
    return ref.slice(2).split('/').map(unescapePointer)
      .reduce((node, seg) => (isPlainObject(node) ? node[seg] : undefined), schema);
  };

  const stringType = (node) => named((!hasEnum(node) && FORMAT_SCALARS.get(node.format)) || 'String');

  // Assigned below: the object, reference and array types recurse through it.
  let typeExpr;

  const objectType = (node, name, pointer) => {
    const used = new Set();
    const fields = Object.entries(node.properties).map(([key, child]) => {
      const childPointer = `${pointer}/properties/${escapePointer(key)}`;
      if (RESERVED_KEYS.has(key)) {
        warn(id, childPointer, `"${key}" is a reserved key and was skipped.`);
        return undefined;
      }
      const base = toFieldName(key);
      const field = used.has(base)
        ? firstFree({ isTaken: (candidate) => used.has(candidate), make: (i) => `${base}_${i}` })
        : base;
      if (field !== base) {
        warn(id, childPointer, `The field name "${base}" is already used; generated "${field}" instead.`);
      }
      used.add(field);
      const type = typeExpr(child, `${name}${pascal(key)}`, childPointer);
      const target = isPlainObject(child) && child.$ref ? resolvePointer(child.$ref) : undefined;
      return fieldDef({
        name: field,
        type,
        description: fieldDescription({ ...(isPlainObject(target) ? target : {}), ...child }),
        directives: field === key ? [] : [applyDirective({ name: 'source', arg: 'key', value: key })],
      });
    }).filter(Boolean);
    return objectDef({ name, description: node.title, fields });
  };

  // Cached by pointer, so an inline object and a $ref to it share one type.
  const namedObject = (node, base, pointer) => {
    const key = `#${pointer}`;
    if (refCache.has(key)) return refCache.get(key);
    const name = reserve(base, pointer);
    refCache.set(key, named(name));
    defs.set(name, objectType(node, name, pointer));
    return named(name);
  };

  const refType = (ref, pointer) => {
    if (refCache.has(ref)) return refCache.get(ref);
    const target = resolvePointer(ref);
    if (!isPlainObject(target)) {
      warn(id, pointer, `Cannot resolve $ref "${ref}"; mapped to JSON.`);
      return json();
    }
    if (resolving.has(ref)) {
      warn(id, pointer, `Recursive $ref "${ref}" does not pass through an object; mapped to JSON.`);
      return json();
    }
    const base = `${root}${pascal(ref.split('/').pop())}`;
    const targetPointer = ref.slice(1);
    if (target.type === 'object' && usableProperties(target).length) {
      return namedObject(target, base, targetPointer);
    }
    resolving.add(ref);
    const expr = typeExpr(target, base, targetPointer);
    resolving.delete(ref);
    refCache.set(ref, expr);
    return expr;
  };

  const arrayType = (node, itemBase, pointer) => {
    if (!isPlainObject(node.items)) {
      warn(id, pointer, 'The array has no single "items" schema; mapped to [JSON].');
      return listOf(json());
    }
    return listOf(typeExpr(node.items, itemBase, `${pointer}/items`));
  };

  typeExpr = (node, base, pointer) => {
    if (!isPlainObject(node)) {
      warn(id, pointer, 'Invalid schema node; mapped to JSON.');
      return json();
    }
    if (node.$ref !== undefined) return refType(node.$ref, pointer);
    switch (node.type) {
      case 'object':
        if (usableProperties(node).length) return namedObject(node, base, pointer);
        warn(id, pointer, 'The object has no properties; mapped to JSON.');
        return json();
      case 'array': {
        const itemBase = singular(base) === base ? `${base}Item` : singular(base);
        return arrayType(node, itemBase, pointer);
      }
      case 'string': return stringType(node);
      case 'integer': return named('Int');
      case 'number': return named('Float');
      case 'boolean': return named('Boolean');
      default:
        warn(id, pointer, `Unsupported or missing type "${node.type ?? ''}"; mapped to JSON.`);
        return json();
    }
  };

  const rootType = () => {
    if (schema.type === 'array') return arrayType(schema, `${root}Entry`, '');
    if (usableProperties(schema).length) {
      order.unshift(root);
      defs.set(root, objectType(schema, root, ''));
      return named(root);
    }
    warn(id, '', 'The schema root has no properties; data is mapped to JSON.');
    return json();
  };
  const dataType = rootType();

  const types = order.map((name) => defs.get(name));
  return [...types, ...envelope({ root, title: schema.title, dataType })];
}

function findSchemaErrors(ast) {
  try {
    return validateSchema(buildASTSchema(ast)).map(({ message }) => message);
  } catch (error) {
    return [error.message];
  }
}

export function generateSdl({ schemas = [] } = {}) {
  const warnings = [];
  const errors = [];
  const warn = (schemaId, pointer, message) => warnings.push({ schemaId, pointer, message });

  const roots = registerRoots({ schemas, errors, warn });
  if (!roots.length) {
    errors.push({ schemaId: '', pointer: '', message: 'There is no valid schema to generate from.' });
    return { sdl: '', warnings, errors };
  }

  const taken = new Set(RESERVED_TYPE_NAMES);
  roots.forEach(({ root }) => [root, `${root}Item`, `${root}Connection`].forEach((name) => taken.add(name)));

  const typeBlocks = roots.flatMap((entry) => buildSchemaTypes({ entry, taken, warn }));
  const query = objectDef({
    name: 'Query',
    fields: roots.flatMap((entry) => queryFields({ ...entry, title: entry.schema.title })),
  });

  const used = new Set();
  visit([query, ...typeBlocks], { NamedType: ({ name }) => { used.add(name.value); } });
  const prelude = PRELUDE.filter(({ kind, name }) => kind !== Kind.SCALAR_TYPE_DEFINITION
    || used.has(name.value));
  const ast = { kind: Kind.DOCUMENT, definitions: [...prelude, query, ...typeBlocks] };
  const invalid = findSchemaErrors(ast).map((message) => ({
    schemaId: '', pointer: '', message: `The generated GraphQL schema is invalid: ${message}`,
  }));
  return { sdl: `${print(ast)}\n`, warnings, errors: [...errors, ...invalid] };
}

// The SDL for a schema selection. Missing and invalid schemas are skipped, but an
// unreadable one is an error, so a read failure never drops types from a stored SDL.

function describeUnusable({ id, entry }) {
  const message = entry
    ? 'The schema is invalid and was skipped.'
    : 'The schema no longer exists and was skipped.';
  return { schemaId: id, pointer: '', message };
}

const describeUnreadable = ({ id }) => ({ schemaId: id, pointer: '', message: 'The schema could not be loaded.' });

export function buildSdl({ schemaIds = [], schemas = [] }) {
  if (!schemaIds.length) return { sdl: '', warnings: [], errors: [] };
  const entries = new Map(schemas.map((entry) => [entry.id, entry]));
  const selected = schemaIds.map((id) => ({ id, entry: entries.get(id) }));
  const usable = selected.filter(({ entry }) => entry?.valid);
  const unusable = selected.filter(({ entry }) => !entry?.valid);
  const unreadable = unusable.filter(({ entry }) => entry?.status === 'load-failed');
  const skipped = unusable.filter((item) => !unreadable.includes(item));

  const inputs = usable.map(({ id, entry }) => ({ id, schema: entry.schema }));
  const result = generateSdl({ schemas: inputs });
  return {
    sdl: result.sdl,
    warnings: [...skipped.map(describeUnusable), ...result.warnings],
    errors: [...unreadable.map(describeUnreadable), ...result.errors],
  };
}
