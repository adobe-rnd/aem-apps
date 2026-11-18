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
import createLegacyApi, { DA_ORIGIN } from '../../localization/core/api/legacy.js';
import createPageInfoProvider from '../../localization/core/providers/page-info.js';
import { requestFailed } from '../../localization/core/providers/da-admin.js';
import {
  PROPOSALS_ROOT, parseProposal, recordPath, previewPath,
} from './model.js';

const noWeak = (etag) => etag?.replace(/^W\//, '') ?? null;

const versionEntry = (entry) => ({
  versionId: entry.versionId,
  url: entry.url,
  label: entry.label,
  createdAt: new Date(entry.timestamp).toISOString(),
});

export default function createStore({ org, site, fetch }) {
  const api = createLegacyApi({ fetch });
  const pageInfo = createPageInfoProvider({ org, api });
  const target = (path) => ({ org, site, path });

  async function readSource(path) {
    const response = await api.source.get(target(path));
    if (response.status === 404) return null;
    if (!response.ok) throw requestFailed(`Reading ${path}`, response);
    return { html: await response.text(), etag: noWeak(response.headers.get('etag')) };
  }

  async function writeSource(path, body, { ifMatch } = {}) {
    const headers = ifMatch ? { 'If-Match': ifMatch } : {};
    const response = await api.source.save({ ...target(path), body, headers });
    if (response.status === 412) {
      throw new Error(`${path} changed while it was being updated. Reload and try again.`);
    }
    if (!response.ok) throw requestFailed(`Writing ${path}`, response);
  }

  async function listVersions(path) {
    const response = await fetch(`${DA_ORIGIN}/versionlist/${org}/${site}${path}`, { cache: 'no-store' });
    if (response.status === 404) return [];
    if (!response.ok) throw requestFailed(`Listing versions of ${path}`, response);
    return (await response.json()).filter((entry) => entry.url).map(versionEntry);
  }

  async function readVersion(path, versionId) {
    const entries = await listVersions(path);
    const entry = entries.find((item) => item.versionId === versionId || item.url === versionId)
      ?? entries.find((item) => item.url.endsWith(`/${versionId}`));
    if (!entry) throw new Error(`Version ${versionId} of ${path} was not found.`);
    const response = await fetch(`${DA_ORIGIN}${entry.url}`, { cache: 'no-store' });
    if (!response.ok) throw requestFailed(`Reading version ${versionId} of ${path}`, response);
    return response.text();
  }

  async function createVersion(path, label) {
    const response = await fetch(`${DA_ORIGIN}/versionsource/${org}/${site}${path}`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
    if (!response.ok) throw requestFailed(`Saving a version of ${path}`, response);
  }

  async function listProposals() {
    let items;
    try {
      items = await pageInfo.list(site, PROPOSALS_ROOT);
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
    const folders = items.filter((item) => item.isFolder);
    const loaded = await Promise.all(folders.map(async (folder) => {
      const id = folder.path.slice(folder.path.lastIndexOf('/') + 1);
      const record = await readSource(recordPath(id)).catch(() => null);
      if (!record) return null;
      try {
        const raw = JSON.parse(record.html);
        const proposal = parseProposal(raw, id);
        return proposal ? { proposal, raw, etag: record.etag } : null;
      } catch {
        return null;
      }
    }));
    return loaded.filter(Boolean);
  }

  const saveRecord = (id, raw, etag) => writeSource(
    recordPath(id),
    JSON.stringify(raw, null, 2),
    { ifMatch: etag },
  );

  const savePreview = (id, targetPath, html) => writeSource(previewPath(id, targetPath), html);

  return {
    readSource,
    writeSource,
    readVersion,
    createVersion,
    listProposals,
    saveRecord,
    savePreview,
  };
}
