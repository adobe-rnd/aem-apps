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
// The element catalogue: one table drives the palette, inspector sections and node creation.

import { createId } from './ids.js';
import { deriveKey } from './keys.js';

export const FORMAT_VARIANTS = Object.freeze(['date', 'time', 'date-time']);
export const PRIMITIVE_KINDS = Object.freeze(['string', 'number', 'integer', 'boolean']);

const PALETTE_SECTIONS = Object.freeze([
  { id: 'basic', label: 'Basic' },
  { id: 'datetime', label: 'Date & time' },
  { id: 'structure', label: 'Structure' },
]);

const freezeAll = (table) => Object.freeze(Object.fromEntries(
  Object.entries(table).map(([id, el]) => [id, Object.freeze({ id, ...el })]),
));

/** `class`: compatibility class for switching elements in place; `sections`: inspector ids. */
export const ELEMENTS = freezeAll({
  text: {
    label: 'Text',
    icon: 'text',
    kind: 'string',
    variant: 'text',
    class: 'string',
    palette: 'basic',
    description: 'A single line of text.',
    sections: ['general', 'length', 'pattern', 'default'],
  },
  longText: {
    label: 'Long text',
    icon: 'textArea',
    kind: 'string',
    variant: 'long-text',
    class: 'string',
    palette: 'basic',
    description: 'Renders as a multi-line text area.',
    sections: ['general', 'length', 'pattern', 'default'],
  },
  choice: {
    label: 'Choice',
    icon: 'choice',
    kind: 'string',
    variant: 'choice',
    class: 'string',
    palette: 'basic',
    description: 'Pick one value from a fixed list.',
    sections: ['general', 'choices', 'default'],
  },
  number: {
    label: 'Number',
    icon: 'number',
    kind: 'number',
    class: 'numeric',
    palette: 'basic',
    description: 'Any number, including decimals.',
    sections: ['general', 'range', 'default'],
  },
  integer: {
    label: 'Whole number',
    icon: 'integer',
    kind: 'integer',
    class: 'numeric',
    palette: 'basic',
    description: 'A number without decimals.',
    sections: ['general', 'range', 'default'],
  },
  boolean: {
    label: 'Yes / No',
    icon: 'boolean',
    kind: 'boolean',
    class: 'boolean',
    palette: 'basic',
    description: 'An on / off switch.',
    sections: ['general', 'default'],
  },
  date: {
    label: 'Date',
    icon: 'calendar',
    kind: 'string',
    variant: 'date',
    class: 'string',
    palette: 'datetime',
    description: 'A calendar date without a time zone.',
    sections: ['general', 'default'],
  },
  time: {
    label: 'Time',
    icon: 'clock',
    kind: 'string',
    variant: 'time',
    class: 'string',
    palette: 'datetime',
    description: 'A time of day without a time zone.',
    sections: ['general', 'default'],
  },
  dateTime: {
    label: 'Date & time',
    icon: 'dateTime',
    kind: 'string',
    variant: 'date-time',
    class: 'string',
    palette: 'datetime',
    description: 'An exact moment, stored in UTC.',
    sections: ['general', 'default'],
  },
  group: {
    label: 'Group',
    icon: 'group',
    kind: 'object',
    class: 'object',
    palette: 'structure',
    description: 'A set of named fields.',
    sections: ['general', 'fields'],
  },
  list: {
    label: 'List',
    icon: 'list',
    kind: 'array',
    class: 'array',
    palette: 'structure',
    description: 'Any number of entries of the same kind.',
    sections: ['general', 'items'],
  },
});

const DEFAULT_CHOICES = Object.freeze(['Option 1', 'Option 2']);

/** The element id of a node; null for references and unsupported nodes. */
export function elementOf(node) {
  if (!node) return null;
  if (node.kind === 'string') {
    return Object.values(ELEMENTS).find((el) => el.variant === node.variant)?.id ?? 'text';
  }
  return Object.values(ELEMENTS).find((el) => el.kind === node.kind && !el.variant)?.id ?? null;
}

export function elementFor(node) {
  const id = elementOf(node);
  return id ? ELEMENTS[id] : null;
}

/** With `siblingKeys` (a Group child), the node gets a unique key derived from its title. */
export function createNode(elementId, { siblingKeys = null, title } = {}) {
  const el = ELEMENTS[elementId];
  if (!el) throw new Error(`Unknown element "${elementId}"`);
  const node = { id: createId(), kind: el.kind, title: title ?? el.label };
  if (el.variant) node.variant = el.variant;
  if (el.variant === 'choice') node.enum = [...DEFAULT_CHOICES];
  if (el.kind === 'object') node.children = [];
  if (el.kind === 'array') node.item = null;
  if (Array.isArray(siblingKeys)) node.key = deriveKey(node.title, siblingKeys);
  return node;
}

export function createRefNode(def, { siblingKeys = null } = {}) {
  const node = {
    id: createId(), kind: 'ref', refDefId: def.id, title: '',
  };
  if (Array.isArray(siblingKeys)) node.key = deriveKey(def.node.title || def.name, siblingKeys);
  return node;
}

export function paletteBySection() {
  return PALETTE_SECTIONS.map((section) => ({
    ...section,
    elements: Object.values(ELEMENTS).filter((el) => el.palette === section.id),
  }));
}

const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export function createModel({ name, title, rootElement = 'group' }) {
  return {
    version: 1,
    name,
    root: createNode(rootElement, { title }),
    defs: [],
    rootExtras: { $schema: SCHEMA_DIALECT },
  };
}
