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
  findNode, getNode, isDescendant, wouldCreateCycle, componentCrossing,
} from '../model/query.js';

// Drop rules. A target is `{ parentId, index }` for a place among a Group's fields, or
// `{ parentId, slot: true }` for a List's item slot.

/** A stable key for a target, matching the `data-*` of the zone that shows it. */
export function targetKey(target) {
  if (!target) return '';
  return `${target.parentId}:${target.slot ? 'slot' : target.index}`;
}

/** The target in the form `ui/shared/actions.js` takes. */
export function toInsertTarget({ parentId, slot, index }) {
  return slot ? { parentId } : { parentId, index };
}

/**
 * Where a click-inserted element goes: into the selected Group or empty List slot, else
 * after the closest selected Group field, else at the end of `top` (the tree shown).
 */
export function insertionPoint(model, selectedId, top) {
  const atEnd = (node) => ({ parentId: node.id, index: node.children?.length ?? 0 });

  let entry = findNode(model, selectedId);
  if (entry) {
    const { node } = entry;
    if (node.kind === 'object') return atEnd(node);
    if (node.kind === 'array' && !node.item) return { parentId: node.id };
    while (entry?.parent && entry.parent.kind !== 'object') entry = findNode(model, entry.parent.id);
    if (entry?.parent) return { parentId: entry.parent.id, index: entry.index + 1 };
  }
  if (top?.kind === 'object') return atEnd(top);
  if (top?.kind === 'array') return { parentId: top.id };
  return null;
}

/** The current List item an insert target would overwrite, if any. */
export function replacedItem(model, { parentId }, movingId) {
  const parent = getNode(model, parentId);
  if (parent?.kind !== 'array' || !parent.item || parent.item.id === movingId) return null;
  return parent.item;
}

function checkCard(model, nodeId, parent, target) {
  const entry = findNode(model, nodeId);
  if (!entry?.parent) return { ok: false, reason: 'This cannot be moved' };
  if (isDescendant(entry.node, parent.id)) {
    return { ok: false, reason: 'A field cannot be moved into itself' };
  }
  if (wouldCreateCycle(model, parent.id, entry.node)) {
    return { ok: false, reason: 'A component cannot contain itself' };
  }
  // Each page edits one tree; moving across a component would change all its uses.
  if (componentCrossing(model, nodeId, parent.id)) {
    return { ok: false, reason: 'Fields move only within their own tree' };
  }
  const sameParent = entry.parent.id === parent.id;
  if (sameParent && parent.kind === 'array') return { ok: false, noop: true };
  if (sameParent && (target.index === entry.index || target.index === entry.index + 1)) {
    return { ok: false, noop: true };
  }
  return { ok: true };
}

/**
 * Whether a drag may drop on a target. Rejections carry a `reason` to show, or `noop`
 * when the drop would change nothing.
 */
export function canDrop(model, drag, target) {
  if (!drag || !target) return { ok: false };
  const parent = getNode(model, target.parentId);
  if (parent?.kind !== 'object' && parent?.kind !== 'array') {
    return { ok: false, reason: 'Only Groups and Lists can contain fields' };
  }
  if (Boolean(target.slot) !== (parent.kind === 'array')) return { ok: false };

  let verdict = { ok: true };
  if (drag.source === 'card') {
    verdict = checkCard(model, drag.nodeId, parent, target);
  } else if (drag.item?.type === 'component'
    && wouldCreateCycle(model, parent.id, { kind: 'ref', refDefId: drag.item.id })) {
    verdict = { ok: false, reason: 'A component cannot contain itself' };
  }
  if (!verdict.ok) return verdict;
  return { ok: true, replace: parent.kind === 'array' && Boolean(parent.item) };
}

/** The hint an accepted target shows; `verdict` is `canDrop`'s result for it. */
export function dropHint(drag, verdict) {
  if (!verdict?.ok) return '';
  if (verdict.replace) return 'Replace';
  return drag?.source === 'card' ? 'Move here' : 'Insert here';
}
