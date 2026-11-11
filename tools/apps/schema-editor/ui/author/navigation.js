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
// Keyboard model of the canvas tree, kept pure: visible rows in document order and what a key does
// from a row. A component's fields show under every use, so one node can be on screen several
// times: a row's key is its node id prefixed by the keys of the uses it shows under (its scope).
// Rows in a scope are a read-only preview; a component is edited on its own Components page.

import { isContainer, fieldsOf, componentOf } from './card-info.js';

export const rowKey = (scope, id) => (scope ? `${scope}/${id}` : id);

export const inPreview = (scope) => Boolean(scope);

/** The outermost use of a preview `scope`: a top-level row, so its key is its node id. */
export const outerUse = (scope) => scope.split('/')[0];

/**
 * Fold state: Groups and Lists start open, component uses folded, so it records the rows the
 * user closed (`collapsed`) and the uses they opened (`opened`).
 */
export const NO_FOLDS = Object.freeze({ collapsed: new Set(), opened: new Set() });

export function isFolded({ collapsed, opened }, key, open) {
  return open.def ? !opened.has(key) : collapsed.has(key);
}

export function withOpen({ collapsed, opened }, keys, open) {
  const nextCollapsed = new Set(collapsed);
  const nextOpened = new Set(opened);
  keys.forEach((key) => {
    if (open) {
      nextCollapsed.delete(key);
      nextOpened.add(key);
    } else {
      nextCollapsed.add(key);
      nextOpened.delete(key);
    }
  });
  return { collapsed: nextCollapsed, opened: nextOpened };
}

/** Keys of the rows Expand all toggles: every row that opens, except the top. */
export const foldableKeys = (rows) => rows
  .filter((row) => row.container && row.parentKey).map((row) => row.key);

/** Whether every foldable row is open; visible rows suffice, as the outermost fold shows. */
export const allOpen = (rows) => rows
  .every((row) => !row.container || !row.parentKey || row.expanded);

/**
 * What a row opens to: a container's fields, or a use's component fields. A use of a component
 * in `seen` (those the row already shows under) does not open again, so cycles stay finite.
 *
 * @returns {{ owner: object, fields: object[], scope: string, seen: Set<string>,
 *   def?: object }|null}
 */
export function opening(model, node, scope, seen) {
  if (isContainer(node)) {
    return {
      owner: node, fields: fieldsOf(node), scope, seen,
    };
  }
  const def = componentOf(model, node);
  if (!def || seen.has(def.id)) return null;
  return {
    owner: def.node,
    fields: fieldsOf(def.node),
    scope: rowKey(scope, node.id),
    seen: new Set([...seen, def.id]),
    def,
  };
}

/**
 * Visible rows under `top`, depth-first. `folded(key, open)` tells whether a row is folded (none
 * by default); `def` is the component when `top` is its node.
 *
 * @returns {{ key: string, id: string, scope: string, parentKey: string|null,
 *   level: number, container: boolean, expanded: boolean }[]}
 */
export function visibleRows(model, top, folded = () => false, def = null) {
  const rows = [];
  const visit = (node, scope, parentKey, level, seen) => {
    const key = rowKey(scope, node.id);
    const open = opening(model, node, scope, seen);
    const expanded = Boolean(open) && !folded(key, open);
    rows.push({
      key, id: node.id, scope, parentKey, level, container: Boolean(open), expanded,
    });
    if (!expanded) return;
    open.fields.forEach((child) => visit(child, open.scope, key, level + 1, open.seen));
  };
  if (top) visit(top, '', null, 1, new Set(def ? [def.id] : []));
  return rows;
}

/**
 * Resolves an arrow / Home / End key on the row `currentKey`.
 * @returns {{ focus?: string, expand?: string, collapse?: string }|null} Row keys, or null.
 */
export function treeKey(rows, currentKey, key) {
  const index = rows.findIndex((row) => row.key === currentKey);
  const row = rows[index];
  if (!row) return rows.length ? { focus: rows[0].key } : null;
  switch (key) {
    case 'ArrowDown': return rows[index + 1] ? { focus: rows[index + 1].key } : null;
    case 'ArrowUp': return rows[index - 1] ? { focus: rows[index - 1].key } : null;
    case 'Home': return { focus: rows[0].key };
    case 'End': return { focus: rows[rows.length - 1].key };
    case 'ArrowRight': {
      if (row.container && !row.expanded) return { expand: row.key };
      const next = rows[index + 1];
      return row.container && next?.parentKey === row.key ? { focus: next.key } : null;
    }
    case 'ArrowLeft':
      if (row.container && row.expanded && row.parentKey) return { collapse: row.key };
      return row.parentKey ? { focus: row.parentKey } : null;
    default: return null;
  }
}

export function ancestorKeys(rows, key) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const keys = [];
  let row = byKey.get(byKey.get(key)?.parentKey);
  while (row) {
    keys.push(row.key);
    row = byKey.get(row.parentKey);
  }
  return keys;
}
