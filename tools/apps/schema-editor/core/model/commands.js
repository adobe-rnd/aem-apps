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
// Pure model commands: each returns `{ model, label, … }` and never mutates its input;
// untouched subtrees are shared, so history can keep snapshots. Invalid requests throw
// `CommandError`.

import { createId } from './ids.js';
import { ELEMENTS, createNode } from './elements.js';
import { deriveKey, deriveDefName, validateDefName } from './keys.js';
import {
  findNode, getDef, isDescendant, refUsages, siblingKeys, wouldCreateCycle,
} from './query.js';

export class CommandError extends Error {}

const FIELD_ONLY = ['key', 'keyLocked', 'keyManual', 'required'];

function omit(obj, keys) {
  const out = { ...obj };
  keys.forEach((key) => delete out[key]);
  return out;
}

function mapNode(node, id, fn) {
  if (!node) return node;
  if (node.id === id) return fn(node);
  if (node.kind === 'object' && node.children) {
    let changed = false;
    const children = node.children.map((child) => {
      const next = mapNode(child, id, fn);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  }
  if (node.kind === 'array' && node.item) {
    const item = mapNode(node.item, id, fn);
    return item !== node.item ? { ...node, item } : node;
  }
  return node;
}

/** Replaces the node `id` (wherever it lives) with `fn(node)`. */
function replaceNode(model, id, fn) {
  const root = mapNode(model.root, id, fn);
  let defsChanged = false;
  const defs = model.defs.map((def) => {
    const node = mapNode(def.node, id, fn);
    if (node === def.node) return def;
    defsChanged = true;
    return { ...def, node };
  });
  if (root === model.root && !defsChanged) return model;
  return { ...model, root, defs: defsChanged ? defs : model.defs };
}

function requireEntry(model, id) {
  const entry = findNode(model, id);
  if (!entry) throw new CommandError(`Node "${id}" not found`);
  return entry;
}

function cloneWithNewIds(node) {
  if (!node) return node;
  const copy = { ...node, id: createId() };
  if (node.children) copy.children = node.children.map(cloneWithNewIds);
  if (node.item) copy.item = cloneWithNewIds(node.item);
  return copy;
}

/** Shapes a node for its new slot: Group children need a unique key, list items have none. */
function fitToParent(node, parent) {
  if (parent.kind === 'array') return omit(node, FIELD_ONLY);
  const taken = siblingKeys(parent, node.id);
  if (node.key && !taken.includes(node.key)) return node;
  const key = deriveKey(node.key || node.title || node.kind, taken);
  return { ...node, key, keyLocked: false };
}

function insertInto(model, parentId, index, node, { replace = false } = {}) {
  const parent = requireEntry(model, parentId).node;
  if (parent.kind !== 'object' && parent.kind !== 'array') {
    throw new CommandError('Only Groups and Lists can contain fields');
  }
  if (wouldCreateCycle(model, parentId, node)) {
    throw new CommandError('A component cannot contain itself');
  }
  if (parent.kind === 'array' && parent.item && parent.item.id !== node.id && !replace) {
    throw new CommandError('A List holds one kind of entry; remove the current one first');
  }
  const fitted = fitToParent(node, parent);
  const next = replaceNode(model, parentId, (p) => {
    if (p.kind === 'array') return { ...p, item: fitted };
    const children = [...(p.children ?? [])];
    const at = Math.max(0, Math.min(index ?? children.length, children.length));
    children.splice(at, 0, fitted);
    return { ...p, children };
  });
  return { model: next, node: fitted };
}

function detach(model, entry) {
  const { node, parent } = entry;
  return replaceNode(model, parent.id, (p) => {
    if (p.kind === 'array') return { ...p, item: null };
    return { ...p, children: p.children.filter((c) => c.id !== node.id) };
  });
}

/** Inserts into a Group at `index`, or a List's item slot; a filled slot needs `replace`. */
export function insertNode(model, {
  parentId, index, node, replace,
}) {
  const { model: next, node: inserted } = insertInto(model, parentId, index, node, { replace });
  return { model: next, label: `Add ${inserted.title || 'field'}`, nodeId: inserted.id };
}

export function moveNode(model, {
  nodeId, parentId, index, replace,
}) {
  const entry = requireEntry(model, nodeId);
  if (!entry.parent) throw new CommandError('This node cannot be moved');
  if (isDescendant(entry.node, parentId)) {
    throw new CommandError('A field cannot be moved into itself');
  }
  let at = index;
  if (entry.parent.id === parentId && entry.parent.kind === 'object' && at > entry.index) at -= 1;
  if (entry.parent.id === parentId && at === entry.index) return { model, label: 'Move' };
  const without = detach(model, entry);
  const { model: next } = insertInto(without, parentId, at, entry.node, { replace });
  return { model: next, label: `Move ${entry.node.title || 'field'}`, nodeId };
}

export function removeNode(model, { nodeId }) {
  const entry = requireEntry(model, nodeId);
  if (!entry.parent) throw new CommandError('This node cannot be removed');
  return { model: detach(model, entry), label: `Remove ${entry.node.title || 'field'}` };
}

export function duplicateNode(model, { nodeId }) {
  const entry = requireEntry(model, nodeId);
  if (entry.parent?.kind !== 'object') throw new CommandError('Only Group fields can be duplicated');
  const copy = { ...cloneWithNewIds(entry.node), keyLocked: false, keyManual: false };
  copy.key = deriveKey(copy.title || copy.key, siblingKeys(entry.parent));
  const { model: next } = insertInto(model, entry.parent.id, entry.index + 1, copy);
  return { model: next, label: `Duplicate ${entry.node.title || 'field'}`, nodeId: copy.id };
}

/**
 * Patches node fields (`undefined` removes one). A title change re-derives the key until
 * the key was edited manually or saved once.
 */
export function updateNode(model, { nodeId, patch }) {
  const entry = requireEntry(model, nodeId);
  let next = { ...entry.node };
  Object.entries(patch).forEach(([field, value]) => {
    if (value === undefined) delete next[field];
    else next[field] = value;
  });
  if ('key' in patch) next.keyManual = true;
  const parentIsGroup = entry.parent?.kind === 'object';
  if ('title' in patch && parentIsGroup && !next.keyManual && !next.keyLocked) {
    next.key = deriveKey(next.title, siblingKeys(entry.parent, nodeId));
  }
  if ('enum' in patch && Array.isArray(next.enum) && next.default !== undefined
    && !next.enum.includes(next.default)) {
    delete next.default;
  }
  if (!parentIsGroup) next = omit(next, FIELD_ONLY);
  const fields = Object.keys(patch).sort().join(',');
  return {
    model: replaceNode(model, nodeId, () => next),
    label: `Edit ${next.title || 'field'}`,
    coalesceKey: `${nodeId}:${fields}`,
  };
}

const STRING_TEXT = ['text', 'long-text'];

function keepDefault(node, el) {
  if (node.default === undefined) return false;
  if (node.kind !== el.kind) return false;
  if (el.kind !== 'string') return el.kind !== 'integer' || Number.isInteger(node.default);
  if (node.variant === el.variant) return true;
  if (STRING_TEXT.includes(node.variant) && STRING_TEXT.includes(el.variant)) return true;
  return el.variant === 'choice' && node.variant !== 'choice'
    && typeof node.default === 'string';
}

const ELEMENT_FIELDS = [
  'variant', 'enum', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
  'children', 'item', 'minItems', 'maxItems', 'default', 'refDefId', 'raw', 'reason', 'missingType',
  'requiredUnknown',
];

/** Switches the element in place; settings that no longer apply are listed in `dropped`. */
export function changeElement(model, { nodeId, element }) {
  const el = ELEMENTS[element];
  if (!el) throw new CommandError(`Unknown element "${element}"`);
  const { node } = requireEntry(model, nodeId);
  if (model.root.id === nodeId && el.kind !== 'object' && el.kind !== 'array') {
    throw new CommandError('The schema must be a Group or a List');
  }

  const next = { ...omit(node, ELEMENT_FIELDS), kind: el.kind };
  const fresh = createNode(element);
  if (el.variant) next.variant = el.variant;

  if (el.kind === 'string') {
    if (STRING_TEXT.includes(el.variant) && node.kind === 'string') {
      ['minLength', 'maxLength', 'pattern'].forEach((k) => {
        if (node[k] !== undefined) next[k] = node[k];
      });
    }
    if (el.variant === 'choice') {
      next.enum = node.variant === 'choice' ? node.enum : fresh.enum;
      if (keepDefault(node, el) && !next.enum.includes(node.default)) {
        next.enum = [...next.enum, node.default];
      }
    }
  }
  if (el.kind === 'number' || el.kind === 'integer') {
    if (node.kind === 'number' || node.kind === 'integer') {
      ['minimum', 'maximum'].forEach((k) => {
        if (node[k] !== undefined) next[k] = node[k];
      });
    }
  }
  if (el.kind === 'object') {
    if (node.kind === 'object') next.children = node.children;
    else if (node.kind === 'array' && node.item?.kind === 'object') next.children = node.item.children;
    else next.children = [];
  }
  if (el.kind === 'array') {
    if (node.kind === 'array') {
      next.item = node.item;
      ['minItems', 'maxItems'].forEach((k) => {
        if (node[k] !== undefined) next[k] = node[k];
      });
    } else if (node.kind === 'object') {
      next.item = { ...omit(node, [...FIELD_ONLY, 'description', 'readOnly']), id: createId() };
    } else {
      next.item = null;
    }
  }
  if (keepDefault(node, el)) next.default = node.default;

  const dropped = ELEMENT_FIELDS
    .filter((k) => !['variant', 'children', 'item', 'reason', 'raw', 'refDefId'].includes(k))
    .filter((k) => node[k] !== undefined && next[k] === undefined);

  return {
    model: replaceNode(model, nodeId, () => next),
    label: `Change ${node.title || 'field'} to ${el.label}`,
    dropped,
  };
}

function assertDefName(model, name, exceptId) {
  const taken = model.defs.filter((d) => d.id !== exceptId).map((d) => d.name);
  const error = validateDefName(name, taken);
  if (error) throw new CommandError(error);
}

export function addDef(model, { name, node } = {}) {
  const defName = name ?? deriveDefName('Component', model.defs.map((d) => d.name));
  assertDefName(model, defName);
  const def = {
    id: createId(),
    name: defName,
    node: node ? omit(node, FIELD_ONLY) : createNode('group', { title: defName }),
  };
  return { model: { ...model, defs: [...model.defs, def] }, label: `Add ${defName}`, defId: def.id };
}

export function renameDef(model, { defId, name }) {
  if (!getDef(model, defId)) throw new CommandError('Component not found');
  assertDefName(model, name, defId);
  return {
    model: { ...model, defs: model.defs.map((d) => (d.id === defId ? { ...d, name } : d)) },
    label: `Rename component to ${name}`,
  };
}

function detachedCopy(model, refNode) {
  const def = getDef(model, refNode.refDefId);
  if (!def) throw new CommandError('Component not found');
  const copy = cloneWithNewIds(def.node);
  const fields = {};
  FIELD_ONLY.forEach((k) => {
    if (refNode[k] !== undefined) fields[k] = refNode[k];
  });
  if (refNode.title) fields.title = refNode.title;
  if (refNode.description) fields.description = refNode.description;
  return { ...copy, ...fields, id: refNode.id };
}

/** Replaces a component usage with an editable copy of the component. */
export function detachRef(model, { nodeId }) {
  const { node } = requireEntry(model, nodeId);
  if (node.kind !== 'ref') throw new CommandError('Only component usages can be detached');
  return {
    model: replaceNode(model, nodeId, () => detachedCopy(model, node)),
    label: 'Detach component',
  };
}

/** Deletes a component; usages (if any) are detached first. */
export function deleteDef(model, { defId }) {
  const def = getDef(model, defId);
  if (!def) throw new CommandError('Component not found');
  let next = model;
  refUsages(model, defId).forEach(({ node }) => {
    next = replaceNode(next, node.id, () => detachedCopy(model, node));
  });
  next = { ...next, defs: next.defs.filter((d) => d.id !== defId) };
  if (refUsages(next, defId).length) throw new CommandError('A component cannot contain itself');
  return {
    model: next,
    label: `Delete ${def.name}`,
  };
}

/** Moves a Group/List into `$defs` and leaves a reference in its place. */
export function makeComponent(model, { nodeId, name }) {
  const entry = requireEntry(model, nodeId);
  if (!entry.parent) throw new CommandError('This node cannot become a component');
  if (!['object', 'array'].includes(entry.node.kind)) {
    throw new CommandError('Only Groups and Lists can become components');
  }
  const defName = name ?? deriveDefName(entry.node.title, model.defs.map((d) => d.name));
  assertDefName(model, defName);
  const def = { id: createId(), name: defName, node: omit(entry.node, FIELD_ONLY) };
  def.node = { ...def.node, id: createId() };
  const ref = {
    id: entry.node.id, kind: 'ref', refDefId: def.id, title: '',
  };
  FIELD_ONLY.forEach((k) => {
    if (entry.node[k] !== undefined) ref[k] = entry.node[k];
  });
  const replaced = replaceNode(model, nodeId, () => ref);
  return {
    model: { ...replaced, defs: [...replaced.defs, def] },
    label: `Make ${defName} reusable`,
    defId: def.id,
  };
}

function lockNodeKeys(node) {
  if (!node) return node;
  let next = node;
  if (node.key !== undefined && !node.keyLocked) next = { ...next, keyLocked: true };
  if (node.children) {
    const children = node.children.map(lockNodeKeys);
    if (children.some((c, i) => c !== node.children[i])) next = { ...next, children };
  }
  if (node.item) {
    const item = lockNodeKeys(node.item);
    if (item !== node.item) next = { ...next, item };
  }
  return next;
}

/** Applied after a successful save, not a user command: keys stop following their label. */
export function lockKeys(model) {
  const root = lockNodeKeys(model.root);
  const defs = model.defs.map((def) => {
    const node = lockNodeKeys(def.node);
    return node === def.node ? def : { ...def, node };
  });
  return { ...model, root, defs };
}
