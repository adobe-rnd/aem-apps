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
import friendlyError from '../../../localization/core/friendly-error.js';
import createPool from './pool.js';
import { listLocationPages } from './listing.js';
import {
  treeRoots, treeLocations, buildPageTree, descendants,
} from './tree.js';

export default function createLoader({
  localization, list, site, concurrency = 8, onChange = () => {},
}) {
  const pool = createPool(concurrency);
  const results = new Map();
  const errors = new Map();
  const refreshing = new Set();
  let model = null;
  let tree = { top: [], nodes: new Map() };
  let generation = 0;
  let scheduled = null;

  const notify = () => {
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      onChange();
    }, 30);
  };

  const fetchStatus = (node, current) => pool.run(async () => {
    if (current !== generation) return;
    try {
      const result = await localization.page(node.site, node.path);
      if (current !== generation) return;
      results.set(node.key, result);
      errors.delete(node.key);
    } catch (error) {
      if (current !== generation) return;
      errors.set(node.key, friendlyError(error));
    } finally {
      refreshing.delete(node.key);
    }
    notify();
  });

  async function load() {
    generation += 1;
    const current = generation;
    pool.clear();
    results.clear();
    errors.clear();
    refreshing.clear();
    localization.refresh();
    model = await localization.orgModel();
    const roots = treeRoots(model, site);
    const locations = treeLocations(model, roots).map(({ location }) => location);
    const listed = await Promise.all(locations.map(async (location) => {
      try {
        return [location.id, await listLocationPages({
          list, model, location, run: pool.run,
        })];
      } catch {
        return [location.id, []];
      }
    }));
    if (current !== generation) return null;
    tree = buildPageTree({ model, roots, files: new Map(listed) });
    onChange();
    const ordered = [...tree.top, ...tree.top.flatMap((node) => descendants(node))];
    ordered.forEach((node) => fetchStatus(node, current));
    return tree;
  }

  async function refreshNodes(nodes) {
    localization.refresh({ publish: false });
    nodes.forEach((node) => {
      localization.invalidatePublishState?.(node.site, node.path);
      refreshing.add(node.key);
    });
    notify();
    await Promise.all(nodes.map((node) => fetchStatus(node, generation)));
  }

  const refreshSubtree = (node) => refreshNodes([node, ...descendants(node)]);

  return {
    load,
    refreshNodes,
    refreshSubtree,
    get idle() { return !pool.active && !pool.pending && !refreshing.size; },
    get model() { return model; },
    get tree() { return tree; },
    results,
    errors,
    refreshing,
  };
}
