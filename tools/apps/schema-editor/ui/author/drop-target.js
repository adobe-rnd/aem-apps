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
// The DOM half of canvas drag & drop; the rules live in core/dnd/targets.js.

import { findNode } from '../../core/model/query.js';

const ZONES = '.gap, .drop-zone, .slot';

function fromZone(zone) {
  const { parentId, scope = '' } = zone.dataset;
  if (!parentId) return null;
  if ('slot' in zone.dataset) return { parentId, slot: true, scope };
  return { parentId, index: Number(zone.dataset.index), scope };
}

function endOf(node) {
  if (node.kind === 'array') return { parentId: node.id, slot: true, scope: '' };
  if (node.kind === 'object') {
    return { parentId: node.id, index: node.children?.length ?? 0, scope: '' };
  }
  return null;
}

function fromCardHead(model, head, clientY) {
  const card = head.closest('[data-node-id]');
  const entry = findNode(model, card?.dataset.nodeId);
  if (!entry || 'locked' in card.dataset) return null;
  if (!entry.parent) return endOf(entry.node);
  const scope = card.dataset.scope ?? '';
  if (entry.parent.kind === 'array') return { parentId: entry.parent.id, slot: true, scope };
  const { top, height } = head.getBoundingClientRect();
  const after = clientY > top + height / 2;
  return { parentId: entry.parent.id, index: entry.index + (after ? 1 : 0), scope };
}

/**
 * The target under the pointer, with the `scope` of the zone it shows on: a gap, drop zone or
 * item slot, or a card head (before or after by pointer half; the top card means "at the end").
 * Locked rows (a component previewed under a use) and everything around them take no drops.
 */
export function targetFromPath(model, path, clientY) {
  const hit = path.find((el) => el?.matches?.(`[role="tree"], [data-locked], ${ZONES}, .card-head`));
  if (!hit || hit.matches('[role="tree"], [data-locked]')) return null;
  if (hit.matches(ZONES)) return fromZone(hit);
  return fromCardHead(model, hit, clientY);
}

/**
 * The component use whose read-only preview is under the pointer: the first card past the locked
 * rows, going out. A drag there is refused as a whole; the component is edited on its own page.
 * @returns {{ key: string, nodeId: string }|null}
 */
export function blockedUseFromPath(path) {
  const end = path.findIndex((el) => el?.getAttribute?.('role') === 'tree');
  const rows = end < 0 ? path : path.slice(0, end);
  const isLocked = (el) => Boolean(el?.dataset) && 'locked' in el.dataset;
  const first = rows.findIndex(isLocked);
  if (first < 0) return null;
  const use = rows.slice(first)
    .find((el) => !isLocked(el) && el?.dataset?.key && el.dataset.nodeId);
  return use ? { key: use.dataset.key, nodeId: use.dataset.nodeId } : null;
}
