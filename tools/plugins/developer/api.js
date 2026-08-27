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
/* eslint-disable no-console, import/prefer-default-export */

const ADMIN_API = 'https://api.aem.live';

// When the requested org/site isn't the canonical source for the code repo,
// the admin API returns 403 with this error code, and the `x-error` header
// carries a message ending in the canonical `org/site` to use instead, e.g.
// "[admin] Code operation restricted to canonical source: attsites/att-da".
const NOT_CANONICAL_ERROR_CODE = 'AEM_NOT_CANONICAL_CODE_SOURCE';

// Branches don't change often; cache the list in sessionStorage for a
// short time so switching branches (which reloads the page) doesn't
// trigger an immediate refetch.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY_PREFIX = 'da-developer-branches';

function getCacheKey(org, site) {
  return `${CACHE_KEY_PREFIX}:${org}/${site}`;
}

function readCache(org, site) {
  try {
    const raw = sessionStorage.getItem(getCacheKey(org, site));
    if (!raw) return null;
    const { branches, timestamp } = JSON.parse(raw);
    if (!Array.isArray(branches) || Date.now() - timestamp > CACHE_TTL_MS) return null;
    return branches;
  } catch {
    return null;
  }
}

function writeCache(org, site, branches) {
  try {
    const value = JSON.stringify({ branches, timestamp: Date.now() });
    sessionStorage.setItem(getCacheKey(org, site), value);
  } catch {
    // sessionStorage unavailable or full — caching is a non-essential optimization
  }
}

/**
 * Parse the canonical `org/site` out of the `x-error` header sent alongside
 * an `AEM_NOT_CANONICAL_CODE_SOURCE` 403, e.g. a message ending in
 * "...canonical source: attsites/att-da" yields `{ org: 'attsites', site: 'att-da' }`.
 * @param {string|null} headerValue - the raw `x-error` header value
 * @returns {{org: string, site: string}|null}
 */
export function parseCanonicalSource(headerValue) {
  if (!headerValue) return null;
  const match = headerValue.trim().match(/([\w.-]+)\/([\w.-]+)\s*$/);
  if (!match) return null;
  const [, canonicalOrg, canonicalSite] = match;
  return { org: canonicalOrg, site: canonicalSite };
}

async function requestBranches(org, site, token) {
  return fetch(`${ADMIN_API}/${org}/repos/${site}/code/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Fetch the list of code branches for a site from the EDS admin API.
 * Results are cached in sessionStorage for `CACHE_TTL_MS` to avoid
 * refetching right after a branch switch reloads the page.
 *
 * If the API responds with a 403 and an `x-error-code` of
 * `AEM_NOT_CANONICAL_CODE_SOURCE`, the `x-error` header is parsed for the
 * canonical `org/site` and the request is retried against it — only in
 * that specific case.
 * @param {string} org - Organization (owner)
 * @param {string} site - Site (repo)
 * @param {string} token - IMS bearer token
 * @returns {Promise<{branches: string[], error: string|null}>}
 */
export async function fetchBranches(org, site, token) {
  const cached = readCache(org, site);
  if (cached) {
    return { branches: cached, error: null };
  }

  try {
    let response = await requestBranches(org, site, token);

    if (response.status === 403 && response.headers.get('x-error-code') === NOT_CANONICAL_ERROR_CODE) {
      const canonical = parseCanonicalSource(response.headers.get('x-error'));
      if (canonical) {
        response = await requestBranches(canonical.org, canonical.site, token);
      }
    }

    if (response.status === 401) {
      return { branches: [], error: 'unauthorized' };
    }
    if (response.status === 404) {
      return { branches: [], error: 'not-found' };
    }
    if (!response.ok) {
      return { branches: [], error: `http-${response.status}` };
    }

    const { branches = [] } = await response.json();
    // Each entry is a path like /{owner}/repos/{repo}/code/{branch}/ — the
    // branch name is the final segment, after stripping any trailing slash.
    const names = branches
      .map((path) => path.replace(/\/$/, '').split('/').pop())
      .filter(Boolean);
    writeCache(org, site, names);
    return { branches: names, error: null };
  } catch (error) {
    console.error('Error fetching branches:', error);
    return { branches: [], error: 'network' };
  }
}
