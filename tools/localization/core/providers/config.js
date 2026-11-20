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
import { listAll, requestFailed } from './da-admin.js';

const LOCATIONS_SHEET = 'locations';
const UNREADABLE = [401, 403];

export default function createConfigProvider({ org, api }) {
  async function read(site) {
    const response = await api.config.get({ org, site });
    if (response.status === 404) return [];
    if (UNREADABLE.includes(response.status)) return null;
    if (!response.ok) throw requestFailed(`Reading config for ${org}/${site}`, response);
    const config = await response.json();
    return config?.[LOCATIONS_SHEET]?.data ?? [];
  }

  async function write(site, rows) {
    const current = await api.config.get({ org, site });
    if (!current.ok && current.status !== 404) {
      throw requestFailed(`Reading config for ${org}/${site}`, current);
    }
    const existing = current.ok ? await current.json() : {};
    if (Array.isArray(existing.data)) {
      throw new Error(`The config of ${org}/${site} is a single sheet and cannot hold a locations sheet`);
    }
    const names = Object.keys(existing).filter((key) => !key.startsWith(':'));
    const config = {
      ...existing,
      ':version': existing[':version'] ?? 3,
      ':type': 'multi-sheet',
      ':names': [...new Set([...(existing[':names'] ?? names), LOCATIONS_SHEET])],
      [LOCATIONS_SHEET]: {
        ...existing[LOCATIONS_SHEET],
        total: rows.length,
        limit: rows.length,
        offset: 0,
        data: rows,
        ':type': 'sheet',
      },
    };
    const response = await api.config.save({ org, site, config });
    if (!response.ok) throw requestFailed(`Saving config for ${org}/${site}`, response);
  }

  async function listSites() {
    const items = await listAll(api, { org }, `Listing sites for ${org}`);
    return items.filter((item) => !item.ext).map((item) => item.name);
  }

  return { read, write, listSites };
}
