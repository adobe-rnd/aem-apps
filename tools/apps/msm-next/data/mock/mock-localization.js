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

export default function createMockLocalization({
  latency = true, translationDelay = 6000, org = MOCK_ORG,
} = {}) {
  const { files, indexes } = buildFixture();
  const published = new Map();
  const listeners = new Set();
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
    setTimeout(async () => {
      localization.refresh();
      const latest = await localization.page(page.site, page.path);
      await index.patch(latest.location.id, jobPatch(latest, page.path, { ...job, state: 'ready' }));
      localization.refresh();
      emit(page);
    }, translationDelay);
    return { ok: true, job };
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

  return {
    ...localization,
    execute,
    resolveReview,
    subscribe,
    list: pageInfo.list,
    publishState: (site, path) => published.get(key({ site, path })) ?? null,
    mock: true,
  };
}
