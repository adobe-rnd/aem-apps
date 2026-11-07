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

export const PAGE_EXTENSIONS = ['html', 'json'];

const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const extOf = (path) => {
  const name = nameOf(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export const isDotPath = (path) => path.split('/').some((segment) => segment.startsWith('.'));

export function nestedLocationPaths(model, location) {
  const paths = new Set();
  model.locations.forEach((other) => {
    if (other.site === location.site && other.id !== location.id) paths.add(other.path);
  });
  return paths;
}

export async function listLocationPages({
  list, model, location, run = (task) => task(),
}) {
  const nested = nestedLocationPaths(model, location);
  const pages = [];
  const walk = async (folder) => {
    const items = await run(() => list(location.site, folder));
    const folders = [];
    items.forEach((item) => {
      if (isDotPath(item.path)) return;
      if (item.isFolder) {
        if (!nested.has(item.path)) folders.push(item.path);
        return;
      }
      if (PAGE_EXTENSIONS.includes(extOf(item.path))) pages.push(item.path);
    });
    await Promise.all(folders.map(walk));
  };
  await walk(location.path);
  return pages.sort();
}
