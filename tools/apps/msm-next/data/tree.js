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
import { findLocation } from '../../../localization/core/domain/resolve.js';
import {
  needsAction, urgencyRank, typeGroup, isRealPage, pageTitle, URGENCY,
} from './display.js';

const joinPath = (folder, rel) => (folder === '/' ? rel : `${folder}${rel}`);
const relativeTo = (folder, path) => (folder === '/' ? path : path.slice(folder.length));
export const nodeKey = (site, path) => `${site}:${path}`;

export function topLocation(model, location) {
  let current = location;
  const seen = new Set();
  while (current.source && model.locations.has(current.source) && !seen.has(current.id)) {
    seen.add(current.id);
    current = model.locations.get(current.source);
  }
  return current;
}

export function treeRoots(model, site) {
  const roots = [];
  model.locations.forEach((location) => {
    if (location.site !== site) return;
    const root = topLocation(model, location);
    if (!roots.includes(root)) roots.push(root);
  });
  return roots;
}

export function childLocations(model) {
  const children = new Map();
  model.locations.forEach((location) => {
    if (!location.source || !model.locations.has(location.source)) return;
    if (!children.has(location.source)) children.set(location.source, []);
    children.get(location.source).push(location);
  });
  return children;
}

export function treeLocations(model, roots) {
  const children = childLocations(model);
  const result = [];
  const seen = new Set();
  const visit = (location, depth, parentId) => {
    if (seen.has(location.id)) return;
    seen.add(location.id);
    result.push({ location, depth, parentId });
    (children.get(location.id) ?? []).forEach((child) => visit(child, depth + 1, location.id));
  };
  roots.forEach((root) => visit(root, 0, null));
  return result;
}

export function compareRel(first, second) {
  const rank = (rel) => (rel === '/index.html' ? 0 : 1);
  return rank(first) - rank(second) || first.localeCompare(second);
}

export function buildPageTree({ model, roots, files }) {
  const children = childLocations(model);
  const nodes = new Map();
  const top = [];

  const makeNode = (location, rel, depth, parent) => {
    const path = joinPath(location.path, rel);
    const key = nodeKey(location.site, path);
    if (nodes.has(key)) return null;
    if (findLocation(model, location.site, path)?.id !== location.id) return null;
    const node = {
      key,
      site: location.site,
      path,
      rel,
      title: pageTitle(rel),
      location,
      depth,
      parent: parent?.key ?? null,
      children: [],
    };
    nodes.set(key, node);
    (children.get(location.id) ?? []).forEach((child) => {
      const childNode = makeNode(child, rel, depth + 1, node);
      if (childNode) node.children.push(childNode);
    });
    return node;
  };

  const visited = new Set();
  const visit = (location, depth, covered) => {
    if (visited.has(location.id)) return;
    visited.add(location.id);
    const own = (files.get(location.id) ?? [])
      .map((path) => relativeTo(location.path, path))
      .sort(compareRel);
    own.filter((rel) => !covered.has(rel)).forEach((rel) => {
      const node = makeNode(location, rel, depth, null);
      if (node) top.push(node);
    });
    const next = new Set([...covered, ...own]);
    (children.get(location.id) ?? []).forEach((child) => visit(child, depth + 1, next));
  };
  roots.forEach((root) => visit(root, 0, new Set()));

  return { top, nodes };
}

export function descendants(node) {
  const result = [];
  const walk = (current) => current.children.forEach((child) => {
    result.push(child);
    walk(child);
  });
  walk(node);
  return result;
}

export function ancestors(nodes, node) {
  const result = [];
  let current = node.parent ? nodes.get(node.parent) : null;
  while (current) {
    result.push(current);
    current = current.parent ? nodes.get(current.parent) : null;
  }
  return result;
}

export function matchesKind(node, kind) {
  if (!kind || kind === 'all') return true;
  if (kind === 'variation') return node.location.kind === 'variation';
  return node.location.kind !== 'variation';
}

export function matchesQuery(node, query) {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return true;
  return [node.title, node.path, node.site, node.location.language, node.location.label]
    .some((value) => (value ?? '').toLowerCase().includes(needle));
}

export function matchesType(result, type) {
  if (!type || type === 'all') return true;
  return typeGroup(result) === type;
}

export function visibleSet(tree, predicate) {
  const visible = new Set();
  const matches = new Set();
  tree.nodes.forEach((node) => {
    if (!predicate(node)) return;
    matches.add(node.key);
    visible.add(node.key);
    ancestors(tree.nodes, node).forEach((ancestor) => visible.add(ancestor.key));
  });
  return { visible, matches };
}

export function flattenRows(top, { expanded, visible = null, forceExpand = false }) {
  const rows = [];
  const walk = (siblings, level) => {
    const shown = visible ? siblings.filter((node) => visible.has(node.key)) : siblings;
    shown.forEach((node, index) => {
      const kids = visible
        ? node.children.filter((child) => visible.has(child.key))
        : node.children;
      const open = kids.length > 0 && (forceExpand || expanded.has(node.key));
      rows.push({
        node,
        level,
        hasChildren: kids.length > 0,
        expanded: open,
        posinset: index + 1,
        setsize: shown.length,
      });
      if (open) walk(node.children, level + 1);
    });
  };
  walk(top, 1);
  return rows;
}

export function rollup(node, results) {
  let count = 0;
  let worst = null;
  let worstRank = URGENCY.length;
  descendants(node).forEach((child) => {
    const result = results.get(child.key);
    if (!needsAction(result)) return;
    count += 1;
    const rank = urgencyRank(result);
    if (rank < worstRank) {
      worstRank = rank;
      worst = URGENCY[rank];
    }
  });
  return { needsAction: count, worst };
}

export function byUrgency(results) {
  return (first, second) => urgencyRank(results.get(first.key))
    - urgencyRank(results.get(second.key))
    || first.path.localeCompare(second.path);
}

export function attentionList(node, results) {
  return descendants(node)
    .filter((child) => needsAction(results.get(child.key)))
    .sort(byUrgency(results));
}

export function countPages(tree, results, kind = 'all') {
  const counts = {
    all: 0, source: 0, copies: 0, inherited: 0, independent: 0, needsAction: 0, loaded: 0,
  };
  tree.nodes.forEach((node) => {
    if (!matchesKind(node, kind)) return;
    const result = results.get(node.key);
    if (!result) return;
    counts.loaded += 1;
    if (needsAction(result)) counts.needsAction += 1;
    if (!isRealPage(result)) return;
    counts.all += 1;
    const group = typeGroup(result);
    if (group in counts) counts[group] += 1;
  });
  return counts;
}
