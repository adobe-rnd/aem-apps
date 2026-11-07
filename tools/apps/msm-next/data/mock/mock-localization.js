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
import { createLocalization } from '../../../../localization/core/index.js';
import createRunner from '../../../../localization/core/runs.js';
import { createRunStore, buildSeedRun } from './mock-runs.js';
import {
  buildFixture, CONFIGS, HIDDEN_PATHS, MOCK_ORG,
} from './fixture.js';

const SECTIONS = ['pages', 'pending'];

export function applyIndexChanges(index, changes, merge) {
  const updated = { pages: { ...index.pages }, pending: { ...index.pending } };
  SECTIONS.forEach((section) => {
    Object.entries(changes?.[section] ?? {}).forEach(([entryKey, change]) => {
      if (change === null) {
        delete updated[section][entryKey];
        return;
      }
      if (!merge) {
        updated[section][entryKey] = change;
        return;
      }
      const entry = { ...(updated[section][entryKey] ?? {}) };
      Object.entries(change).forEach(([field, value]) => {
        if (value === null) delete entry[field];
        else entry[field] = value;
      });
      updated[section][entryKey] = entry;
    });
  });
  return updated;
}

export function listFolder(paths, site, folder) {
  const prefix = folder === '/' ? '/' : `${folder}/`;
  const seen = new Set();
  const items = [];
  paths.forEach((full) => {
    const separator = full.indexOf(':');
    if (full.slice(0, separator) !== site) return;
    const path = full.slice(separator + 1);
    if (!path.startsWith(prefix)) return;
    const [segment, ...rest] = path.slice(prefix.length).split('/');
    const childPath = `${prefix}${segment}`;
    if (seen.has(childPath)) return;
    seen.add(childPath);
    items.push({ path: childPath, isFolder: rest.length > 0 });
  });
  return items;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

export const FLAKY_PREFIX = 'gamebox-retail:/arcade-avenue/';
export const JOB_STEPS = 4;

export default function createMockLocalization({
  latency = true, translationDelay = 6000, org = MOCK_ORG, flaky = true, seedRuns = true,
} = {}) {
  const { files, indexes } = buildFixture();
  const published = new Map();
  const listeners = new Set();
  const jobClock = new Map();
  const flakyFailed = new Set();
  let seq = 1000;
  const next = () => {
    seq += 1;
    return seq;
  };
  const wait = () => (latency
    ? new Promise((resolve) => { setTimeout(resolve, 10 + Math.random() * 60); })
    : Promise.resolve());
  const key = ({ site, path }) => `${site}:${path}`;
  const emit = (page) => listeners.forEach((listener) => listener(page));
  const readIndex = (id) => clone(indexes.get(id) ?? { pages: {}, pending: {} });

  const config = {
    listSites: async () => {
      await wait();
      return Object.keys(CONFIGS);
    },
    read: async (site) => {
      await wait();
      return clone(CONFIGS[site] ?? []);
    },
  };

  const pageInfo = {
    get: async (site, path) => {
      await wait();
      const file = files.get(key({ site, path }));
      return file ? { exists: true, id: file.id, version: file.version } : { exists: false };
    },
    needsReview: async (site, path) => {
      await wait();
      return Boolean(files.get(key({ site, path }))?.needsReview);
    },
    list: async (site, folder) => {
      await wait();
      return listFolder([...files.keys(), ...HIDDEN_PATHS], site, folder);
    },
  };

  const updateIndex = async (id, changes, merge) => {
    await wait();
    const updated = applyIndexChanges(readIndex(id), changes, merge);
    indexes.set(id, updated);
    return clone(updated);
  };

  const index = {
    read: async (id) => {
      await wait();
      return readIndex(id);
    },
    write: (id, changes) => updateIndex(id, changes, false),
    patch: (id, changes) => updateIndex(id, changes, true),
  };

  const writeFile = (target, { merge }) => {
    const existing = files.get(key(target));
    const number = next();
    const review = Boolean(merge && existing?.edited);
    files.set(key(target), {
      id: existing?.id ?? `mock-id-${number}`,
      version: `"mock-v${number}"`,
      edited: review,
      needsReview: review,
    });
  };

  const copy = (merge) => async ({ source, target }) => {
    await wait();
    if (!files.has(key(source))) return { ok: false, status: 404, error: 'Source page not found' };
    if (flaky && key(target).startsWith(FLAKY_PREFIX) && !flakyFailed.has(key(target))) {
      flakyFailed.add(key(target));
      return { ok: false, status: 503, error: 'Copy service timed out' };
    }
    writeFile(target, { merge });
    return { ok: true, status: 200 };
  };

  const content = {
    copyAvailable: true,
    read: async (page) => {
      await wait();
      return files.has(key(page)) ? `<body><main><div><h1>${page.path}</h1></div></main></body>` : null;
    },
    merge: copy(true),
    overwrite: copy(false),
    remove: async (page) => {
      await wait();
      const ok = files.delete(key(page));
      return { ok, status: ok ? 204 : 404 };
    },
  };

  const publishService = {
    preview: async (page) => {
      await wait();
      if (!published.has(key(page))) published.set(key(page), 'preview');
      return { ok: true, status: 200 };
    },
    publish: async (page) => {
      await wait();
      published.set(key(page), 'live');
      return { ok: true, status: 200 };
    },
  };

  const translationConnectors = { supports: async () => true };

  const localization = createLocalization({
    org,
    providers: { config, pageInfo, index },
    services: { content, publish: publishService, translationConnectors },
  });

  const jobPatch = (current, path, job) => {
    const { info } = current.chain[0];
    if (info.exists) return { pages: { [info.id]: { job } } };
    return { pending: { [path]: { job } } };
  };

  async function translate(current, page) {
    const job = { state: 'translating', id: `mock-job-${next()}`, at: new Date().toISOString() };
    await index.patch(current.location.id, jobPatch(current, page.path, job));
    jobClock.set(key(page), Date.now());
    return { ok: true, job };
  }

  async function checkJob(page) {
    const current = await localization.page(page.site, page.path);
    const job = current.chain[0]?.info?.job;
    if (!job) return { ...page, state: 'none' };
    const total = JOB_STEPS;
    if (job.state === 'ready') return { ...page, state: 'ready', progress: { done: total, total } };
    if (!jobClock.has(key(page))) jobClock.set(key(page), Date.now());
    const elapsed = Date.now() - jobClock.get(key(page));
    if (elapsed < translationDelay) {
      const done = Math.min(total - 1, Math.floor((elapsed / translationDelay) * total));
      return { ...page, state: 'translating', progress: { done, total } };
    }
    await index.patch(current.location.id, jobPatch(current, page.path, { ...job, state: 'ready' }));
    emit(page);
    return { ...page, state: 'ready', progress: { done: total, total } };
  }

  async function checkJobs(pages) {
    localization.refresh();
    const results = await Promise.all(pages.map((page) => checkJob(page)
      .catch((error) => ({ ...page, state: 'error', error: error.message }))));
    localization.refresh();
    return results;
  }

  async function save(current, page, option) {
    const source = current.status.effectiveSource;
    const sourceFile = source && files.get(key(source));
    if (!sourceFile) return { ok: false, error: 'no-source' };
    writeFile(page, { merge: option !== 'overwrite' });
    const written = files.get(key(page));
    const changes = {
      pages: {
        [written.id]: {
          base: {
            sourceId: sourceFile.id,
            sourceVersion: sourceFile.version,
            via: 'translate',
            targetVersion: written.version,
            at: new Date().toISOString(),
          },
          job: null,
        },
      },
      pending: { [page.path]: null },
    };
    await index.patch(current.location.id, changes);
    jobClock.delete(key(page));
    return { ok: true };
  }

  const LOCAL = { translate, save };

  async function execute(request) {
    const handler = LOCAL[request.action];
    if (!handler) return localization.execute(request);
    localization.refresh();
    const current = await localization.page(request.site, request.path);
    const entry = current.actions.find((each) => each.action === request.action);
    if (!entry) return { ok: false, error: 'action-unavailable', reasons: [] };
    if (!entry.enabled) return { ok: false, error: 'action-disabled', reasons: entry.reasons };
    try {
      return await handler(current, { site: request.site, path: request.path }, request.option);
    } finally {
      localization.refresh();
    }
  }

  async function resolveReview(site, path) {
    await wait();
    const file = files.get(key({ site, path }));
    if (!file) return { ok: false, error: 'not-found' };
    files.set(key({ site, path }), {
      ...file, needsReview: false, edited: true, version: `"mock-v${next()}"`,
    });
    localization.refresh();
    return { ok: true };
  }

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const runs = createRunStore({
    wait,
    seed: seedRuns
      ? () => buildSeedRun({ orgModel: localization.orgModel, page: localization.page })
      : null,
  });
  const runner = createRunner({
    page: localization.page,
    execute,
    checkJobs,
    orgModel: localization.orgModel,
    refresh: localization.refresh,
    runs,
  });

  const CANCELLABLE = ['pending', 'blocked', 'translating', 'awaiting translation'];
  const ACTIVE = ['pending', 'running', 'translating', 'awaiting translation'];
  const summarize = (items) => items.reduce((summary, item) => ({
    ...summary, [item.state]: (summary[item.state] ?? 0) + 1,
  }), { total: items.length });

  async function clearJob(item) {
    const current = await localization.page(item.site, item.path);
    const { info } = current.chain[0];
    if (!info?.job) return;
    const changes = info.exists
      ? { pages: { [info.id]: { job: null } } }
      : { pending: { [item.path]: null } };
    await index.patch(current.location.id, changes);
    jobClock.delete(key(item));
  }

  async function cancelRun(run, { onProgress } = {}) {
    const cancelling = run.items.filter((item) => CANCELLABLE.includes(item.state));
    await Promise.all(cancelling.filter((item) => ['translating', 'awaiting translation'].includes(item.state))
      .map((item) => clearJob(item)));
    const at = new Date().toISOString();
    cancelling.forEach((item) => Object.assign(item, {
      state: 'cancelled', reasons: [], at,
    }));
    Object.assign(run, { cancelledAt: at, updatedAt: at, summary: summarize(run.items) });
    await runs.save(run);
    localization.refresh();
    onProgress?.(run);
    return run;
  }

  async function archiveRun(run, archived = true) {
    if (archived && run.items.some((item) => ACTIVE.includes(item.state))) {
      return { ok: false, error: 'run-active' };
    }
    if (archived) Object.assign(run, { archivedAt: new Date().toISOString() });
    else delete run.archivedAt;
    await runs.save(run);
    return run;
  }

  return {
    ...localization,
    execute,
    checkJobs,
    cancelRun,
    archiveRun,
    propagate: runner.propagate,
    retryRun: runner.retryRun,
    resumeRun: runner.resumeRun,
    runs,
    resolveReview,
    subscribe,
    list: pageInfo.list,
    publishState: (site, path) => published.get(key({ site, path })) ?? null,
    mock: true,
  };
}
