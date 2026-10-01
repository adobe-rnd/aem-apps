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
// An in-memory store port; `fail({ method, path })` returns a status to fail a call with.

const failure = (status) => ({ error: 'Request failed.', status });

const toItem = ({ path, folder }) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (folder || dot <= 0) return { name, path };
  return { name: name.slice(0, dot), ext: name.slice(dot + 1), path };
};

// eslint-disable-next-line import/prefer-default-export
export function createMemoryStore({ files = {}, permissions, fail } = {}) {
  const docs = new Map(Object.entries(files));
  const calls = [];
  const attempt = (method, path, run) => {
    calls.push({ method, path });
    const status = fail?.({ method, path });
    return Promise.resolve(status ? failure(status) : run());
  };
  const children = (path) => {
    const prefix = `${path}/`;
    const items = new Map();
    [...docs.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => {
      const [child, ...rest] = key.slice(prefix.length).split('/');
      const childPath = `${prefix}${child}`;
      if (items.has(childPath)) return;
      items.set(childPath, toItem({ path: childPath, folder: rest.length > 0 }));
    });
    return [...items.values()];
  };
  return {
    docs,
    calls,
    list: ({ path }) => attempt('list', path, () => ({ items: children(path), permissions })),
    read: ({ path }) => attempt('read', path, () => (docs.has(path) ? { text: docs.get(path) } : failure(404))),
    write: ({ path, text }) => attempt('write', path, () => {
      docs.set(path, text);
      return { ok: true };
    }),
    remove: ({ path }) => attempt('remove', path, () => (docs.delete(path) ? { ok: true } : failure(404))),
  };
}
