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

const DIFF_MARKERS = /<da-(diff|loc)-(added|deleted)[\s>/]|<[a-z][^<>]*\sda-diff-(added|deleted)[\s=>/]/i;

export default function createPageInfoProvider({ org, fetch, daOrigin }) {
  const sourceUrl = (site, path) => `${daOrigin}/source/${org}/${site}${path}`;

  async function get(site, path) {
    const response = await fetch(sourceUrl(site, path), { method: 'HEAD', cache: 'no-store' });
    if (response.status === 404) return { exists: false };
    if (!response.ok) throw requestFailed(`Reading ${org}/${site}${path}`, response);
    return {
      exists: true,
      id: response.headers.get('X-da-id'),
      version: response.headers.get('ETag'),
    };
  }

  async function needsReview(site, path) {
    const response = await fetch(sourceUrl(site, path), { cache: 'no-store' });
    if (response.status === 404) return false;
    if (!response.ok) throw requestFailed(`Reading ${org}/${site}${path}`, response);
    return DIFF_MARKERS.test(await response.text());
  }

  async function list(site, folder) {
    const folderPath = folder === '/' ? '' : folder;
    const sitePrefix = `/${org}/${site}`;
    const items = await listAll(
      fetch,
      `${daOrigin}/list/${org}/${site}${folderPath}`,
      `Listing ${org}/${site}${folderPath}`,
    );
    return items.map((item) => {
      const entry = { path: item.path.slice(sitePrefix.length), isFolder: !item.ext };
      if (item.lastModified !== undefined) entry.lastModified = item.lastModified;
      return entry;
    });
  }

  return { get, needsReview, list };
}
