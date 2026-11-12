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
// Pure helpers for what a canvas card shows about its node: kind label, constraint chips, icon.

import { elementFor } from '../../core/model/elements.js';
import { getDef } from '../../core/model/query.js';

// "1 item" and "≥ 1 item", but "1–3 items".
const per = (count, unit) => (count === 1 ? unit.replace(/s$/, '') : unit);

const range = (min, max, unit = '') => {
  if (min !== undefined && max !== undefined) {
    return min === max ? `${min}${per(min, unit)}` : `${min}–${max}${unit}`;
  }
  if (min !== undefined) return `≥ ${min}${per(min, unit)}`;
  if (max !== undefined) return `≤ ${max}${per(max, unit)}`;
  return null;
};

export function componentOf(model, node) {
  return node?.kind === 'ref' ? getDef(model, node.refDefId) : null;
}

export function nodeIcon(node) {
  if (node?.kind === 'ref') return 'component';
  if (node?.kind === 'unsupported') return 'alert';
  return elementFor(node)?.icon ?? 'text';
}

/** "Text", "Choice (4)", "List of Date", "Component: Contact", "Unsupported: oneOf". */
export function kindLabel(model, node) {
  if (!node) return '';
  if (node.kind === 'ref') {
    const def = componentOf(model, node);
    return `Component: ${def ? def.name : 'missing'}`;
  }
  if (node.kind === 'unsupported') return `Unsupported: ${node.reason ?? 'keyword'}`;
  const element = elementFor(node);
  if (node.kind === 'array') {
    if (!node.item) return 'List';
    if (node.item.kind === 'ref') return `List of ${componentOf(model, node.item)?.name ?? 'Component'}`;
    return `List of ${elementFor(node.item)?.label ?? 'items'}`;
  }
  if (element?.variant === 'choice') return `Choice (${node.enum?.length ?? 0})`;
  return element?.label ?? node.kind;
}

/** Constraint chips: "Required", "3–30 chars", "pattern", "1–10 items"… */
export function constraintChips(node) {
  if (!node) return [];
  const chips = [];
  if (node.required) chips.push('Required');
  if (node.readOnly) chips.push('Read-only');
  if (node.kind === 'string') {
    const length = range(node.minLength, node.maxLength, ' chars');
    if (length) chips.push(length);
    if (node.pattern) chips.push('pattern');
  }
  if (node.kind === 'number' || node.kind === 'integer') {
    const bounds = range(node.minimum, node.maximum);
    if (bounds) chips.push(bounds);
  }
  if (node.kind === 'array') {
    const items = range(node.minItems, node.maxItems, ' items');
    if (items) chips.push(items);
  }
  if (node.default !== undefined && node.kind !== 'object' && node.kind !== 'array') {
    chips.push(`Default: ${String(node.default)}`);
  }
  return chips;
}

/** A narrow card's chips: Required and Read-only (they change what authors do), then "+N". */
export function compactChips(node) {
  const flags = [node?.required && 'Required', node?.readOnly && 'Read-only'].filter(Boolean);
  const rest = constraintChips(node).length - flags.length;
  return rest ? [...flags, `+${rest}`] : flags;
}

export const isContainer = (node) => node?.kind === 'object' || node?.kind === 'array';

/** The component icon tops a component's own tree (`def`); other cards show their type. */
export function cardIcon(node, { def = null } = {}) {
  return def ? 'component' : nodeIcon(node);
}

export function fieldsOf(node) {
  if (node?.kind === 'object') return node.children ?? [];
  if (node?.kind === 'array') return node.item ? [node.item] : [];
  return [];
}
