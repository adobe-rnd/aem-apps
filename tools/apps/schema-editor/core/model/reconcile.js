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
// Carries identity from a model onto its replacement parsed from edited JSON, so the selection
// and the component shown survive, and only keys saved documents use stay locked. Nodes match
// by position: the root, a component by name, a field by key (the first, if keys repeat), a
// list's item. Pure, so it is unit-tested.

function firstByKey(children = []) {
  const byKey = new Map();
  children.forEach((child) => { if (!byKey.has(child.key)) byKey.set(child.key, child); });
  return byKey;
}

function carry(node, before, defIds) {
  if (!node) return node;
  const out = { ...node };
  if (before) out.id = before.id;
  if (node.kind === 'ref') out.refDefId = defIds.get(node.refDefId) ?? node.refDefId;
  if (node.key !== undefined) {
    out.keyLocked = !!before?.keyLocked;
    out.keyManual = before ? !!before.keyManual : true;
  }
  if (node.children) {
    const previous = firstByKey(before?.kind === 'object' ? before.children : []);
    out.children = node.children.map((child) => carry(child, previous.get(child.key), defIds));
  }
  if (node.item) out.item = carry(node.item, before?.kind === 'array' ? before.item : null, defIds);
  return out;
}

/** `next` with the ids and key locks of the matching parts of `prev`. */
// eslint-disable-next-line import/prefer-default-export
export function reconcile(prev, next) {
  if (!prev) return next;
  const previous = new Map(prev.defs.map((def) => [def.name, def]));
  const defIds = new Map(next.defs
    .filter((def) => previous.has(def.name))
    .map((def) => [def.id, previous.get(def.name).id]));
  const defs = next.defs.map((def) => ({
    ...def,
    id: defIds.get(def.id) ?? def.id,
    node: carry(def.node, previous.get(def.name)?.node, defIds),
  }));
  return { ...next, root: carry(next.root, prev.root, defIds), defs };
}
