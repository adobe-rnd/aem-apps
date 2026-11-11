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
// The authoring pages and which nodes each shows. A page is `{ mode, componentId }`: Build
// shows the schema, Components one component (`$defs`). A page edits only its own tree; a
// used component's fields only preview there and are revealed on that component's page.

import { findNode, getDef } from '../model/query.js';

export const MODES = Object.freeze(['build', 'components']);

/** The tree a page shows: the schema root, or the chosen component (null if none). */
export function pageTop(model, { mode, componentId } = {}) {
  if (!model) return null;
  if (mode !== 'components') return { node: model.root, def: null };
  const def = componentId ? getDef(model, componentId) : null;
  return def ? { node: def.node, def } : null;
}

/** The top node holding the selection: its component's, else the top of `page`. */
export function topNode(model, editingDefId, page) {
  if (!model) return null;
  const def = editingDefId ? getDef(model, editingDefId) : null;
  return def?.node ?? pageTop(model, page)?.node ?? null;
}

/** Whether `page` shows the node `nodeId` in its own (editable) tree. */
export function pageShows(model, nodeId, page) {
  const entry = model ? findNode(model, nodeId) : null;
  const top = pageTop(model, page);
  if (!entry || !top) return false;
  return (entry.def?.id ?? null) === (top.def?.id ?? null);
}

/** Where to reveal `nodeId`: the current page, else its component's, else Build. */
export function pageFor(model, nodeId, page) {
  if (pageShows(model, nodeId, page)) return page;
  const def = findNode(model, nodeId)?.def;
  return def ? { mode: 'components', componentId: def.id } : { ...page, mode: 'build' };
}

/** The component Components opens on, preferring the one the user works in. */
export function componentFor(model, nodeId, componentId) {
  if (!model?.defs.length) return null;
  const current = componentId && getDef(model, componentId) ? componentId : null;
  const entry = nodeId ? findNode(model, nodeId) : null;
  if (current && entry && pageShows(model, nodeId, { mode: 'components', componentId })) return current;
  const used = entry?.node.kind === 'ref' ? getDef(model, entry.node.refDefId) : null;
  return used?.id ?? entry?.def?.id ?? current ?? model.defs[0].id;
}

/** What stays selected on `page`; a use of the page's component selects its top. */
export function selectionAfter(model, nodeId, page) {
  if (!nodeId) return null;
  if (pageShows(model, nodeId, page)) return nodeId;
  const node = findNode(model, nodeId)?.node;
  const top = pageTop(model, page);
  if (node?.kind === 'ref' && top?.def && node.refDefId === top.def.id) return top.node.id;
  return null;
}
