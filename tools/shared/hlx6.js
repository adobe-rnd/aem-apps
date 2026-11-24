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

// Wait before retry number `attempt` (from 0): the server's Retry-After in
// seconds when the browser can read it, at most `maxMs`, else 1 s, 2 s, 4 s...
function retryDelayMs(resp, attempt, maxMs = 5000) {
  const seconds = Number.parseFloat(resp?.headers.get('retry-after') ?? resp?.headers.get('x-retry-after'));
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxMs);
  return 1000 * 2 ** attempt;
}

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
const PING_RETRIES = 2;

async function pingWithRetries(org, site, fetchFn) {
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    let failure;
    try {
      // eslint-disable-next-line no-await-in-loop
      return await pingHlx6(org, site, fetchFn, { signal: controller.signal });
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
    }
    const status = failure.response?.status;
    if ((status !== 429 && status !== 503) || attempt >= PING_RETRIES) {
      const reason = status ? `admin ping ${status}` : 'admin ping failed';
      throw new Error(`Could not check the setup of ${org}/${site} (${reason}). Try again.`, { cause: failure });
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(retryDelayMs(failure.response, attempt));
  }
}

const answers = new Map();

/**
 * Whether the site runs on Helix 6, from the admin ping (see pingHlx6). Each
 * site is pinged once per page load. A 429 or 503 is retried twice; a ping
 * that still fails, times out or answers with another error rejects, so
 * callers send nothing, and isn't cached, so the next call pings again.
 * @param {string} org
 * @param {string} site
 * @param {Function} [fetchFn]
 * @returns {Promise<boolean>}
 */
export function isHlx6(org, site, fetchFn = fetch) {
  const key = `${org}/${site}`;
  if (!answers.has(key)) {
    const answer = pingWithRetries(org, site, fetchFn);
    answers.set(key, answer);
    answer.catch(() => answers.delete(key));
  }
  return answers.get(key);
}

const sources = new Map();

/**
 * Whether the site's primary content lives in the source bus, which decides
 * where its DA config and versions are. The admin ping alone can't say: it
 * also flags a legacy site that only has a source-bus overlay. So for a
 * flagged site this reads the sidekick config: source type `sourcebus` (with
 * or without a URL) or a source URL on the API host means the source bus.
 * True and false are kept for the page load; null (ping or config couldn't be
 * read, or the config names no source) is asked again on the next call.
 * @param {string} org
 * @param {string} site
 * @param {Function} fetchSiteConfig - (org, site) => sidekick config or null
 * @returns {Promise<boolean|null>}
 */
export function usesSourceBus(org, site, fetchSiteConfig) {
  const key = `${org}/${site}`;
  if (!sources.has(key)) {
    const answer = isHlx6(org, site)
      .then(async (hlx6) => {
        if (!hlx6) return false;
        const config = await fetchSiteConfig(org, site);
        const { contentSourceType: type, contentSourceUrl: url } = config ?? {};
        if (!type && !url) return null;
        return type === 'sourcebus' || url?.startsWith(`${AEM_API}/`) === true;
      })
      .catch(() => null);
    sources.set(key, answer);
    answer.then((value) => { if (value === null) sources.delete(key); });
  }
  return sources.get(key);
}

// The API host allows 10 requests per second per project
// (https://www.aem.live/docs/limits), shared by every app and user of the
// site, and its 429 has no CORS headers, so the browser reports a network
// error. Requests sent with pacedAemApiFetch start at least 125 ms apart
// (8/s), measured from the last real start, so timers that fire late (a
// background tab) don't send a burst. A 429, 503 or network error pauses
// every queued request (for Retry-After when the browser can read it) and is
// retried through the same pace.
const API_MIN_INTERVAL_MS = 125;
const API_RETRIES = 3;
const API_MAX_PAUSE_MS = 10000;
let lastApiStart = 0;
let apiPausedUntil = 0;

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
    const retry = failure || [429, 503].includes(resp.status) || isNetworkError(resp);
    if (!retry) return resp;
    if (attempt >= API_RETRIES) {
      if (failure) throw failure;
      return resp;
    }
    const pause = retryDelayMs(resp, attempt, API_MAX_PAUSE_MS);
    apiPausedUntil = Math.max(apiPausedUntil, Date.now() + pause);
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
