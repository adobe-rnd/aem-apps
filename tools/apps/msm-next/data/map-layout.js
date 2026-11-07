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
import { needsAction, typeGroup, levelLabel } from './display.js';

export const MAP_SIZES = {
  colWidth: 250,
  cardWidth: 200,
  cardHeight: 62,
  rowGap: 12,
  groupGap: 36,
  padding: 24,
  header: 0,
};

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2;
export const PAN_PADDING = 48;
export const MINIMAP = {
  width: 240, height: 140, minWidth: 160, minHeight: 90,
};

export const isIndependent = (node, results) => Boolean(node.parent)
  && typeGroup(results.get(node.key)) === 'independent';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function visibleChildren(node, keep) {
  return node.children.filter((child) => keep.has(child.key));
}

function keepSet(roots, results, { showIndependent, needsActionOnly }) {
  const keep = new Set();
  const visit = (node) => {
    if (!showIndependent && isIndependent(node, results)) return false;
    const kept = node.children.map(visit).some(Boolean);
    const own = !needsActionOnly || needsAction(results.get(node.key));
    if (own || kept) {
      keep.add(node.key);
      return true;
    }
    return false;
  };
  roots.forEach(visit);
  return keep;
}

export function isCollapsed(node, keep, { collapsed, expanded, collapseLocales }) {
  const kids = visibleChildren(node, keep);
  if (!kids.length) return false;
  if (collapsed?.has(node.key)) return true;
  if (expanded?.has(node.key)) return false;
  return Boolean(collapseLocales)
    && kids.every((child) => !visibleChildren(child, keep).length);
}

export function toggleCollapse({ collapsed, expanded }, key, currentlyCollapsed) {
  const nextCollapsed = new Set(collapsed);
  const nextExpanded = new Set(expanded);
  if (currentlyCollapsed) {
    nextCollapsed.delete(key);
    nextExpanded.add(key);
  } else {
    nextExpanded.delete(key);
    nextCollapsed.add(key);
  }
  return { collapsed: nextCollapsed, expanded: nextExpanded };
}

const edgePath = (from, to, sizes) => {
  const x1 = from.x + sizes.cardWidth;
  const y1 = from.y + sizes.cardHeight / 2;
  const x2 = to.x;
  const y2 = to.y + sizes.cardHeight / 2;
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
};

export function layoutMap(roots, results, options = {}) {
  const sizes = { ...MAP_SIZES, ...(options.sizes ?? {}) };
  const keep = keepSet(roots, results, options);
  const nodes = [];
  const byKey = new Map();
  const columns = new Map();
  let cursor = sizes.padding + sizes.header;

  const countHidden = (node) => visibleChildren(node, keep)
    .reduce((sum, child) => sum + 1 + countHidden(child), 0);

  const place = (node) => {
    const kids = visibleChildren(node, keep);
    const collapsed = isCollapsed(node, keep, options);
    const shown = collapsed ? [] : kids;
    const placedKids = shown.map(place);
    let y;
    if (placedKids.length) {
      y = (placedKids[0].y + placedKids[placedKids.length - 1].y) / 2;
    } else {
      y = cursor;
      cursor += sizes.cardHeight + sizes.rowGap;
    }
    const entry = {
      key: node.key,
      node,
      x: 0,
      y,
      depth: node.depth,
      hasChildren: kids.length > 0,
      collapsed,
      hidden: collapsed ? countHidden(node) : 0,
      independent: isIndependent(node, results),
    };
    nodes.push(entry);
    byKey.set(node.key, entry);
    entry.label = levelLabel(node.location, node.depth);
    const columnKey = `${node.depth}\u0000${entry.label}`;
    if (!columns.has(columnKey)) columns.set(columnKey, { depth: node.depth, label: entry.label });
    entry.column = columnKey;
    entry.placedKids = placedKids;
    return entry;
  };

  roots.filter((root) => keep.has(root.key)).forEach((root, index) => {
    if (index) cursor += sizes.groupGap - sizes.rowGap;
    place(root);
  });

  const ordered = [...columns.entries()]
    .sort(([, first], [, second]) => first.depth - second.depth)
    .map(([columnKey, column], index) => ({
      ...column, key: columnKey, x: sizes.padding + index * sizes.colWidth,
    }));
  const columnX = new Map(ordered.map((column) => [column.key, column.x]));
  nodes.forEach((entry) => { entry.x = columnX.get(entry.column); });
  const edges = [];
  nodes.forEach((entry) => {
    entry.placedKids.forEach((child) => {
      if (child.independent) return;
      edges.push({ from: entry.key, to: child.key, path: edgePath(entry, child, sizes) });
    });
  });

  const width = sizes.padding * 2 + Math.max(ordered.length - 1, 0) * sizes.colWidth
    + sizes.cardWidth;
  const height = Math.max(cursor - sizes.rowGap + sizes.padding, sizes.padding * 2);
  return {
    nodes,
    byKey,
    edges,
    columns: ordered.map(({ depth, x, label }) => ({ depth, x, label })),
    width,
    height,
    sizes,
  };
}

export function fitView(layout, viewport) {
  if (!viewport.width || !viewport.height) return { x: 0, y: 0, scale: 1 };
  const fit = Math.min(viewport.width / layout.width, viewport.height / layout.height);
  const scale = clamp(fit, MIN_SCALE, 1);
  return {
    x: Math.max(0, (viewport.width - layout.width * scale) / 2),
    y: 0,
    scale,
  };
}

export function fitWidth(layout, viewport) {
  if (!viewport.width) return { x: 0, y: 0, scale: 1 };
  const scale = clamp(viewport.width / layout.width, 0.5, 1);
  return { x: Math.max(0, (viewport.width - layout.width * scale) / 2), y: 0, scale };
}

export function zoomView(view, factor, center = { x: 0, y: 0 }) {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return {
    scale,
    x: center.x - (center.x - view.x) * ratio,
    y: center.y - (center.y - view.y) * ratio,
  };
}

export function centerOn(view, entry, viewport, sizes = MAP_SIZES) {
  return {
    ...view,
    x: viewport.width / 2 - (entry.x + sizes.cardWidth / 2) * view.scale,
    y: viewport.height / 2 - (entry.y + sizes.cardHeight / 2) * view.scale,
  };
}

const clampAxis = (offset, content, viewport, padding) => {
  const low = viewport - content - padding;
  const high = padding;
  return low > high ? clamp(offset, high, low) : clamp(offset, low, high);
};

export function clampView(view, layout, viewport, padding = PAN_PADDING) {
  if (!viewport.width || !viewport.height) return view;
  return {
    ...view,
    x: clampAxis(view.x, layout.width * view.scale, viewport.width, padding),
    y: clampAxis(view.y, layout.height * view.scale, viewport.height, padding),
  };
}

export function minimapGeometry(layout, box = MINIMAP) {
  const scale = Math.min(box.width / layout.width, box.height / layout.height);
  const contentWidth = layout.width * scale;
  const contentHeight = layout.height * scale;
  const width = Math.max(contentWidth, box.minWidth ?? 0);
  const height = Math.max(contentHeight, box.minHeight ?? 0);
  return {
    scale,
    width,
    height,
    offsetX: (width - contentWidth) / 2,
    offsetY: (height - contentHeight) / 2,
  };
}

export function minimapViewport(view, viewport, mini) {
  const ratio = mini.scale / view.scale;
  return {
    x: -view.x * ratio + (mini.offsetX ?? 0),
    y: -view.y * ratio + (mini.offsetY ?? 0),
    width: viewport.width * ratio,
    height: viewport.height * ratio,
  };
}

export function viewFromMinimap(point, view, viewport, mini) {
  const contentX = (point.x - (mini.offsetX ?? 0)) / mini.scale;
  const contentY = (point.y - (mini.offsetY ?? 0)) / mini.scale;
  return {
    ...view,
    x: viewport.width / 2 - contentX * view.scale,
    y: viewport.height / 2 - contentY * view.scale,
  };
}
