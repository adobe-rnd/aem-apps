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
const DA_ORIGIN = 'https://admin.da.live';

function readSettings(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('DA returned invalid configuration.');
  }
  if (config.data === undefined) return null;
  const rows = Array.isArray(config.data) ? config.data : config.data?.data;
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('DA returned an invalid data sheet.');
  }
  const originRow = rows.find((row) => (row.key || row.Key) === 'workfront.origin');
  const proxyRow = rows.find((row) => (row.key || row.Key) === 'workfront.origin.proxy');
  if (!originRow && !proxyRow) return null;
  const workfrontOrigin = originRow?.value ?? originRow?.Value ?? '';
  const proxyOrigin = proxyRow?.value ?? proxyRow?.Value ?? '';
  if (typeof workfrontOrigin !== 'string' || !workfrontOrigin.trim()) {
    throw new Error('Set workfront.origin in the DA configuration data sheet.');
  }
  if (typeof proxyOrigin !== 'string') {
    throw new Error('Set workfront.origin.proxy to a URL or leave it blank for direct requests.');
  }
  return { workfrontOrigin: workfrontOrigin.trim(), proxyOrigin: proxyOrigin.trim() };
}

export default async function loadConfig(siteId, daFetch) {
  const segments = typeof siteId === 'string' ? siteId.split('/') : [];
  if (segments.length !== 2 || segments.some((segment) => !segment)) {
    throw new Error('A current DA organization and site are required to load Workfront settings.');
  }
  if (typeof daFetch !== 'function') {
    throw new Error('Experience Workspace did not provide authenticated DA configuration access.');
  }
  const [org, site] = segments.map((segment) => encodeURIComponent(segment));
  async function fetchSettings(scope) {
    let response;
    try {
      response = await daFetch(`${DA_ORIGIN}/config/${scope}/`, { cache: 'no-store' });
    } catch {
      throw new Error('DA configuration could not be reached. Check your connection and retry.');
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`DA configuration could not be loaded (HTTP ${response.status}). Check your config read permissions.`);
    }
    let config;
    try {
      config = await response.json();
    } catch {
      throw new Error('DA returned invalid configuration JSON.');
    }
    return readSettings(config);
  }
  const settings = await fetchSettings(`${org}/${site}`) || await fetchSettings(org);
  if (settings) return settings;
  throw new Error('Set workfront.origin in the site or organization DA configuration data sheet.');
}
