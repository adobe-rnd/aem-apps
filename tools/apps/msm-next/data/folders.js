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

const segmentsOf = (path) => path.split('/').filter(Boolean);

export const folderPath = (pagePath) => segmentsOf(pagePath).slice(0, -1);

function compareSegments(first, second) {
  const length = Math.min(first.length, second.length);
  for (let i = 0; i < length; i += 1) {
    const order = first[i].localeCompare(second[i]);
    if (order) return order;
  }
  return first.length - second.length;
}

export function folderIndex(nodes) {
  const folders = new Map();
  nodes.forEach((node) => {
    const segments = folderPath(node.path);
    segments.forEach((name, index) => {
      const parts = segments.slice(0, index + 1);
      const path = `/${parts.join('/')}`;
      const key = `${node.site}:${path}`;
      if (!folders.has(key)) {
        folders.set(key, {
          key, site: node.site, path, name, depth: index, parts, keys: new Set(),
        });
      }
      folders.get(key).keys.add(node.key);
    });
  });
  return [...folders.values()].sort((a, b) => a.site.localeCompare(b.site)
    || compareSegments(a.parts, b.parts));
}

export function folderState(folder, picked) {
  let count = 0;
  folder.keys.forEach((key) => { if (picked.has(key)) count += 1; });
  if (count === 0) return 'none';
  return count === folder.keys.size ? 'all' : 'some';
}

export function setFolder(picked, folder, checked) {
  const next = new Set(picked);
  folder.keys.forEach((key) => {
    if (checked) next.add(key);
    else next.delete(key);
  });
  return next;
}

export const hasSeveralSites = (folders) => new Set(folders.map((folder) => folder.site)).size > 1;
