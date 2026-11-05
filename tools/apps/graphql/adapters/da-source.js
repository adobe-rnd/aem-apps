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

const failure = (resp) => ({ error: 'Request failed.', status: resp?.status });
const done = (resp) => (resp?.ok ? { ok: true } : failure(resp));

// `{path}=read,write`: the actions allowed on the listed folder's content.
function permissionsOf(resp) {
  const actions = resp.headers.get('x-da-child-actions') ?? resp.headers.get('x-da-actions');
  return actions?.split('=').pop().split(',');
}

// The source bus lists `{ name, content-type }`, with folders as `name/`; DA lists
// `{ name, ext?, path }` already.
function fromSourceBus({ name: fileName, 'content-type': type }, folder) {
  const isFolder = fileName.endsWith('/') || type === 'application/folder';
  const name = fileName.replace(/\/$/, '');
  const path = `${folder}/${name}`;
  const dot = name.lastIndexOf('.');
  if (isFolder || dot <= 0) return { name, path };
  return { name: name.slice(0, dot), ext: name.slice(dot + 1), path };
}

/**
 * The core's store over DA and the AEM source bus.
 * @param {{ request: Function, locate: Function }} api from `createDaApi`
 */
// eslint-disable-next-line import/prefer-default-export
export function createDaStore(api) {
  async function listAll({ path, continuationToken, items = [] }) {
    const { hlx6, list: url } = await api.locate(path);
    const headers = continuationToken ? { 'da-continuation-token': continuationToken } : {};
    const resp = await api.request(url, { headers });
    const page = resp?.ok ? await resp.json().catch(() => undefined) : undefined;
    if (!Array.isArray(page)) return failure(resp);
    const listed = hlx6
      ? page.filter(({ name }) => name && !name.startsWith('.'))
        .map((item) => fromSourceBus(item, path))
      : page;
    const all = [...items, ...listed];
    const next = resp.headers.get('da-continuation-token');
    if (next) return listAll({ path, continuationToken: next, items: all });
    return { items: all, permissions: permissionsOf(resp) };
  }

  async function read({ path }) {
    const { source } = await api.locate(path);
    const resp = await api.request(source);
    const text = resp?.ok ? await resp.text().catch(() => undefined) : undefined;
    return text === undefined ? failure(resp) : { text };
  }

  // DA takes a form upload; the source bus takes the document itself.
  async function write({ path, text }) {
    const { hlx6, source } = await api.locate(path);
    if (hlx6) {
      const headers = { 'Content-Type': 'text/html' };
      return done(await api.request(source, { method: 'POST', headers, body: text }));
    }
    const body = new FormData();
    body.append('data', new Blob([text], { type: 'text/html' }));
    return done(await api.request(source, { method: 'POST', body }));
  }

  async function remove({ path }) {
    const { source } = await api.locate(path);
    return done(await api.request(source, { method: 'DELETE' }));
  }

  // AEM only publishes what is previewed.
  async function publish({ path }) {
    const { preview, live } = await api.locate(path);
    const previewed = done(await api.request(preview, { method: 'POST' }));
    return previewed.error ? previewed : done(await api.request(live, { method: 'POST' }));
  }

  // A document missing from live may still be previewed.
  async function unpublish({ path }) {
    const { preview, live } = await api.locate(path);
    const unpublished = done(await api.request(live, { method: 'DELETE' }));
    if (unpublished.error && unpublished.status !== 404) return unpublished;
    return done(await api.request(preview, { method: 'DELETE' }));
  }

  return {
    list: ({ path }) => listAll({ path }), read, write, remove, publish, unpublish,
  };
}
