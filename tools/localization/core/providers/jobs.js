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

const FOLDER = '/.da/loc/jobs';

export default function createJobsProvider({ org, api }) {
  const target = (site, id) => ({ org, site, path: `${FOLDER}/${id}.json` });

  async function save(site, id, record) {
    const body = JSON.stringify(record);
    const response = await api.source.save({ ...target(site, id), body });
    if (!response.ok) throw requestFailed(`Saving translation job ${id}`, response);
  }

  async function read(site, id) {
    const response = await api.source.get(target(site, id));
    if (response.status === 404) return null;
    if (!response.ok) throw requestFailed(`Reading translation job ${id}`, response);
    return response.json();
  }

  return { save, read };
}
