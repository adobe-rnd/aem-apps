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
// Read-only lookups over the authoring model.

import { encodePointerToken } from './parse.js';

function* walkNode(node, ctx) {
  if (!node) return;
  yield { node, ...ctx };
  const path = [...ctx.path, node];
  if (node.kind === 'object') {
    for (let i = 0; i < (node.children ?? []).length; i += 1) {
      const child = node.children[i];
      yield* walkNode(child, {
        parent: node,
        index: i,
        def: ctx.def,
        path,
        pointer: `${ctx.pointer}/properties/${encodePointerToken(child.key ?? '')}`,
      });
    }
  }
  if (node.kind === 'array' && node.item) {
    yield* walkNode(node.item, {
      parent: node,
      index: 0,
      def: ctx.def,
      path,
      pointer: `${ctx.pointer}/items`,
    });
  }
}

/**
 * Yields every node (root tree first, then components) as `{ node, parent, index, def, path,
 * pointer }`: `path` lists the ancestors, `pointer` locates it in the serialized schema.
 */
export function* walk(model) {
  if (!model) return;
  yield* walkNode(model.root, {
    parent: null, index: 0, def: null, path: [], pointer: '',
  });
  yield* model.defs.flatMap((def) => [...walkNode(def.node, {
    parent: null,
    index: 0,
    def,
    path: [],
    pointer: `/$defs/${encodePointerToken(def.name)}`,
  })]);
}

export function findNode(model, id) {
  if (!id) return null;
  return [...walk(model)].find((entry) => entry.node.id === id) ?? null;
}

export function getNode(model, id) {
  return findNode(model, id)?.node ?? null;
}

export function getDef(model, defId) {
  return model.defs.find((def) => def.id === defId) ?? null;
}

export function isDescendant(ancestor, id) {
  return [...walkNode(ancestor, { path: [], pointer: '' })].some(({ node }) => node.id === id);
}

export function siblingKeys(parent, excludeId) {
  if (parent?.kind !== 'object') return [];
  return (parent.children ?? []).filter((c) => c.id !== excludeId).map((c) => c.key);
}

export function refUsages(model, defId) {
  return [...walk(model)].filter(({ node }) => node.kind === 'ref' && node.refDefId === defId);
}

function refsIn(node) {
  return new Set([...walkNode(node, { path: [], pointer: '' })]
    .filter(({ node: n }) => n.kind === 'ref')
    .map(({ node: n }) => n.refDefId));
}

/** Ids of all components reachable from `node` through references. */
function reachableDefs(model, node) {
  const seen = new Set();
  const queue = [...refsIn(node)];
  while (queue.length) {
    const id = queue.shift();
    if (!seen.has(id)) {
      seen.add(id);
      const def = getDef(model, id);
      if (def) queue.push(...refsIn(def.node));
    }
  }
  return seen;
}

export function cyclicDefs(model) {
  return model.defs.filter((def) => reachableDefs(model, def.node).has(def.id));
}

export function wouldCreateCycle(model, parentId, node) {
  const parent = findNode(model, parentId);
  if (!parent?.def) return false;
  const reached = reachableDefs(model, node);
  return reached.has(parent.def.id);
}

/**
 * The components a move of `nodeId` under `parentId` leaves (`from`) and joins (`to`);
 * null when it stays within one component, or outside all of them.
 */
export function componentCrossing(model, nodeId, parentId) {
  const from = findNode(model, nodeId)?.def ?? null;
  const to = findNode(model, parentId)?.def ?? null;
  if (from?.id === to?.id) return null;
  return { from, to };
}

/** Display label of a node (references fall back to the component title). */
export function labelOf(model, node) {
  if (!node) return '';
  if (node.title) return node.title;
  if (node.kind === 'ref') {
    const def = getDef(model, node.refDefId);
    return def?.node.title || def?.name || '';
  }
  return node.key ?? '';
}

export function breadcrumb(model, id) {
  const entry = findNode(model, id);
  if (!entry) return [];
  const labels = [...entry.path, entry.node].map((n) => labelOf(model, n));
  return entry.def ? [entry.def.name, ...labels.slice(1)] : labels;
}
