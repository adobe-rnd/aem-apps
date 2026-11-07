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

const DIFF_SELECTOR = [
  'da-diff-added',
  'da-diff-deleted',
  'da-loc-added',
  'da-loc-deleted',
  '[da-diff-added]',
  '[da-diff-deleted]',
].join(', ');

const ID_HEADERS = ['X-da-id', 'doc-id'];

const browserParseHtml = (text) => new DOMParser().parseFromString(text, 'text/html');

export default function createPageInfoProvider({ org, api, parseHtml = browserParseHtml }) {
  async function get(site, path) {
    const response = await api.source.getMetadata({ org, site, path });
    if (response.status === 404) return { exists: false };
    if (!response.ok) throw requestFailed(`Reading ${org}/${site}${path}`, response);
    const id = ID_HEADERS.map((header) => response.headers.get(header)).find(Boolean) ?? null;
    return {
      exists: true,
      id,
      version: response.headers.get('ETag') ?? response.headers.get('Last-Modified'),
    };
  }

  async function needsReview(site, path) {
    const response = await api.source.get({ org, site, path });
    if (response.status === 404) return false;
    if (!response.ok) throw requestFailed(`Reading ${org}/${site}${path}`, response);
    const html = parseHtml(await response.text());
    return html.querySelector(DIFF_SELECTOR) !== null;
  }

  async function list(site, folder) {
    const sitePrefix = `/${org}/${site}`;
    const items = await listAll(
      api,
      { org, site, path: folder },
      `Listing ${org}/${site}${folder}`,
    );
    return items.map((item) => {
      const entry = { path: item.path.slice(sitePrefix.length), isFolder: !item.ext };
      if (item.lastModified !== undefined) entry.lastModified = item.lastModified;
      return entry;
    });
  }

  return { get, needsReview, list };
}
