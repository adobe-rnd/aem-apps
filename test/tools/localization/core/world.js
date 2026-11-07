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
  services: extraServices = {},
} = {}) {
  const files = new Map(Object.entries(pages));
  const index = new Map(Object.entries(indexes));
  const needsReview = new Set(review);
  let world;
  const calls = {
    merge: [], overwrite: [], remove: [], preview: [], publish: [],
  };
  let ids = 0;

  const copy = (operation) => async ({ source, target }) => {
    calls[operation].push(`${pageKey(source)}>${pageKey(target)}`);
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
  };
  const services = {
    content: {
      copyAvailable,
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
    ...extraServices,
  };
  const localization = createLocalization({ org: 'acme', providers, services });
  world = {
    localization, files, index, calls, needsReview, failIndex: false,
  };
  return world;
}
