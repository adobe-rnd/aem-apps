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

// Built-in names and the fixed names of the API that Content AI generates.
const RESERVED_TYPE_NAMES = new Set([
  'Query', 'Mutation', 'Subscription',
  'String', 'Int', 'Float', 'Boolean', 'ID',
  'JSON', 'Date', 'Time', 'DateTime',
  'PageInfo', 'SortDirection',
  'StringCondition', 'IntCondition', 'FloatCondition',
  'DateCondition', 'BooleanCondition', 'ExistsCondition',
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

// SC JSON Schema → graphql-js document → SDL that follows Content AI's GraphQL
// contract; unsupported content becomes JSON with a warning.

const RESERVED_KEYS = new Set(['metadata', 'section-metadata']);
const FORMAT_SCALARS = new Map([['date', 'Date'], ['time', 'Time'], ['date-time', 'DateTime']]);
const MAX_SDL_BYTES = 64 * 1024;
const MAX_INDEXED_FIELDS = 1000;
const MAX_GENERATED_TYPES = 1000;
const MAX_KEY_LEVEL = 10;
const MAX_INT = 2 ** 31 - 1;
const MIN_INT = -(2 ** 31);

// Scalars shared by every endpoint; unused ones are dropped.
const SCALARS = parse(`
scalar JSON
scalar Date
scalar Time
scalar DateTime
`, { noLocation: true }).definitions;

// Content AI provides the directives and the Query type, so the SDL must not
// declare them; they are only added to validate it with graphql-js.
const PROVIDED = parse(`
directive @contentType(id: String!) on OBJECT
directive @source(key: String!) on FIELD_DEFINITION
type Query { _: Boolean }
`, { noLocation: true }).definitions;

const toName = (value) => ({ kind: Kind.NAME, value });
const named = (value) => ({ kind: Kind.NAMED_TYPE, name: toName(value) });
const nonNull = (type) => ({ kind: Kind.NON_NULL_TYPE, type });
const listOf = (type) => ({ kind: Kind.LIST_TYPE, type });

const applyDirective = ({ name, arg, value }) => ({
  kind: Kind.DIRECTIVE,
  name: toName(name),
  arguments: [{
    kind: Kind.ARGUMENT, name: toName(arg), value: { kind: Kind.STRING, value },
  }],
});

const fieldDef = ({ name, type, directives = [] }) => ({
  kind: Kind.FIELD_DEFINITION,
  name: toName(name),
  arguments: [],
  type,
  directives,
});

const objectDef = ({ name, fields, directives = [] }) => ({
  kind: Kind.OBJECT_TYPE_DEFINITION,
  name: toName(name),
  interfaces: [],
  directives,
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

const isNumber = (value) => typeof value === 'number';

// GraphQL Int is 32-bit, so integers that may not fit are Floats.
const exceedsInt = ({
  minimum, maximum, exclusiveMinimum, exclusiveMaximum,
}) => (isNumber(maximum) && maximum > MAX_INT)
  || (isNumber(exclusiveMaximum) && exclusiveMaximum > MAX_INT + 1)
  || (isNumber(minimum) && minimum < MIN_INT)
  || (isNumber(exclusiveMinimum) && exclusiveMinimum < MIN_INT - 1);

// Content AI ids and keys name one level of a document.
const isReadableKey = (key) => !!String(key).trim() && !String(key).includes('.');

const usableProperties = (node) => (isPlainObject(node?.properties)
  ? Object.keys(node.properties).filter((key) => !RESERVED_KEYS.has(key) && isReadableKey(key))
  : []);

const firstFree = ({ isTaken, make, i = 2 }) => (isTaken(make(i))
  ? firstFree({ isTaken, make, i: i + 1 })
  : make(i));

// Content AI generates <Type>Page, <Type>Filter… and <Type>OrderBy… types.
const isGeneratedFor = (name, type) => name === `${type}Page`
  || name.startsWith(`${type}Filter`)
  || name.startsWith(`${type}OrderBy`);

const collides = (a, b) => a === b || isGeneratedFor(a, b) || isGeneratedFor(b, a);

// A name that is neither used nor generated for another type. A name generated
// for a type gets an underscore after it (ProductFilter → Product_Filter), as
// generated names never contain one; other clashes get a number.
function freeName(name, types) {
  const owner = [...types].find((type) => isGeneratedFor(name, type));
  if (owner) return freeName(`${owner}_${name.slice(owner.length)}`, types);
  const isTaken = (candidate) => RESERVED_TYPE_NAMES.has(candidate)
    || [...types].some((type) => collides(candidate, type));
  return isTaken(name) ? firstFree({ isTaken, make: (i) => `${name}${i}` }) : name;
}

function describeCollision(name, other) {
  if (name === other) return `both produce the GraphQL type "${name}"`;
  const [type, generated] = isGeneratedFor(name, other) ? [other, name] : [name, other];
  return `produce the GraphQL types "${other}" and "${name}", but Content AI reserves names like "${generated}" for the generated types of "${type}"`;
}

function registerRoots({ schemas, errors, warn }) {
  const owners = new Map();
  return [...schemas].filter((entry) => entry?.id).sort(byId).reduce((acc, { id, schema }) => {
    if (schema?.type !== 'object' && schema?.type !== 'array') {
      warn(id, '', 'The schema root must be an object or an array. The schema was skipped.');
      return acc;
    }
    if (!isReadableKey(id)) {
      warn(id, '', 'A Content AI content type id cannot be blank or contain a dot. The schema was skipped.');
      return acc;
    }
    const root = toTypeName(id);
    const names = schema.type === 'object' ? [root, `${root}Data`] : [root];
    const clash = names.flatMap((name) => [...owners.keys()].map((other) => [name, other]))
      .find(([name, other]) => collides(name, other));
    if (clash) {
      const [name, other] = clash;
      errors.push({
        schemaId: id,
        pointer: '',
        message: `Schemas "${owners.get(other)}" and "${id}" ${describeCollision(name, other)}. Rename one of them or leave one out of the endpoint.`,
      });
      return acc;
    }
    names.forEach((name) => owners.set(name, id));
    acc.push({
      id, schema, root, names,
    });
    return acc;
  }, []);
}

const documentType = ({ id, root, dataType }) => objectDef({
  name: root,
  directives: [applyDirective({ name: 'contentType', arg: 'id', value: id })],
  fields: [
    fieldDef({ name: 'path', type: nonNull(named('String')) }),
    fieldDef({ name: 'title', type: named('String') }),
    fieldDef({ name: 'data', type: dataType }),
  ],
});

function buildSchemaTypes({ entry, types, warn }) {
  const { id, schema, root } = entry;
  const order = [];
  const defs = new Map();
  const refCache = new Map();
  const resolving = new Set();

  const json = () => named('JSON');

  const reserve = (base, pointer) => {
    const name = toTypeName(base);
    const free = freeName(name, types);
    if (free !== name) {
      const reason = types.has(name) ? 'is already used' : 'is reserved by Content AI';
      warn(id, pointer, `The type name "${name}" ${reason}; generated "${free}" instead.`);
    }
    types.add(free);
    order.push(free);
    return free;
  };

  const resolvePointer = (ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
    return ref.slice(2).split('/').map(unescapePointer)
      .reduce((node, seg) => (isPlainObject(node) ? node[seg] : undefined), schema);
  };

  const stringType = (node) => named((!hasEnum(node) && FORMAT_SCALARS.get(node.format)) || 'String');

  // Assigned below: the object, reference and array types recurse through it.
  let typeExpr;

  // Nested type names start with the prefix: the root for the data type, else the type itself.
  const objectType = (node, name, pointer, prefix = name) => {
    const used = new Set();
    const fields = Object.entries(node.properties).map(([key, child]) => {
      const childPointer = `${pointer}/properties/${escapePointer(key)}`;
      if (RESERVED_KEYS.has(key)) {
        warn(id, childPointer, `"${key}" is a reserved key and was skipped.`);
        return undefined;
      }
      if (!isReadableKey(key)) {
        warn(id, childPointer, `Content AI cannot read the key "${key}": keys cannot be blank or contain a dot. The property was skipped.`);
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
      const type = typeExpr(child, `${prefix}${pascal(key)}`, childPointer);
      return fieldDef({
        name: field,
        type,
        directives: field === key ? [] : [applyDirective({ name: 'source', arg: 'key', value: key })],
      });
    }).filter(Boolean);
    return objectDef({ name, fields });
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
      case 'integer':
        if (!exceedsInt(node)) return named('Int');
        warn(id, pointer, 'The integer range exceeds GraphQL Int (32-bit); mapped to Float.');
        return named('Float');
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
      const name = `${root}Data`;
      order.unshift(name);
      defs.set(name, objectType(schema, name, '', root));
      return named(name);
    }
    warn(id, '', 'The schema root has no properties; data is mapped to JSON.');
    return json();
  };
  const dataType = rootType();

  return [
    documentType({ id, root, dataType }),
    ...order.map((name) => defs.get(name)),
  ];
}

function findSchemaErrors(definitions) {
  try {
    const ast = { kind: Kind.DOCUMENT, definitions: [...PROVIDED, ...definitions] };
    return validateSchema(buildASTSchema(ast)).map(({ message }) => message);
  } catch (error) {
    return [error.message];
  }
}

const namedTypeOf = (type) => (type.kind === Kind.NAMED_TYPE
  ? type.name.value
  : namedTypeOf(type.type));

const isListType = (type) => type.kind === Kind.LIST_TYPE
  || (type.kind === Kind.NON_NULL_TYPE && isListType(type.type));

const sourceKey = (field) => field.directives
  .find(({ name }) => name.value === 'source')?.arguments[0].value.value ?? field.name.value;

// Text keys sort only if the index enables their filter; these always sort.
const ALWAYS_SORTABLE = new Set(['Int', 'Float', 'Date', 'DateTime']);

const NONE = {
  keys: 0, filters: 0, sure: 0, any: 0, sureTypes: 0, anyTypes: 0,
};
const add = (a, b) => Object.fromEntries(Object.keys(NONE).map((key) => [key, a[key] + b[key]]));

// What Content AI derives from each document type. Keys: every scalar field
// except JSON, through objects and lists, down to MAX_KEY_LEVEL with the
// document's own fields at level 1. A filter type for each object with keys,
// and an orderBy type for each object with sortable keys: not Boolean, not in
// a list, no whitespace in the key. `sure` counts number and date keys only,
// `any` text keys too.
function measure({ definitions, roots }) {
  const objects = new Map(definitions
    .filter(({ kind }) => kind === Kind.OBJECT_TYPE_DEFINITION)
    .map((def) => [def.name.value, def]));
  const memo = new Map();
  const walk = (name, level, unsortable) => {
    if (level > MAX_KEY_LEVEL) return NONE;
    const memoKey = `${name}@${level}@${unsortable}`;
    if (!memo.has(memoKey)) {
      const sum = objects.get(name).fields.reduce((acc, field) => {
        const target = namedTypeOf(field.type);
        const blocked = unsortable || isListType(field.type) || /\s/.test(sourceKey(field));
        if (objects.has(target)) return add(acc, walk(target, level + 1, blocked));
        if (target === 'JSON') return acc;
        const sortable = !blocked && target !== 'Boolean';
        return add(acc, {
          ...NONE,
          keys: 1,
          sure: sortable && ALWAYS_SORTABLE.has(target) ? 1 : 0,
          any: sortable ? 1 : 0,
        });
      }, NONE);
      memo.set(memoKey, {
        ...sum,
        filters: sum.filters + (sum.keys ? 1 : 0),
        sureTypes: sum.sureTypes + (sum.sure ? 1 : 0),
        anyTypes: sum.anyTypes + (sum.any ? 1 : 0),
      });
    }
    return memo.get(memoKey);
  };
  return roots.map(({ id, root }) => ({ id, ...walk(root, 1, /\s/.test(id)) }));
}

const formatCount = (value) => value.toLocaleString('en-US');

function checkLimits({ sdl, definitions, roots }) {
  const errors = [];
  const warnings = [];
  const bytes = new TextEncoder().encode(sdl).length;
  if (bytes > MAX_SDL_BYTES) {
    errors.push(`The generated SDL has ${formatCount(bytes)} bytes; Content AI accepts at most 64 KiB (${formatCount(MAX_SDL_BYTES)} bytes).`);
  }
  const counts = measure({ definitions, roots });
  const total = (count) => counts.reduce((sum, item) => sum + count(item), 0);
  const detail = (count) => counts.map((item) => `"${item.id}": ${formatCount(count(item))}`).join(', ');
  const keys = ({ keys: value }) => value;
  if (total(keys) > MAX_INDEXED_FIELDS) {
    errors.push(`The generated SDL has ${formatCount(total(keys))} indexed fields (${detail(keys)}); Content AI accepts at most ${formatCount(MAX_INDEXED_FIELDS)}. Remove fields, or object types that refer to themselves more than once.`);
  }
  const fewest = ({ filters, sureTypes }) => filters + sureTypes;
  const most = ({ filters, anyTypes }) => filters + anyTypes;
  if (total(fewest) > MAX_GENERATED_TYPES) {
    errors.push(`The generated SDL needs ${formatCount(total(fewest))} generated filter and sort types (${detail(fewest)}); Content AI accepts at most ${formatCount(MAX_GENERATED_TYPES)}. Remove nested objects, or object types that refer to themselves.`);
  } else if (total(most) > MAX_GENERATED_TYPES) {
    warnings.push(`The generated SDL needs ${formatCount(total(fewest))} to ${formatCount(total(most))} generated filter and sort types, depending on which text keys have filtering enabled in the index; Content AI rejects the endpoint above ${formatCount(MAX_GENERATED_TYPES)}.`);
  }
  const toProblem = (message) => ({ schemaId: '', pointer: '', message });
  return { errors: errors.map(toProblem), warnings: warnings.map(toProblem) };
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

  const types = new Set(roots.flatMap(({ names }) => names));
  const typeBlocks = roots.flatMap((entry) => buildSchemaTypes({ entry, types, warn }));

  const used = new Set();
  visit(typeBlocks, { NamedType: ({ name }) => { used.add(name.value); } });
  const definitions = [...SCALARS.filter(({ name }) => used.has(name.value)), ...typeBlocks];
  const sdl = `${print({ kind: Kind.DOCUMENT, definitions })}\n`;
  const invalid = findSchemaErrors(definitions).map((message) => ({
    schemaId: '', pointer: '', message: `The generated GraphQL schema is invalid: ${message}`,
  }));
  const limits = checkLimits({ sdl, definitions, roots });
  return {
    sdl,
    warnings: [...warnings, ...limits.warnings],
    errors: [...errors, ...invalid, ...limits.errors],
  };
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
