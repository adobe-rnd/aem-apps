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
import { targetPages } from './resolve.js';

const pageKey = ({ site, path }) => `${site}:${path}`;

function withAncestors(model, targets) {
  if (!targets) return null;
  const selected = new Set();
  targets.forEach((id) => {
    let current = model.locations.get(id);
    while (current && !selected.has(current.id)) {
      selected.add(current.id);
      current = current.source ? model.locations.get(current.source) : null;
    }
  });
  return selected;
}

export default function planPropagation(model, { pages = [], targets } = {}) {
  const selected = withAncestors(model, targets);
  const seen = new Set(pages.map(pageKey));
  const items = [];

  const expand = (frontier, depth) => {
    if (!frontier.length) return;
    const next = [];
    frontier.forEach(({ ref, item: parent }) => {
      targetPages(model, ref.site, ref.path)
        .filter((target) => !selected || selected.has(target.location.id))
        .filter((target) => !seen.has(pageKey(target)))
        .forEach((target) => {
          seen.add(pageKey(target));
          const item = {
            key: pageKey(target),
            site: target.site,
            path: target.path,
            locationId: target.location.id,
            source: { site: ref.site, path: ref.path },
            parent: parent?.key ?? null,
            depth,
            state: 'pending',
          };
          items.push(item);
          next.push({ ref: target, item });
        });
    });
    expand(next, depth + 1);
  };

  expand(pages.map((page) => ({ ref: page, item: null })), 1);
  return { items };
}
