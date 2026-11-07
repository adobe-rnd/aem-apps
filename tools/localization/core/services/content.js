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
import { requestFailed } from '../providers/da-admin.js';

const COPY_ENGINE_MISSING = 'Localization copy engine (actions.loc) is unavailable';

export default function createContentService({ org, api, loc }) {
  const daPath = ({ site, path }) => `/${org}/${site}${path}`;

  async function read({ site, path }) {
    const response = await api.source.get({ org, site, path });
    if (response.status === 404) return null;
    if (!response.ok) throw requestFailed(`Reading ${org}/${site}${path}`, response);
    return response.text();
  }

  function copy(operation, {
    source, target, label, content,
  }) {
    if (!loc?.[operation]) return { ok: false, error: COPY_ENGINE_MISSING };
    const options = { urlSource: daPath(source), urlTarget: daPath(target), msg: label };
    if (content !== undefined) options.sourceContent = content;
    return loc[operation](options);
  }

  const merge = async (request) => copy('mergeCopy', request);
  const overwrite = async (request) => copy('overwriteCopy', request);

  async function remove({ site, path }) {
    const response = await api.source.delete({ org, site, path });
    return { ok: response.ok, status: response.status };
  }

  return {
    copyAvailable: Boolean(loc), read, merge, overwrite, remove,
  };
}
