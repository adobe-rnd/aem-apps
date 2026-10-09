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
// can't read the source bus, so the plugin previews them on api.aem.live
// (which sends CORS headers itself). Same detection as da-nx nx2 isHlx6.

const HLX_ADMIN = 'https://admin.hlx.page';
const AEM_API = 'https://api.aem.live';

/**
 * Whether the site runs on Helix 6. The admin ping answers every site and
 * adds the X-API-Upgrade-Available header for Helix 6 sites.
 * @param {string} org
 * @param {string} site
 * @param {Function} [fetchFn]
 * @returns {Promise<boolean>}
 */
export async function isHlx6(org, site, fetchFn = fetch) {
  try {
    const resp = await fetchFn(`${HLX_ADMIN}/ping/${org}/${site}`);
    return resp.headers.get('x-api-upgrade-available') !== null;
  } catch {
    return false;
  }
}

/**
 * Admin API URL that previews a page.
 * @param {string} org
 * @param {string} site
 * @param {string} path - content path, e.g. /drafts/page
 * @param {boolean} hlx6
 * @returns {string}
 */
export function previewApiUrl(org, site, path, hlx6) {
  const pathForUrl = path.startsWith('/') ? path : `/${path}`;
  return hlx6
    ? `${AEM_API}/${org}/sites/${site}/preview${pathForUrl}`
    : `${HLX_ADMIN}/preview/${org}/${site}/main${pathForUrl}`;
}
