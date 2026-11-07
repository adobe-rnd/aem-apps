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
import { createLocalization } from '../../../../tools/localization/core/index.js';

const pageKey = ({ site, path }) => `${site}:${path}`;

function patchIndex(index, locationId, changes) {
  const current = index.get(locationId) ?? { pages: {}, pending: {} };
  const updated = { pages: { ...current.pages }, pending: { ...current.pending } };
  ['pages', 'pending'].forEach((section) => {
    Object.entries(changes[section] ?? {}).forEach(([entryKey, patch]) => {
      if (patch === null) {
        delete updated[section][entryKey];
        return;
      }
      const entry = { ...(updated[section][entryKey] ?? {}) };
      Object.entries(patch).forEach(([field, value]) => {
        if (value === null) delete entry[field];
        else entry[field] = value;
      });
      updated[section][entryKey] = entry;
    });
  });
  index.set(locationId, updated);
  return updated;
}

export function createTranslator() {
  const translator = {
    ready: false, failed: false, sendError: null, sent: [],
  };
  translator.connectors = {
    supports: async () => true,
    call: async (method, args) => {
      if (method === 'send') {
        translator.sent.push(structuredClone({ job: args.job, items: args.items }));
        if (translator.sendError) return { jobState: null, error: translator.sendError };
        const { dests } = args.job;
        return { jobState: { n: translator.sent.length, items: args.items, dests } };
      }
      if (method === 'getStatus') {
        const status = (translator.failed && 'failed') || (translator.ready ? 'translated' : 'in-progress');
        const langs = Object.fromEntries(args.jobState.dests.map((lang) => [lang, {
          status, done: translator.ready ? 1 : 0, total: 1,
        }]));
        return { jobState: args.jobState, langs };
      }
      if (method === 'getResults') {
        return {
          jobState: args.jobState,
          items: args.jobState.items.map((item) => ({ id: item.id, content: `[${args.lang}] ${item.content}` })),
        };
      }
      return { error: { code: 'unknown', message: method } };
    },
  };
  return translator;
}

export default function createWorld({
  configs,
  pages = {},
  indexes = {},
  failCopy = false,
  copyAvailable = true,
  loseWrites = false,
  review = [],
  reviewAfterMerge = [],
  runs = null,
  translator = null,
  services: extraServices = {},
} = {}) {
  const files = new Map(Object.entries(pages));
  const index = new Map(Object.entries(indexes));
  const needsReview = new Set(review);
  let world;
  const calls = {
    merge: [], overwrite: [], remove: [], preview: [], publish: [], content: [],
  };
  const jobs = new Map();
  let ids = 0;

  const copy = (operation) => async ({ source, target, content }) => {
    calls[operation].push(`${pageKey(source)}>${pageKey(target)}`);
    if (content !== undefined) calls.content.push(content);
    if (failCopy === true || (Array.isArray(failCopy) && failCopy.includes(pageKey(target)))) {
      return { ok: false, status: 500, error: 'boom' };
    }
    const existing = files.get(pageKey(target));
    ids += 1;
    files.set(pageKey(target), existing
      ? { ...existing, version: `${existing.version}+${operation}` }
      : { id: `new${ids}`, version: 'v1' });
    if (operation === 'merge' && existing && reviewAfterMerge.includes(pageKey(target))) {
      needsReview.add(pageKey(target));
    }
    if (loseWrites) files.delete(pageKey(target));
    return { ok: true, status: 200 };
  };

  const providers = {
    config: {
      read: async (site) => configs[site] ?? null,
      listSites: async () => Object.keys(configs),
    },
    pageInfo: {
      get: async (site, path) => {
        const file = files.get(`${site}:${path}`);
        return file ? { exists: true, id: file.id, version: file.version } : { exists: false };
      },
      needsReview: async (site, path) => needsReview.has(`${site}:${path}`),
    },
    index: {
      read: async (locationId) => index.get(locationId) ?? { pages: {}, pending: {} },
      patch: async (locationId, changes) => {
        if (world.failIndex) throw new Error('index down');
        return patchIndex(index, locationId, changes);
      },
    },
    runs,
    jobs: {
      save: async (site, id, record) => { jobs.set(`${site}:${id}`, structuredClone(record)); },
      read: async (site, id) => structuredClone(jobs.get(`${site}:${id}`) ?? null),
    },
  };
  const services = {
    content: {
      copyAvailable,
      read: async (page) => (files.has(pageKey(page)) ? `<main>${pageKey(page)}</main>` : null),
      merge: copy('merge'),
      overwrite: copy('overwrite'),
      remove: async (page) => {
        calls.remove.push(pageKey(page));
        files.delete(pageKey(page));
        return { ok: true, status: 204 };
      },
    },
    publish: {
      preview: async (page) => {
        calls.preview.push(pageKey(page));
        return { ok: true, status: 200 };
      },
      publish: async (page) => {
        calls.publish.push(pageKey(page));
        return { ok: true, status: 200 };
      },
    },
    ...(translator ? { translationConnectors: translator.connectors } : {}),
    ...extraServices,
  };
  const localization = createLocalization({ org: 'acme', providers, services });
  world = {
    localization, files, index, calls, needsReview, jobs, failIndex: false,
  };
  return world;
}
