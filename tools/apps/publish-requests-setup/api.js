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

// An explicit `?env=ci` wins, so local code (`?ref=local`) can be tested against the CI worker.
function getWorkerUrl() {
  if (new URLSearchParams(window.location.search).get('env') === 'ci') return CI_WORKER_URL;
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return LOCAL_WORKER_URL;
  return WORKER_URL;
}

const workerOpts = (token, method = 'GET', body = null) => ({
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const configUrl = (org, site) => `${DA_ADMIN}/config/${org}/${site ? `${site}/` : ''}`;

/**
 * `{ config, status }`; config is null when missing (404) or unreadable. Read only: every config
 * write goes through the worker, which keeps one writer on the eventually consistent DA config.
 */
export async function readConfig(org, site) {
  try {
    const resp = await daFetch(configUrl(org, site), { cache: 'no-store' });
    if (!resp.ok) return { config: null, status: resp.status };
    return { config: normalizeConfig(await resp.json()), status: resp.status };
  } catch {
    return { config: null, status: 0 };
  }
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
const setupPath = (version) => (version === 'v1' ? '/api/setup' : '/api/v2/setup');
const siteQuery = (org, site) => `org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;

/** Registration, provider options, `canEdit`, `installed` and the workflow view, in one call. */
export const getSetup = (version, org, site, token) => callWorker(`${setupPath(version)}?${siteQuery(org, site)}`, token);

export const getWorkflowConfig = (version, org, site, token) => callWorker(`${workflowPath(version)}?${siteQuery(org, site)}`, token);

/**
 * body: `{ version, tabs?, copyFromOrg?, install? }` from the worker's workflow-config contract.
 * `install: true` installs this route's version (plugin and inbox rows) in the same write.
 */
export const saveWorkflowConfig = (version, org, site, body, token) => callWorker(
  workflowPath(version),
  token,
  { org, site, ...body },
);
