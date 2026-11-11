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
// User intents shared by the canvas, panel views and drag & drop: a store command plus the
// follow-up UX (selection, confirmation, toast). Keeps the store UI-agnostic.

import {
  insertNode, moveNode, removeNode, duplicateNode, makeComponent, addDef, deleteDef,
} from '../../core/model/commands.js';
import { createNode, createRefNode } from '../../core/model/elements.js';
import {
  findNode, getDef, getNode, labelOf, refUsages, siblingKeys,
} from '../../core/model/query.js';
import { topNode } from '../../core/session/modes.js';
import { insertionPoint, replacedItem } from '../../core/dnd/targets.js';
import { confirmDialog } from './confirm.js';
import { modKey, usedTimes } from './format.js';

function clickTarget(store) {
  const top = topNode(store.model, store.editingDefId, store.page);
  return insertionPoint(store.model, store.selection, top);
}

async function confirmReplace(store, target, incomingLabel, movingId) {
  const current = replacedItem(store.model, target, movingId);
  if (!current) return { ok: true, replace: false };
  const confirmed = await confirmDialog({
    title: 'Replace list item?',
    message: `Replace list item "${labelOf(store.model, current)}" with "${incomingLabel}"?`,
    confirmLabel: 'Replace',
    destructive: true,
  });
  return { ok: confirmed, replace: confirmed };
}

function freshNode(model, parentId, make) {
  const parent = getNode(model, parentId);
  return make(parent?.kind === 'object' ? siblingKeys(parent) : null);
}

async function place(store, target, make, label) {
  if (!target) return { ok: false };
  const { ok, replace } = await confirmReplace(store, target, label);
  if (!ok) return { ok: false };
  const node = freshNode(store.model, target.parentId, make);
  const result = store.dispatch(insertNode, { ...target, node, replace });
  if (result.ok) store.select(result.result.nodeId, { reveal: true });
  return result;
}

/** Inserts a new element at `target`, or at the click insertion point. */
export function insertElement(store, element, target) {
  const at = target ?? clickTarget(store);
  return place(store, at, (keys) => createNode(element.id, { siblingKeys: keys }), element.label);
}

export function insertComponent(store, defId, target) {
  const def = getDef(store.model, defId);
  if (!def) return Promise.resolve({ ok: false });
  const at = target ?? clickTarget(store);
  return place(store, at, (keys) => createRefNode(def, { siblingKeys: keys }), def.name);
}

export async function moveTo(store, nodeId, target) {
  const label = labelOf(store.model, getNode(store.model, nodeId));
  const { ok, replace } = await confirmReplace(store, target, label, nodeId);
  if (!ok) return { ok: false };
  const result = store.dispatch(moveNode, { nodeId, ...target, replace });
  if (result.ok) store.select(nodeId, { reveal: true });
  return result;
}

/** Moves a Group field one position up (-1) or down (+1) among its siblings. */
export function moveBy(store, nodeId, delta) {
  const entry = findNode(store.model, nodeId);
  if (entry?.parent?.kind !== 'object') return { ok: false };
  const index = entry.index + delta;
  if (index < 0 || index >= entry.parent.children.length) return { ok: false };
  const target = delta > 0 ? index + 1 : index;
  const result = store.dispatch(moveNode, { nodeId, parentId: entry.parent.id, index: target });
  if (result.ok) store.select(nodeId, { reveal: true });
  return result;
}

export function duplicate(store, nodeId) {
  const result = store.dispatch(duplicateNode, { nodeId });
  if (result.ok) store.select(result.result.nodeId, { reveal: true });
  return result;
}

export function remove(store, nodeId) {
  const entry = findNode(store.model, nodeId);
  if (!entry?.parent) return { ok: false };
  const label = labelOf(store.model, entry.node) || 'field';
  const siblings = entry.parent.kind === 'object' ? entry.parent.children : [];
  const neighbour = siblings[entry.index + 1] ?? siblings[entry.index - 1] ?? entry.parent;

  const result = store.dispatch(removeNode, { nodeId });
  if (!result.ok) return result;
  store.select(neighbour.id, { reveal: true });
  store.bus.toastRequest.emit({ message: `Deleted "${label}". Press ${modKey()}Z to undo.` });
  return result;
}

/** Turns a Group or List into a component and leaves a usage in its place. */
export function makeReusable(store, nodeId) {
  const result = store.dispatch(makeComponent, { nodeId });
  if (result.ok) {
    const name = getDef(store.model, result.result.defId)?.name;
    store.bus.toastRequest.emit({ message: `Created component "${name}".` });
  }
  return result;
}

/** Opens the component `defId`, or the one node `nodeId` uses, on the Components page. */
export function editComponent(store, { nodeId, defId }) {
  const id = defId ?? getNode(store.model, nodeId)?.refDefId;
  if (id) store.revealDef(id);
}

export function newComponent(store) {
  const result = store.dispatch(addDef, {});
  if (result.ok) store.revealDef(result.result.defId);
  return result;
}

/** Deletes a component; usages are detached (copied in place) after confirmation. */
export async function deleteComponent(store, defId) {
  const def = getDef(store.model, defId);
  if (!def) return { ok: false };
  const used = refUsages(store.model, defId).length;
  if (used) {
    const confirmed = await confirmDialog({
      title: `Delete ${def.name}?`,
      message: `"${def.name}" is used ${usedTimes(used)}. `
        + 'Each usage gets its own copy of the fields, then the component is deleted.',
      confirmLabel: 'Detach and delete',
      destructive: true,
    });
    if (!confirmed) return { ok: false };
  }
  const result = store.dispatch(deleteDef, { defId });
  if (result.ok) store.bus.toastRequest.emit({ message: `Deleted "${def.name}". Press ${modKey()}Z to undo.` });
  return result;
}

/** Applies a linter quick fix as one undoable edit. */
export function applyFix(store, issue) {
  if (!issue?.fix) return { ok: false };
  return store.dispatch((model) => issue.fix.run(model));
}

export async function copyText(store, text, what = 'Text') {
  try {
    await navigator.clipboard.writeText(text);
    store.bus.toastRequest.emit({ message: `${what} copied.` });
    return true;
  } catch {
    store.bus.toastRequest.emit({ message: `${what} could not be copied.`, variant: 'negative' });
    return false;
  }
}
