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
import { applyCugHeaders, fetchExistingNonCugHeaders, postHeaders } from './headers.js';

const DA_SOURCE_BASE = 'https://admin.da.live/source';
const CUG_SHEET_PATH = 'closed-user-groups.json';

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
  const request = (url, options = {}) => fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  renderUI(
    document.body,
    async () => {
      const rows = await fetchCugSheet(org, site, token);
      return applyCugHeaders(org, site, rows, request);
    },
    async () => {
      const nonCugHeaders = await fetchExistingNonCugHeaders(org, site, request);
      await postHeaders(org, site, nonCugHeaders, request);
    },
  );
}());
