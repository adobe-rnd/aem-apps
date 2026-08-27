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
/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const DA_SOURCE_BASE = 'https://admin.da.live/source';
const ADMIN_API_BASE = 'https://admin.hlx.page';
const CUG_SHEET_PATH = 'closed-user-groups.json';
const HEADER_CUG_REQUIRED = 'x-aem-cug-required';
const HEADER_CUG_GROUPS = 'x-aem-cug-groups';
const HEADER_CUG_LOGIN_PATH = 'x-aem-cug-login-path';

function isCugHeader(key) {
  return key === HEADER_CUG_REQUIRED || key === HEADER_CUG_GROUPS || key === HEADER_CUG_LOGIN_PATH;
}

async function fetchCugSheet(org, site, token) {
  const url = `${DA_SOURCE_BASE}/${org}/${site}/${CUG_SHEET_PATH}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch CUG sheet: ${resp.status} ${resp.statusText}`);
  }

  const json = await resp.json();
  return Array.isArray(json.data) ? json.data : [];
}

function transformToHeadersConfig(rows) {
  const config = {};

  rows.forEach((row) => {
    const path = (row.url || '').trim();
    if (!path || !path.startsWith('/') || config[path]) return;

    const headers = [];
    const required = (row['cug-required'] || '').trim().toLowerCase();
    if (required === 'true' || required === 'false') {
      headers.push({ key: HEADER_CUG_REQUIRED, value: required });
    }

    const groups = (row['cug-groups'] || '').trim();
    if (groups) {
      headers.push({ key: HEADER_CUG_GROUPS, value: groups });
    }

    const loginPath = (row['cug-login-path'] || '').trim();
    if (loginPath) {
      headers.push({ key: HEADER_CUG_LOGIN_PATH, value: loginPath });
    }

    if (headers.length > 0) {
      config[path] = headers;
    }
  });

  return config;
}

async function fetchExistingNonCugHeaders(org, site, token) {
  const url = `${ADMIN_API_BASE}/config/${org}/aggregated/${site}.json`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    if (resp.status === 404) return {};
    const body = await resp.text().catch(() => '');
    throw new Error(`Failed to read site config: ${resp.status} ${resp.statusText} ${body}`);
  }

  const config = await resp.json();
  const existing = config.headers || {};
  const filtered = {};

  Object.entries(existing).forEach(([path, headerList]) => {
    const nonCug = Array.isArray(headerList)
      ? headerList.filter((h) => !isCugHeader(h.key))
      : [];
    if (nonCug.length > 0) {
      filtered[path] = nonCug;
    }
  });

  return filtered;
}

function mergeHeaders(nonCugHeaders, cugHeaders) {
  const merged = { ...nonCugHeaders };

  Object.entries(cugHeaders).forEach(([path, cugList]) => {
    const existing = merged[path] || [];
    merged[path] = [...existing, ...cugList];
  });

  return merged;
}

async function postHeaders(org, site, headersConfig, token) {
  const url = `${ADMIN_API_BASE}/config/${org}/sites/${site}/headers.json`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(headersConfig),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Config Service POST failed: ${resp.status} ${resp.statusText} — ${body}`);
  }
}

function renderUI(container, onRegenerate, onRemove) {
  const heading = document.createElement('h2');
  heading.textContent = 'Page Access';

  const description = document.createElement('p');
  description.className = 'description';
  description.textContent = 'Manage the access restrictions defined in the closed-user-groups sheet for your site.';

  const buttonGroup = document.createElement('div');
  buttonGroup.className = 'button-group';

  const applyBtn = document.createElement('button');
  applyBtn.className = 'action-btn';
  applyBtn.textContent = 'Apply Page Access';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'secondary-btn';
  removeBtn.textContent = 'Remove Page Access';

  buttonGroup.append(applyBtn, removeBtn);

  const status = document.createElement('div');
  status.className = 'status';

  function setButtons(disabled) {
    applyBtn.disabled = disabled;
    removeBtn.disabled = disabled;
  }

  applyBtn.addEventListener('click', async () => {
    setButtons(true);
    status.className = 'status loading';
    status.textContent = 'Applying Page Access...';

    try {
      const result = await onRegenerate();
      status.className = 'status success';
      status.textContent = `Done — access restrictions applied to ${result.cugPaths} restricted page(s) (${result.totalPaths} total).`;
    } catch (err) {
      status.className = 'status error';
      status.textContent = `Error: ${err.message}`;
    } finally {
      setButtons(false);
    }
  });

  removeBtn.addEventListener('click', async () => {
    setButtons(true);
    status.className = 'status loading';
    status.textContent = 'Removing Page Access...';

    try {
      await onRemove();
      status.className = 'status success';
      status.textContent = 'Done — all CUG headers removed.';
    } catch (err) {
      status.className = 'status error';
      status.textContent = `Error: ${err.message}`;
    } finally {
      setButtons(false);
    }
  });

  container.append(heading, description, buttonGroup, status);
}

(async function init() {
  const { context, token } = await DA_SDK;
  const { org, site } = context;

  renderUI(
    document.body,
    async () => {
      const rows = await fetchCugSheet(org, site, token);
      const cugHeaders = transformToHeadersConfig(rows);
      const nonCugHeaders = await fetchExistingNonCugHeaders(org, site, token);
      const merged = mergeHeaders(nonCugHeaders, cugHeaders);

      await postHeaders(org, site, merged, token);

      return {
        cugPaths: Object.keys(cugHeaders).length,
        totalPaths: Object.keys(merged).length,
      };
    },
    async () => {
      const nonCugHeaders = await fetchExistingNonCugHeaders(org, site, token);
      await postHeaders(org, site, nonCugHeaders, token);
    },
  );
}());
