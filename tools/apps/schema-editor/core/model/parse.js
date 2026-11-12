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
// JSON Schema → authoring model. Never throws: it only records what it found (unsupported
// nodes keep a `reason`, other keywords land in `extras`); turning that into issues is the
// linter's job, so issues have a single source.

import { createId } from './ids.js';
import { FORMAT_VARIANTS } from './elements.js';

const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
const COMPOSITION = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'];
const ROOT_ONLY_KEYWORDS = Object.freeze(['$schema', '$id', '$vocabulary']);
const DEFS_PREFIX = '#/$defs/';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function encodePointerToken(token) {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function unsupported(json, reason, fields = {}) {
  return {
    id: createId(), kind: 'unsupported', reason, raw: json, title: '', ...fields,
  };
}

function inferType(json) {
  if ('properties' in json || 'required' in json) return 'object';
  if ('items' in json || 'minItems' in json || 'maxItems' in json) return 'array';
  const stringHints = ['enum', 'format', 'x-semantic-type', 'minLength', 'maxLength', 'pattern'];
  if (stringHints.some((k) => k in json)) return 'string';
  if ('minimum' in json || 'maximum' in json) return 'number';
  return null;
}

function stringVariant(json) {
  if ('enum' in json) return 'choice';
  if (FORMAT_VARIANTS.includes(json.format)) return json.format;
  if (json['x-semantic-type'] === 'long-text') return 'long-text';
  return 'text';
}

function modelledKeywords(kind, variant) {
  const keys = ['type', 'title', 'description', 'default', 'readOnly'];
  if (kind === 'string') {
    keys.push('minLength', 'maxLength', 'pattern');
    if (variant === 'choice') keys.push('enum');
    if (FORMAT_VARIANTS.includes(variant)) keys.push('format');
    if (variant === 'long-text') keys.push('x-semantic-type');
  }
  if (kind === 'number' || kind === 'integer') keys.push('minimum', 'maximum');
  if (kind === 'object') keys.push('properties', 'required');
  if (kind === 'array') keys.push('items', 'minItems', 'maxItems');
  return keys;
}

function collectExtras(json, modelled) {
  const extras = {};
  Object.keys(json).forEach((key) => {
    if (!modelled.includes(key)) extras[key] = json[key];
  });
  return Object.keys(extras).length ? extras : undefined;
}

function assign(target, json, keys) {
  keys.forEach((key) => {
    if (json[key] !== undefined) target[key] = json[key];
  });
}

function parseRef(json, ctx) {
  const ref = json.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#')) {
    return unsupported(json, 'R8-external-ref');
  }
  if (!ref.startsWith(DEFS_PREFIX) || ref.slice(DEFS_PREFIX.length).includes('/')) {
    return unsupported(json, 'R8-non-defs-ref');
  }
  const name = decodePointerToken(ref.slice(DEFS_PREFIX.length));
  const defId = ctx.defIds.get(name);
  if (!defId) return unsupported(json, 'R8-unresolved-ref');
  const node = {
    id: createId(), kind: 'ref', refDefId: defId, title: '',
  };
  assign(node, json, ['title', 'description']);
  const extras = collectExtras(json, ['$ref', 'title', 'description']);
  if (extras) node.extras = extras;
  return node;
}

function parseNode(json, ctx) {
  if (!isPlainObject(json)) return unsupported(json, 'invalid-node');
  if ('$ref' in json) return parseRef(json, ctx);
  if (COMPOSITION.some((k) => k in json)) return unsupported(json, 'unsupported-composition');

  let kind = json.type;
  let missingType = false;
  if (kind === undefined) {
    kind = inferType(json);
    if (!kind) return unsupported(json, 'R1-missing-type');
    missingType = true;
  }
  if (Array.isArray(kind)) return unsupported(json, 'R3-type-array');
  if (!TYPES.includes(kind)) return unsupported(json, 'R2-unsupported-type');
  if (kind === 'array' && 'items' in json && !isPlainObject(json.items)) {
    return unsupported(json, Array.isArray(json.items) ? 'R6-tuple-items' : 'invalid-node');
  }
  if (kind === 'object' && 'properties' in json && !isPlainObject(json.properties)) {
    return unsupported(json, 'invalid-node');
  }

  const node = { id: createId(), kind, title: '' };
  if (missingType) node.missingType = true;
  const variant = kind === 'string' ? stringVariant(json) : undefined;
  if (variant) node.variant = variant;

  assign(node, json, ['title', 'description', 'default', 'readOnly']);
  if (kind === 'string') {
    assign(node, json, ['minLength', 'maxLength', 'pattern']);
    if (variant === 'choice') node.enum = Array.isArray(json.enum) ? [...json.enum] : json.enum;
  }
  if (kind === 'number' || kind === 'integer') assign(node, json, ['minimum', 'maximum']);
  if (kind === 'array') {
    assign(node, json, ['minItems', 'maxItems']);
    node.item = 'items' in json ? parseNode(json.items, ctx) : null;
  }

  const modelled = modelledKeywords(kind, variant);
  if (kind === 'object') {
    const properties = json.properties ?? {};
    const required = Array.isArray(json.required) ? json.required : [];
    if (!Array.isArray(json.required) && json.required !== undefined) {
      modelled.splice(modelled.indexOf('required'), 1);
    }
    node.children = Object.entries(properties).map(([key, child]) => ({
      ...parseNode(child, ctx),
      key,
      keyLocked: true,
      keyManual: true,
      ...(required.includes(key) ? { required: true } : {}),
    }));
    const unknown = required.filter((key) => !Object.hasOwn(properties, key));
    if (unknown.length) node.requiredUnknown = unknown;
  }

  const extras = collectExtras(json, modelled);
  if (extras) node.extras = extras;
  return node;
}

/** `name` is the schema's file name. */
export function parseSchema(json, { name = '' } = {}) {
  const source = isPlainObject(json) ? json : {};
  const rawDefs = isPlainObject(source.$defs) ? source.$defs : {};
  const defIds = new Map(Object.keys(rawDefs).map((defName) => [defName, createId()]));
  const ctx = { defIds };

  const defs = Object.entries(rawDefs).map(([defName, defJson]) => ({
    id: defIds.get(defName),
    name: defName,
    node: parseNode(defJson, ctx),
  }));

  const rootExtras = {};
  const rootJson = {};
  Object.entries(source).forEach(([key, value]) => {
    if (ROOT_ONLY_KEYWORDS.includes(key)) rootExtras[key] = value;
    else if (key === '$defs' && isPlainObject(value)) { /* parsed above */ } else rootJson[key] = value;
  });

  let root;
  if (!isPlainObject(json)) {
    root = unsupported(json, 'R11-root-type');
  } else {
    root = parseNode(rootJson, ctx);
    if (root.kind !== 'object' && root.kind !== 'array' && root.kind !== 'unsupported') {
      root = unsupported(rootJson, 'R11-root-type');
    }
  }

  return {
    model: {
      version: 1, name, root, defs, rootExtras,
    },
  };
}
