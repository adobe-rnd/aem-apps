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
// Authoring model → JSON Schema. Deterministic, so the string form doubles as the dirty check.

import { FORMAT_VARIANTS } from './elements.js';
import { encodePointerToken } from './parse.js';

function defRef(name) {
  return `#/$defs/${encodePointerToken(name)}`;
}

const hasText = (value) => typeof value === 'string' && value !== '';

function put(out, key, value) {
  if (value !== undefined) out[key] = value;
}

function serializeStringKeywords(out, node) {
  const { variant } = node;
  if (FORMAT_VARIANTS.includes(variant)) out.format = variant;
  if (variant === 'long-text') out['x-semantic-type'] = 'long-text';
  if (variant === 'choice') put(out, 'enum', Array.isArray(node.enum) ? [...node.enum] : node.enum);
  put(out, 'minLength', node.minLength);
  put(out, 'maxLength', node.maxLength);
  put(out, 'pattern', node.pattern);
}

function appendExtras(out, extras) {
  if (!extras) return out;
  Object.entries(extras).forEach(([key, value]) => {
    if (!(key in out)) out[key] = value;
  });
  return out;
}

/** `defName(id)` resolves component ids to names. */
export function serializeNode(node, defName) {
  if (!node) return undefined;
  if (node.kind === 'unsupported') return node.raw;

  const out = {};
  if (node.kind === 'ref') {
    out.$ref = defRef(defName(node.refDefId) ?? '');
    if (hasText(node.title)) out.title = node.title;
    if (hasText(node.description)) out.description = node.description;
    return appendExtras(out, node.extras);
  }

  if (!node.missingType) out.type = node.kind;
  if (hasText(node.title)) out.title = node.title;
  if (hasText(node.description)) out.description = node.description;
  if (node.kind === 'string') serializeStringKeywords(out, node);
  if (node.kind === 'number' || node.kind === 'integer') {
    put(out, 'minimum', node.minimum);
    put(out, 'maximum', node.maximum);
  }
  if (node.kind === 'array') {
    put(out, 'minItems', node.minItems);
    put(out, 'maxItems', node.maxItems);
  }
  put(out, 'default', node.default);
  if (typeof node.readOnly === 'boolean') out.readOnly = node.readOnly;

  if (node.kind === 'object') {
    const children = node.children ?? [];
    const properties = Object.fromEntries(
      children.map((child) => [child.key, serializeNode(child, defName)]),
    );
    // In property order, once: siblings can share a key while a duplicate-key error is open.
    const required = Object.keys(properties)
      .filter((key) => children.some((child) => child.key === key && child.required));
    if (required.length) out.required = required;
    out.properties = properties;
  }
  if (node.kind === 'array' && node.item) out.items = serializeNode(node.item, defName);

  return appendExtras(out, node.extras);
}

export function defNameResolver(model) {
  const names = new Map(model.defs.map((def) => [def.id, def.name]));
  return (id) => names.get(id);
}

export function serializeSchema(model) {
  const defName = defNameResolver(model);
  const out = {};
  const { $schema, ...otherRootExtras } = model.rootExtras ?? {};
  if ($schema !== undefined) out.$schema = $schema;
  Object.assign(out, otherRootExtras);
  if (model.defs.length) {
    out.$defs = Object.fromEntries(
      model.defs.map((def) => [def.name, serializeNode(def.node, defName)]),
    );
  }
  const root = serializeNode(model.root, defName);
  return { ...out, ...(root && typeof root === 'object' && !Array.isArray(root) ? root : {}) };
}

export function stringifySchema(model) {
  return JSON.stringify(serializeSchema(model), null, 2);
}
