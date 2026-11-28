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

// Helix 6 sites keep their content in the AEM source bus and run the admin
// API on api.aem.live. admin.hlx.page still answers for them, but its preview
// can't read the source bus, so apps and plugins preview and publish them on
// api.aem.live (which sends CORS headers itself), like da.live's nx2 `aem`
// helpers. Same detection as da-nx nx2 isHlx6.
// Shared by the request-for-publish plugins, the publish-requests inboxes and
// the fragments plugin.

const HLX_ADMIN = 'https://admin.hlx.page';
const AEM_API = 'https://api.aem.live';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * One admin ping, not cached: whether the site runs on Helix 6. The admin
 * ping adds the X-API-Upgrade-Available header for Helix 6 sites. Without
 * it, a 2xx or a 404 means legacy; any other answer throws, with the
 * response as `error.response`.
 * @param {string} org
 * @param {string} site
 * @param {Function} [fetchFn]
 * @param {RequestInit} [init]
 * @returns {Promise<boolean>}
 */
export async function pingHlx6(org, site, fetchFn = fetch, init = undefined) {
  const resp = await fetchFn(`${HLX_ADMIN}/ping/${org}/${site}`, init);
  if (resp.headers.get('x-api-upgrade-available') !== null) return true;
  if (resp.ok || resp.status === 404) return false;
  throw Object.assign(new Error(`admin ping ${resp.status}`), { response: resp });
}

const PING_TIMEOUT_MS = 5000;

// The ping's answer, or null when it failed or timed out.
async function pingWithTimeout(org, site, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    return await pingHlx6(org, site, fetchFn, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const answers = new Map();

/**
 * Whether the site runs on Helix 6, from the admin ping (see pingHlx6). Each
 * site is pinged once per page load. A ping that fails, times out or answers
 * with an error counts as legacy, which is what the apps did before they
 * knew Helix 6, and isn't cached, so the next call pings again.
 * @param {string} org
 * @param {string} site
 * @param {Function} [fetchFn]
 * @returns {Promise<boolean>}
 */
export async function isHlx6(org, site, fetchFn = fetch) {
  const key = `${org}/${site}`;
  if (!answers.has(key)) {
    const answer = pingWithTimeout(org, site, fetchFn);
    answers.set(key, answer);
    answer.then((value) => { if (value === null) answers.delete(key); });
  }
  return await answers.get(key) === true;
}

// The API host allows 10 requests per second per project
// (https://www.aem.live/docs/limits), shared by every app and user of the
// site, and its 429 has no CORS headers, so the browser reports a network
// error. Requests sent with pacedAemApiFetch start at least 125 ms apart
// (8/s), measured from the last real start, so timers that fire late (a
// background tab) don't send a burst. A 429, 503 or network error pauses
// every queued request (for Retry-After when the browser can read it). Only a
// readable 429 is retried, through the same pace: after a 503 or a network
// error the server may already have run the request, and a POST would then
// run twice.
const API_MIN_INTERVAL_MS = 125;
const API_RETRIES = 3;
const API_MAX_PAUSE_MS = 10000;
let lastApiStart = 0;
let apiPausedUntil = 0;

// How long to pause after attempt number `attempt` (from 0) failed: the
// server's Retry-After in seconds when the browser can read it, at most 10 s,
// else 1 s, 2 s, 4 s...
function pauseMs(resp, attempt) {
  const seconds = Number.parseFloat(resp?.headers.get('retry-after') ?? resp?.headers.get('x-retry-after'));
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, API_MAX_PAUSE_MS);
  return 1000 * 2 ** attempt;
}

async function apiSlot() {
  for (;;) {
    const now = Date.now();
    const wait = Math.max(apiPausedUntil, lastApiStart + API_MIN_INTERVAL_MS) - now;
    if (wait <= 0) {
      lastApiStart = now;
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(wait);
  }
}

// daFetch answers a failed fetch with a 500 it makes itself (type 'default');
// a real answer from the server has type 'cors' or 'basic'.
const isNetworkError = (resp) => resp.status === 500 && resp.type === 'default';

/**
 * Sends a request to the API host at the page's pace (see above).
 * @param {Function} fetchFn - e.g. daFetch
 * @param {string} url
 * @param {RequestInit} opts
 * @returns {Promise<Response>} the answer; the last one once retries are used up
 */
export async function pacedAemApiFetch(fetchFn, url, opts) {
  for (let attempt = 0; ; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await apiSlot();
    let resp;
    let failure;
    try {
      // eslint-disable-next-line no-await-in-loop
      resp = await fetchFn(url, opts);
    } catch (error) {
      failure = error;
    }
    if (failure || [429, 503].includes(resp.status) || isNetworkError(resp)) {
      apiPausedUntil = Math.max(apiPausedUntil, Date.now() + pauseMs(resp, attempt));
    }
    if (failure) throw failure;
    if (resp.status !== 429 || attempt >= API_RETRIES) return resp;
  }
}

/**
 * URL of a site resource on api.aem.live, e.g. `source/drafts/page.html` or
 * `config/editor/da.json`. Helix 6 sites only.
 * @param {string} org
 * @param {string} site
 * @param {string} resource - path below the site, without a leading slash
 * @returns {string}
 */
export function aemApiUrl(org, site, resource) {
  return `${AEM_API}/${org}/sites/${site}/${resource}`;
}

/**
 * Creates a version of a source in the source bus, at the page's pace, with
 * the label as its comment (in the query, as da.live does). The server answers
 * 404 and creates nothing when the source is missing, so no source check is
 * needed first.
 * @param {Function} fetchFn - e.g. daFetch
 * @param {string} org
 * @param {string} site
 * @param {string} sourcePath - e.g. `drafts/page.html`
 * @param {string} label
 * @returns {Promise<Response>}
 */
export function createSourceVersion(fetchFn, org, site, sourcePath, label) {
  const url = `${aemApiUrl(org, site, `source/${sourcePath}`)}/.versions?comment=${encodeURIComponent(label)}`;
  return pacedAemApiFetch(fetchFn, url, { method: 'POST' });
}

/**
 * Admin API URL for a preview or live operation on a page. Bulk operations
 * use path `/*` on admin.hlx.page but `/` (the resource root) on
 * api.aem.live, which rejects `/*`. api.aem.live paths have no ref (it works
 * on main), so for Helix 6 the ref only picks the aem.page / aem.live host.
 * @param {'preview'|'live'} operation
 * @param {{org: string, site: string, path: string, ref?: string}} page
 * @param {boolean} hlx6
 * @returns {string}
 */
export function adminUrl(operation, {
  org, site, path, ref = 'main',
}, hlx6) {
  const pathForUrl = path.startsWith('/') ? path : `/${path}`;
  return hlx6
    ? aemApiUrl(org, site, `${operation}${pathForUrl}`)
    : `${HLX_ADMIN}/${operation}/${org}/${site}/${ref}${pathForUrl}`;
}

/**
 * Whether a URL (e.g. a job link from a bulk response) points at api.aem.live,
 * which answers browsers directly, unlike admin.hlx.page.
 * @param {string} url
 * @returns {boolean}
 */
export function isAemApiUrl(url) {
  try {
    return new URL(url).origin === AEM_API;
  } catch {
    return false;
  }
}
