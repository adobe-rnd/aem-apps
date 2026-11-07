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
import { requestFailed } from './da-admin.js';

const SECTIONS = ['pages', 'pending'];
const CONFLICT = 412;

const emptyIndex = () => ({ pages: {}, pending: {} });

const normalize = (content) => ({
  pages: content?.pages ?? {},
  pending: content?.pending ?? {},
});

function applyChanges(index, changes) {
  const updated = { pages: { ...index.pages }, pending: { ...index.pending } };
  SECTIONS.forEach((section) => {
    Object.entries(changes?.[section] ?? {}).forEach(([key, entry]) => {
      if (entry === null) delete updated[section][key];
      else updated[section][key] = entry;
    });
  });
  return updated;
}

function patchChanges(index, changes) {
  const updated = { pages: { ...index.pages }, pending: { ...index.pending } };
  SECTIONS.forEach((section) => {
    Object.entries(changes?.[section] ?? {}).forEach(([key, patch]) => {
      if (patch === null) {
        delete updated[section][key];
        return;
      }
      const entry = { ...(updated[section][key] ?? {}) };
      Object.entries(patch).forEach(([field, value]) => {
        if (value === null) delete entry[field];
        else entry[field] = value;
      });
      updated[section][key] = entry;
    });
  });
  return updated;
}

export default function createLocIndexProvider({ org, api, maxAttempts = 3 }) {
  const indexTarget = (locationId) => {
    const separator = locationId.indexOf(':');
    const site = locationId.slice(0, separator);
    const path = locationId.slice(separator + 1);
    const folder = path === '/' ? '' : path;
    return { org, site, path: `/.da/loc${folder}/index.json` };
  };

  async function readWithEtag(locationId) {
    const response = await api.source.get(indexTarget(locationId));
    if (response.status === 404) return { index: emptyIndex(), etag: null };
    if (!response.ok) throw requestFailed(`Reading localization index for ${locationId}`, response);
    return { index: normalize(await response.json()), etag: response.headers.get('ETag') };
  }

  async function read(locationId) {
    return (await readWithEtag(locationId)).index;
  }

  async function write(locationId, changes, apply = applyChanges, attempt = 1) {
    const { index, etag } = await readWithEtag(locationId);
    const updated = apply(index, changes);
    const headers = etag ? { 'If-Match': etag } : { 'If-None-Match': '*' };
    const response = await api.source.save({
      ...indexTarget(locationId), body: JSON.stringify(updated), headers,
    });
    if (response.status === CONFLICT) {
      if (attempt >= maxAttempts) {
        throw new Error(`Localization index for ${locationId} kept changing (conflict after ${attempt} attempts)`);
      }
      return write(locationId, changes, apply, attempt + 1);
    }
    if (!response.ok) throw requestFailed(`Writing localization index for ${locationId}`, response);
    return updated;
  }

  return {
    read,
    write: (locationId, changes) => write(locationId, changes),
    patch: (locationId, changes) => write(locationId, changes, patchChanges),
  };
}
