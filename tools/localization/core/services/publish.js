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

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MIN_INTERVAL = 150;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF = 400;

const DEFAULT_BULK_CHUNK = 100;
const DEFAULT_POLL_INTERVAL = 1000;
const DEFAULT_MAX_POLLS = 20;
const MAX_POLL_STEPS = 3;
const SETTLED_JOBS = ['stopped', 'completed'];
const SELECT = ['preview', 'live'];

const NO_RETRY = [401, 403];

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function createLimiter(limit, minInterval) {
  let active = 0;
  let lastStart = -Infinity;
  let timer = null;
  const queue = [];
  const next = () => {
    if (active >= limit || !queue.length || timer) return;
    const wait = lastStart + minInterval - Date.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        next();
      }, wait);
      return;
    }
    const { task, resolve, reject } = queue.shift();
    active += 1;
    lastStart = Date.now();
    task().then(resolve, reject).finally(() => {
      active -= 1;
      next();
    });
    next();
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

const PUBLISHED = { 200: true, 404: false };

const isPublished = (entry) => PUBLISHED[entry?.status] ?? null;

const flag = (info, lastModified) => {
  if (info && typeof info === 'object') return isPublished(info) ?? Boolean(info.lastModified);
  return Boolean(lastModified);
};

const entryState = (entry) => ({
  live: flag(entry.live, entry.publishLastModified),
  preview: flag(entry.preview, entry.previewLastModified),
});

const resourcesOf = (job) => (Array.isArray(job?.data?.resources) ? job.data.resources : null);

const pathVariants = (path) => {
  if (!path.endsWith('/')) return [path, `${path}/`];
  return [path, path.slice(0, -1) || '/', `${path}index`];
};

const lookup = (entries, path) => {
  const key = pathVariants(path).find((variant) => entries.has(variant));
  return key === undefined ? null : entryState(entries.get(key));
};

const httpError = (status) => Object.assign(new Error(`status ${status}`), { status });

const chunksOf = (list, size) => {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
};

export default function createPublishService({
  org,
  api,
  concurrency = DEFAULT_CONCURRENCY,
  minInterval = DEFAULT_MIN_INTERVAL,
  retries = DEFAULT_RETRIES,
  backoff = DEFAULT_BACKOFF,
  bulkChunk = DEFAULT_BULK_CHUNK,
  pollInterval = DEFAULT_POLL_INTERVAL,
  maxPolls = DEFAULT_MAX_POLLS,
}) {
  const limit = createLimiter(concurrency, minInterval);
  let states = new Map();
  const stateKey = ({ site, path }) => `${site}:${toAemPath(path)}`;

  async function attempt(page) {
    try {
      const response = await api.aem.status?.({ org, site: page.site, path: toAemPath(page.path) });
      if (!response?.ok) return { retry: !NO_RETRY.includes(response?.status), value: null };
      const data = await response.json();
      const live = isPublished(data?.live);
      const previewed = isPublished(data?.preview);
      return { retry: false, value: live === null ? null : { live, preview: previewed } };
    } catch {
      return { retry: true, value: null };
    }
  }

  async function fetchState(page, remaining = retries) {
    if (!api.aem.status) return null;
    const result = await limit(() => attempt(page));
    if (!result.retry || remaining <= 0) return result.value;
    await sleep(backoff * 2 ** (retries - remaining));
    return fetchState(page, remaining - 1);
  }

  function state(page) {
    const key = stateKey(page);
    if (!states.has(key)) states.set(key, fetchState(page));
    return states.get(key);
  }

  const call = async (request) => {
    const response = await limit(request);
    if (!response?.ok) throw httpError(response?.status);
    return response.json();
  };

  async function settle(target, job, poll = 0) {
    if (resourcesOf(job) || SETTLED_JOBS.includes(job?.state)) return job;
    if (!job?.name || poll >= maxPolls) throw new Error('bulk status job did not finish');
    await sleep(pollInterval * Math.min(poll + 1, MAX_POLL_STEPS));
    const next = await call(() => api.aem.job({ ...target, topic: 'status', name: job.name }));
    return settle(target, next, poll + 1);
  }

  async function bulkEntries(site, paths) {
    const target = { org, site };
    const started = await call(() => api.aem.bulkStatus({ ...target, paths, select: SELECT }));
    const job = await settle(target, started?.job);
    let resources = resourcesOf(job);
    if (!resources) {
      const details = await call(() => api.aem.job({
        ...target, topic: 'status', name: job.name, details: true,
      }));
      resources = resourcesOf(details);
    }
    if (!resources) throw new Error('bulk status job returned no resources');
    return new Map(resources.filter((entry) => entry?.path).map((entry) => [entry.path, entry]));
  }

  async function bulkChunkResult(site, pages) {
    try {
      return { entries: await bulkEntries(site, pages.map((page) => toAemPath(page.path))) };
    } catch (error) {
      return NO_RETRY.includes(error?.status) ? { denied: true } : { failed: true };
    }
  }

  function trackChunk(site, pages) {
    const result = bulkChunkResult(site, pages);
    pages.forEach((page) => {
      states.set(stateKey(page), result.then((outcome) => {
        if (outcome.failed) return fetchState(page);
        if (outcome.denied) return null;
        return lookup(outcome.entries, toAemPath(page.path));
      }));
    });
  }

  function stateMany(pages) {
    if (!api.aem.bulkStatus || !api.aem.job) return Promise.all(pages.map(state));
    const fresh = new Map();
    pages.forEach((page) => {
      const key = stateKey(page);
      if (!states.has(key) && !fresh.has(key)) fresh.set(key, page);
    });
    const bySite = new Map();
    [...fresh.values()].forEach((page) => {
      bySite.set(page.site, [...(bySite.get(page.site) ?? []), page]);
    });
    bySite.forEach((sitePages, site) => {
      chunksOf(sitePages, bulkChunk).forEach((chunk) => trackChunk(site, chunk));
    });
    return Promise.all(pages.map(state));
  }

  const invalidate = (page) => { states.delete(stateKey(page)); };

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
    preview, publish, state, stateMany, clear, invalidate,
  };
}
