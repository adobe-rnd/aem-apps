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
// Shared by the request-for-publish plugins and the publish-requests inboxes.

const HLX_ADMIN = 'https://admin.hlx.page';
const AEM_API = 'https://api.aem.live';

const answers = new Map();

/**
 * Whether the site runs on Helix 6. The admin ping answers every site and
 * adds the X-API-Upgrade-Available header for Helix 6 sites. Each site is
 * pinged once per page load; a failed ping counts as legacy and is retried
 * on the next call.
 * @param {string} org
 * @param {string} site
 * @param {Function} [fetchFn]
 * @returns {Promise<boolean>}
 */
export function isHlx6(org, site, fetchFn = fetch) {
  const key = `${org}/${site}`;
  if (!answers.has(key)) {
    const answer = Promise.resolve()
      .then(() => fetchFn(`${HLX_ADMIN}/ping/${org}/${site}`))
      .then((resp) => resp.headers.get('x-api-upgrade-available') !== null)
      .catch(() => {
        answers.delete(key);
        return false;
      });
    answers.set(key, answer);
  }
  return answers.get(key);
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
    ? `${AEM_API}/${org}/sites/${site}/${operation}${pathForUrl}`
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
