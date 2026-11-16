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
import { normalizeConfig } from './model.js';

const WORKER_URL = 'https://publish-requests.aem-poc-lab.workers.dev';
const CI_WORKER_URL = 'https://publish-requests-ci.aem-poc-lab.workers.dev';
const LOCAL_WORKER_URL = 'http://localhost:8787';
const DA_ADMIN = 'https://admin.da.live';

const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

function getWorkerUrl() {
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return LOCAL_WORKER_URL;
  if (new URLSearchParams(window.location.search).get('env') === 'ci') return CI_WORKER_URL;
  return WORKER_URL;
}

const workerOpts = (token, method = 'GET', body = null) => ({
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const configUrl = (org, site) => `${DA_ADMIN}/config/${org}/${site ? `${site}/` : ''}`;

/** `{ config, status }`; config is null when missing (404) or unreadable. */
export async function readConfig(org, site) {
  try {
    const resp = await daFetch(configUrl(org, site), { cache: 'no-store' });
    if (!resp.ok) return { config: null, status: resp.status };
    return { config: normalizeConfig(await resp.json()), status: resp.status };
  } catch {
    return { config: null, status: 0 };
  }
}

/** Writes the whole site config; callers pass a fresh read with only their tabs changed. */
export async function writeConfig(org, site, config) {
  const body = new FormData();
  body.append('config', JSON.stringify(config));
  try {
    const resp = await daFetch(configUrl(org, site), { method: 'PUT', body });
    return { ok: resp.ok, status: resp.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// False only when the org listing loads without the site; an unreadable listing doesn't block.
export async function checkSiteExists(org, site) {
  try {
    const resp = await daFetch(`${DA_ADMIN}/list/${org}`);
    const items = resp.ok ? await resp.json() : null;
    return !Array.isArray(items) || items.some((item) => item.name === site);
  } catch {
    return true;
  }
}

/**
 * `{ status: 'registered' | 'unregistered', config }` where config is the worker's setup view
 * (`availableProviders`, `providerWarnings`, `canEdit`, public registration fields),
 * or `{ status: 'unknown' }` when the worker can't say (no access, or no route yet).
 */
export async function getRegistration(org, site, token) {
  try {
    const url = `${getWorkerUrl()}/api/site-config?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
    const resp = await fetch(url, workerOpts(token));
    const body = await resp.json().catch(() => ({}));
    if (resp.ok) return { status: 'registered', config: body };
    if (Array.isArray(body.availableProviders)) return { status: 'unregistered', config: body };
  } catch { /* unknown */ }
  return { status: 'unknown' };
}

async function callWorker(path, token, body) {
  try {
    const resp = await fetch(`${getWorkerUrl()}${path}`, workerOpts(token, body ? 'POST' : 'GET', body));
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { error: error.message || 'The publish requests service could not be reached.' } };
  }
}

export const saveRegistration = (org, site, settings, token) => callWorker('/api/site-config', token, { org, site, ...settings });

const workflowPath = (version) => (version === 'v1' ? '/api/workflow-config' : '/api/v2/workflow-config');

export const getWorkflowConfig = (version, org, site, token) => callWorker(
  `${workflowPath(version)}?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`,
  token,
);

/** body: `{ version, tabs, copyFromOrg? }` from the worker's workflow-config contract. */
export const saveWorkflowConfig = (version, org, site, body, token) => callWorker(
  workflowPath(version),
  token,
  { org, site, ...body },
);
