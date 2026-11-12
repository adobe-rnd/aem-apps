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
// Helpers for checking the editor's JSON Schema against schema-spec.md and the real SC SDK.

import { createEngine } from '@adobe/da-sc-sdk';
import { createModel, createNode, createRefNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import { insertNode, updateNode } from '../../../../../../tools/apps/schema-editor/core/model/commands.js';
import { getNode, siblingKeys } from '../../../../../../tools/apps/schema-editor/core/model/query.js';

/** Builds a model with the commands and node factories the UI uses (see ui/shared/actions.js). */
export function editor({ name = 'event', title = 'Event', rootElement } = {}) {
  let model = createModel({ name, title, rootElement });
  const run = (command, args) => {
    const result = command(model, args);
    model = result.model;
    return result;
  };
  const place = (parentId, make) => {
    const parent = getNode(model, parentId);
    const node = make(parent?.kind === 'object' ? siblingKeys(parent) : null);
    return run(insertNode, { parentId, node, replace: parent?.kind === 'array' }).nodeId;
  };
  // Inspector edits: the label first (it derives the key), then the other fields.
  const edit = (nodeId, { title: label, ...rest } = {}) => {
    if (label !== undefined) run(updateNode, { nodeId, patch: { title: label } });
    if (Object.keys(rest).length) run(updateNode, { nodeId, patch: rest });
    return nodeId;
  };
  return {
    get model() { return model; },
    get root() { return model.root.id; },
    run,
    edit,
    /** Drops a palette element into a Group or a List and fills in the inspector. */
    add: (parentId, element, patch) => edit(
      place(parentId, (keys) => createNode(element, { siblingKeys: keys })),
      patch,
    ),
    /** Drops a component usage. */
    use: (parentId, defId, patch) => edit(
      place(parentId, (keys) => createRefNode(model.defs.find((d) => d.id === defId), {
        siblingKeys: keys,
      })),
      patch,
    ),
  };
}

const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
const ANNOTATIONS = ['type', 'title', 'description', 'default', 'readOnly'];
const KEYWORDS = {
  string: ['enum', 'format', 'x-semantic-type', 'minLength', 'maxLength', 'pattern'],
  number: ['minimum', 'maximum'],
  integer: ['minimum', 'maximum'],
  boolean: [],
  object: ['properties', 'required'],
  array: ['items', 'minItems', 'maxItems'],
};
const ROOT_KEYWORDS = ['$schema', '$defs'];
const KEY = /^[A-Za-z][A-Za-z0-9-]*$/;
const RESERVED = ['metadata', 'section-metadata'];
const DEFS = '#/$defs/';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const hasTitle = (node) => typeof node?.title === 'string' && node.title.trim() !== '';
const DEFAULT_TYPES = {
  string: (v) => typeof v === 'string',
  number: isNumber,
  integer: Number.isInteger,
  boolean: (v) => typeof v === 'boolean',
};

/**
 * Lists every way `schema` breaks schema-spec.md: the authoring rules R1–R11 and the keywords
 * each type supports (§2–§5). Data-level checks (does a default pass its constraints) are the
 * SDK's job, see `sdkView` / `validateData`.
 */
export function specProblems(schema) {
  const problems = [];
  const defs = isObject(schema?.$defs) ? schema.$defs : {};
  const target = (ref) => ref.slice(2).split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node, token) => (isObject(node) ? node[token] : undefined), schema);

  const checkRange = (node, at, [min, max], valid, label) => {
    [min, max].forEach((k) => {
      if (k in node && !valid(node[k])) problems.push(`${at}: ${k} must be ${label}`);
    });
    if (valid(node[min]) && valid(node[max]) && node[min] > node[max]) {
      problems.push(`${at}: ${min} > ${max}`);
    }
  };

  const check = (node, at, { root = false } = {}) => {
    if (!isObject(node)) {
      problems.push(`${at}: not a schema object`);
      return;
    }
    if ('$ref' in node) {
      const extra = Object.keys(node).filter((k) => !['$ref', 'title', 'description'].includes(k));
      if (extra.length) problems.push(`${at}: ${extra.join(', ')} next to $ref`);
      if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/')) {
        problems.push(`${at}: R8 $ref must be same-document`);
      } else if (!isObject(target(node.$ref))) {
        problems.push(`${at}: R8 $ref does not resolve`);
      } else if (!hasTitle(node) && !hasTitle(target(node.$ref))) {
        problems.push(`${at}: R4 no title`);
      }
      return;
    }

    const { type } = node;
    if (type === undefined) problems.push(`${at}: R1 no type`);
    else if (Array.isArray(type)) problems.push(`${at}: R3 type is an array`);
    else if (!TYPES.includes(type)) problems.push(`${at}: R2 type "${type}"`);
    if (root && !['object', 'array'].includes(type)) problems.push(`${at}: R11 root is ${type}`);
    if (!hasTitle(node)) problems.push(`${at}: R4 no title`);
    if (!TYPES.includes(type)) return;

    const allowed = [...ANNOTATIONS, ...KEYWORDS[type], ...(root ? ROOT_KEYWORDS : [])];
    Object.keys(node).filter((k) => !allowed.includes(k))
      .forEach((k) => problems.push(`${at}: "${k}" is not a ${type} keyword`));
    if ('description' in node && typeof node.description !== 'string') {
      problems.push(`${at}: description must be text`);
    }
    if ('readOnly' in node && typeof node.readOnly !== 'boolean') {
      problems.push(`${at}: readOnly must be a boolean`);
    }
    if ('default' in node && !DEFAULT_TYPES[type]?.(node.default)) {
      problems.push(`${at}: default does not match ${type}`);
    }

    if (type === 'string') {
      const exclusive = ['enum', 'format', 'x-semantic-type'].filter((k) => k in node);
      if (exclusive.length > 1) problems.push(`${at}: ${exclusive.join(' + ')} are exclusive`);
      if ('format' in node && !['date', 'time', 'date-time'].includes(node.format)) {
        problems.push(`${at}: format "${node.format}"`);
      }
      if ('x-semantic-type' in node && node['x-semantic-type'] !== 'long-text') {
        problems.push(`${at}: x-semantic-type "${node['x-semantic-type']}"`);
      }
      if ('enum' in node) {
        const values = node.enum;
        if (!Array.isArray(values) || !values.length) problems.push(`${at}: enum is empty`);
        else if (values.some((v) => typeof v !== 'string' || !v.trim())) problems.push(`${at}: enum has a non-text value`);
        else if (new Set(values).size !== values.length) problems.push(`${at}: enum has duplicates`);
      }
      checkRange(node, at, ['minLength', 'maxLength'], isCount, 'a whole number of 0 or more');
      if ('pattern' in node) {
        try {
          // The SDK compiles patterns exactly like this (state-engine/schema.js).
          // eslint-disable-next-line no-new
          new RegExp(node.pattern);
        } catch {
          problems.push(`${at}: pattern does not compile`);
        }
      }
    }
    if (type === 'number' || type === 'integer') {
      checkRange(node, at, ['minimum', 'maximum'], isNumber, 'a number');
    }
    if (type === 'array') {
      checkRange(node, at, ['minItems', 'maxItems'], isCount, 'a whole number of 0 or more');
      if (!isObject(node.items)) problems.push(`${at}: R6 items must be one schema`);
      else check(node.items, `${at}/items`);
    }
    if (type === 'object') {
      if (!isObject(node.properties)) {
        problems.push(`${at}: R5 no properties`);
        return;
      }
      const keys = Object.keys(node.properties);
      if ('required' in node) {
        const { required } = node;
        if (!Array.isArray(required)) problems.push(`${at}: required must be a list`);
        else if (new Set(required).size !== required.length) problems.push(`${at}: required has duplicates`);
        else {
          required.filter((k) => !keys.includes(k))
            .forEach((k) => problems.push(`${at}: required "${k}" is not a property`));
        }
      }
      keys.forEach((key) => {
        if (RESERVED.includes(key)) problems.push(`${at}: R10 "${key}" is reserved`);
        else if (!KEY.test(key)) problems.push(`${at}: R9 key "${key}"`);
        check(node.properties[key], `${at}/properties/${key}`);
      });
    }
  };

  const { $schema, $defs, ...root } = schema ?? {};
  if ('$defs' in (schema ?? {}) && !isObject($defs)) problems.push('/$defs must be an object');
  Object.entries(defs).forEach(([name, def]) => check(def, `/$defs/${name}`));
  check({ ...root, ...($schema ? { $schema } : {}) }, '', { root: true });
  return problems;
}

/** Data with one entry per List, so the SDK builds a node for every schema node. */
function skeleton(schema, defs, depth = 0) {
  const node = schema?.$ref ? defs[schema.$ref.slice(DEFS.length)] : schema;
  if (!isObject(node) || depth > 12) return null;
  if (node.type === 'object') {
    return Object.fromEntries(Object.entries(node.properties ?? {})
      .map(([key, child]) => [key, skeleton(child, defs, depth + 1)]));
  }
  if (node.type === 'array') return [skeleton(node.items, defs, depth + 1)];
  const SAMPLES = {
    string: 'x', number: 1, integer: 1, boolean: true,
  };
  return SAMPLES[node.type] ?? null;
}

const VIEW_FIELDS = [
  'kind', 'label', 'description', 'required', 'readonly', 'defaultValue', 'validation',
  'enumValues', 'format', 'semanticType', 'minItems', 'maxItems', 'itemLabel',
];

/**
 * How the SDK's form engine reads `schema`: `{ [dataPointer]: { kind, label, … } }`. Two
 * schemas with the same view render and validate the same form.
 */
export function sdkView(schema) {
  const data = skeleton(schema, schema.$defs ?? {});
  const engine = createEngine({ schema, document: { metadata: { schemaName: 'test' }, data } });
  const { model, schemaIssues } = engine.getState();
  const view = Object.fromEntries(Object.entries(model?.byPointer ?? {}).map(([pointer, node]) => [
    pointer,
    Object.fromEntries(VIEW_FIELDS.filter((k) => node[k] !== undefined).map((k) => [k, node[k]])),
  ]));
  return { view, schemaIssues };
}

/** Validation errors of a new, empty document (defaults applied), as `{ pointer: keyword }`. */
export function newDocumentErrors(schema) {
  const engine = createEngine({ schema, document: { metadata: { schemaName: 'test' }, data: {} } });
  const { errors } = engine.getState().validation;
  return Object.fromEntries(Object.entries(errors).map(([pointer, e]) => [pointer, e.keyword]));
}
