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
export function toAemPath(path) {
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  if (path.endsWith('.html')) return path.slice(0, -'.html'.length);
  return path;
}

function toResult(operation, response) {
  if (response.ok) return { ok: true, status: response.status };
  const error = response.headers.get('x-error') ?? `${operation} failed with status ${response.status}`;
  return { ok: false, status: response.status, error };
}

const DEFAULT_CONCURRENCY = 4;

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length) return;
    const { task, resolve, reject } = queue.shift();
    active += 1;
    task().then(resolve, reject).finally(() => {
      active -= 1;
      next();
    });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

const PUBLISHED = { 200: true, 404: false };

const isPublished = (entry) => PUBLISHED[entry?.status] ?? null;

export default function createPublishService({ org, api, concurrency = DEFAULT_CONCURRENCY }) {
  const limit = createLimiter(concurrency);
  let states = new Map();
  const stateKey = ({ site, path }) => `${site}:${toAemPath(path)}`;

  async function fetchState(page) {
    try {
      const response = await api.aem.status?.({ org, site: page.site, path: toAemPath(page.path) });
      if (!response?.ok) return null;
      const data = await response.json();
      const live = isPublished(data?.live);
      const previewed = isPublished(data?.preview);
      return live === null ? null : { live, preview: previewed };
    } catch {
      return null;
    }
  }

  function state(page) {
    const key = stateKey(page);
    if (!states.has(key)) states.set(key, limit(() => fetchState(page)));
    return states.get(key);
  }

  const clear = () => { states = new Map(); };

  const aemTarget = ({ site, path }) => ({ org, site, path: toAemPath(path) });

  async function preview(page) {
    const result = toResult('preview', await api.aem.preview(aemTarget(page)));
    if (result.ok) states.delete(stateKey(page));
    return result;
  }

  async function publish(page) {
    const previewResult = await preview(page);
    if (!previewResult.ok) return previewResult;
    const result = toResult('publish', await api.aem.publish(aemTarget(page)));
    if (result.ok) states.delete(stateKey(page));
    return result;
  }

  return {
    preview, publish, state, clear,
  };
}
