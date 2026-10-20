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

const ADMIN_API_BASE = 'https://admin.hlx.page';
const CUG_HEADERS = ['x-aem-cug-required', 'x-aem-cug-groups', 'x-aem-cug-login-path'];

export function transformToHeadersConfig(rows) {
  const config = {};
  rows.forEach((row) => {
    const path = (row.url || '').trim();
    if (!path || !path.startsWith('/') || config[path]) return;
    const headers = [];
    const required = String(row['cug-required'] ?? '').trim().toLowerCase();
    if (required === 'true' || required === 'false') {
      headers.push({ key: CUG_HEADERS[0], value: required });
    }
    const groups = (row['cug-groups'] || '').trim();
    if (groups) headers.push({ key: CUG_HEADERS[1], value: groups });
    const loginPath = (row['cug-login-path'] || '').trim();
    if (loginPath) headers.push({ key: CUG_HEADERS[2], value: loginPath });
    if (headers.length > 0) config[path] = headers;
  });
  return config;
}

export async function fetchExistingNonCugHeaders(org, site, request) {
  const response = await request(`${ADMIN_API_BASE}/config/${org}/aggregated/${site}.json`, { cache: 'no-store' });
  if (response.status === 404) return {};
  if (!response.ok) {
    throw new Error(`Failed to read site config (HTTP ${response.status}): ${await response.text()}`);
  }
  const config = await response.json();
  const filtered = {};
  Object.entries(config.headers || {}).forEach(([path, headers]) => {
    const nonCug = Array.isArray(headers)
      ? headers.filter((header) => !CUG_HEADERS.includes(header.key)) : [];
    if (nonCug.length > 0) filtered[path] = nonCug;
  });
  return filtered;
}

export async function postHeaders(org, site, headers, request) {
  // Config Service rejects an empty map; DELETE clears the headers instead.
  const empty = Object.keys(headers).length === 0;
  const method = empty ? 'DELETE' : 'POST';
  const response = await request(`${ADMIN_API_BASE}/config/${org}/sites/${site}/headers.json`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(empty ? {} : { body: JSON.stringify(headers) }),
  });
  if (!response.ok && !(empty && response.status === 404)) {
    throw new Error(`Config Service ${method} failed (HTTP ${response.status}): ${await response.text()}`);
  }
}

export async function applyCugHeaders(org, site, rows, request) {
  const cugHeaders = transformToHeadersConfig(rows);
  const merged = await fetchExistingNonCugHeaders(org, site, request);
  Object.entries(cugHeaders).forEach(([path, headers]) => {
    merged[path] = [...(merged[path] || []), ...headers];
  });
  await postHeaders(org, site, merged, request);
  return { cugPaths: Object.keys(cugHeaders).length, totalPaths: Object.keys(merged).length };
}
