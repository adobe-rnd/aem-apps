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

const FOLDER = '/.da/loc/runs';

export default function createRunsProvider({ org, api }) {
  const target = (site, id) => ({ org, site, path: `${FOLDER}/${id}.json` });

  async function save(run) {
    const body = JSON.stringify(run);
    const response = await api.source.save({ ...target(run.site, run.id), body });
    if (!response.ok) throw requestFailed(`Saving run ${run.id}`, response);
    return run;
  }

  async function read(site, id) {
    const response = await api.source.get(target(site, id));
    if (response.status === 404) return null;
    if (!response.ok) throw requestFailed(`Reading run ${id}`, response);
    return response.json();
  }

  async function list(site) {
    const items = await listAll(api, { org, site, path: FOLDER }, `Listing runs for ${org}/${site}`)
      .catch(() => []);
    return items
      .filter((item) => item.ext === 'json')
      .map((item) => ({ id: item.name, lastModified: item.lastModified }))
      .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
  }

  return { save, read, list };
}
