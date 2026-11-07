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
import { childLocations } from './tree.js';
import { levelLabel } from './display.js';
import { levelKey, orderLevels } from './levels.js';

export const KIND_SECTIONS = [
  { kind: 'localization', label: 'Localization' },
  { kind: 'variation', label: 'Variations' },
];

export function locationDepth(model, location) {
  let depth = 0;
  let current = location;
  const seen = new Set();
  while (current?.source && model.locations.has(current.source) && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = model.locations.get(current.source);
  }
  return depth;
}

export function buildTargetTree(model, sourceLocationIds) {
  const children = childLocations(model);
  const nodes = new Map();
  const roots = [];
  const visit = (location, parentId) => {
    if (nodes.has(location.id)) return;
    const depth = locationDepth(model, location);
    const node = {
      id: location.id,
      location,
      depth,
      parentId,
      level: levelLabel(location, depth),
      children: [],
    };
    nodes.set(location.id, node);
    if (parentId) nodes.get(parentId).children.push(location.id);
    else roots.push(location.id);
    (children.get(location.id) ?? []).forEach((child) => visit(child, location.id));
  };
  const sources = [...new Set(sourceLocationIds)]
    .map((id) => model.locations.get(id))
    .filter(Boolean)
    .sort((first, second) => locationDepth(model, first) - locationDepth(model, second));
  sources.forEach((source) => {
    (children.get(source.id) ?? []).forEach((child) => visit(child, null));
  });
  return { nodes, roots };
}

export function descendantIds(tree, id) {
  const result = [];
  const walk = (current) => (tree.nodes.get(current)?.children ?? []).forEach((child) => {
    result.push(child);
    walk(child);
  });
  walk(id);
  return result;
}

export function ancestorIds(tree, id) {
  const result = [];
  let current = tree.nodes.get(id)?.parentId;
  while (current) {
    result.push(current);
    current = tree.nodes.get(current)?.parentId;
  }
  return result;
}

export function toggleTarget(tree, selected, id, checked) {
  const next = new Set(selected);
  [id, ...descendantIds(tree, id)].forEach((each) => {
    if (checked) next.add(each);
    else next.delete(each);
  });
  return next;
}

export function impliedIds(tree, selected) {
  const implied = new Set();
  selected.forEach((id) => ancestorIds(tree, id).forEach((ancestor) => {
    if (!selected.has(ancestor)) implied.add(ancestor);
  }));
  return implied;
}

export function effectiveTargets(tree, selected) {
  return new Set([...selected, ...impliedIds(tree, selected)]);
}

export function targetState(selected, implied, id) {
  if (selected.has(id)) return 'checked';
  if (implied.has(id)) return 'implied';
  return 'unchecked';
}

export function levelGroups(tree) {
  const rank = orderLevels([...tree.nodes.values()].map((node) => ({
    level: node.location?.level,
    depth: node.depth,
    parent: node.parentId ? tree.nodes.get(node.parentId)?.location?.level : null,
  })));
  const groupKey = (node) => (rank ? levelKey(node.level) : node.level);
  const groups = new Map();
  tree.nodes.forEach((node) => {
    const key = groupKey(node);
    if (!groups.has(key)) {
      groups.set(key, {
        label: node.level, depth: node.depth, maxDepth: node.depth, ids: [], key,
      });
    }
    const group = groups.get(key);
    group.depth = Math.min(group.depth, node.depth);
    group.maxDepth = Math.max(group.maxDepth, node.depth);
    group.ids.push(node.id);
  });
  const order = (group) => (rank ? rank.get(group.key) : 0);
  return [...groups.values()]
    .sort((first, second) => order(first) - order(second) || first.depth - second.depth
      || first.maxDepth - second.maxDepth)
    .map(({ key, ...group }) => group);
}

export function setMany(selected, ids, checked) {
  const next = new Set(selected);
  ids.forEach((id) => {
    if (checked) next.add(id);
    else next.delete(id);
  });
  return next;
}

export function groupState(selected, ids) {
  const count = ids.filter((id) => selected.has(id)).length;
  if (!count) return 'none';
  return count === ids.length ? 'all' : 'some';
}

export function matchesTarget(node, query) {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return true;
  const { location } = node;
  return [location.label, location.language, location.path, location.site, node.level]
    .some((value) => (value ?? '').toLowerCase().includes(needle));
}

export function filterTargets(tree, query) {
  if (!(query ?? '').trim()) return null;
  const visible = new Set();
  tree.nodes.forEach((node) => {
    if (!matchesTarget(node, query)) return;
    visible.add(node.id);
    ancestorIds(tree, node.id).forEach((id) => visible.add(id));
  });
  return visible;
}

const sectionOf = (node) => (node.location.kind === 'variation' ? 'variation' : 'localization');

export function kindSections(tree) {
  return KIND_SECTIONS.map(({ kind, label }) => {
    const roots = [];
    const children = new Map();
    tree.nodes.forEach((node) => {
      if (sectionOf(node) !== kind) return;
      const parent = ancestorIds(tree, node.id)
        .find((id) => sectionOf(tree.nodes.get(id)) === kind);
      if (!parent) {
        roots.push(node.id);
        return;
      }
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(node.id);
    });
    return {
      kind, label, roots, children,
    };
  }).filter((section) => section.roots.length);
}

export function flattenSection(section, visible = null) {
  const rows = [];
  const walk = (ids, indent) => ids.forEach((id) => {
    if (visible && !visible.has(id)) return;
    rows.push({ id, indent });
    walk(section.children.get(id) ?? [], indent + 1);
  });
  walk(section.roots, 0);
  return rows;
}
