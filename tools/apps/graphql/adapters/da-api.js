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

export const AEM_API = 'https://api.aem.live';
export const HLX_ADMIN = 'https://admin.hlx.page';

// The SDK's fetch adds the user's token to any URL, so only known DA admins are used.
const DA_ADMINS = [
  'https://admin.da.live',
  'https://stage-admin.da.live',
  'https://admin.da.page',
  'https://stage-admin.da.page',
  'http://localhost:8787',
];

/**
 * Requests and API URLs for DA content, over the DA SDK the da.live shell hands over.
 * Legacy DA sites use DA's admin API and admin.hlx.page; Helix 6 sites use the AEM
 * source bus (api.aem.live) for both.
 * @param {Promise<object>|object} sdk the DA SDK's `{ context, actions }`
 */
// eslint-disable-next-line import/prefer-default-export
export function createDaApi(sdk) {
  const connection = Promise.resolve(sdk).then(({ context, actions }) => ({
    daFetch: actions.daFetch,
    daAdmin: DA_ADMINS.includes(context?.daOrigin) ? context.daOrigin : DA_ADMINS[0],
  }));

  // Resolves to the response, or undefined when the request fails before one.
  async function request(url, opts = {}) {
    const { daFetch } = await connection;
    // As nx2 does, the AEM admin APIs get the full referrer.
    const privileged = [HLX_ADMIN, AEM_API].includes(new URL(url).origin);
    try {
      return await daFetch(url, privileged ? { ...opts, referrerPolicy: 'unsafe-url' } : opts);
    } catch {
      return undefined;
    }
  }

  // The AEM admin's ping announces a Helix 6 site. A failed ping is retried by the next call.
  const hlx6Sites = new Map();
  function isHlx6({ org, site }) {
    const key = `/${org}/${site}`;
    if (!hlx6Sites.has(key)) {
      hlx6Sites.set(key, request(`${HLX_ADMIN}/ping${key}`).then((resp) => {
        if (!resp?.ok) hlx6Sites.delete(key);
        return resp?.headers.has('x-api-upgrade-available') === true;
      }));
    }
    return hlx6Sites.get(key);
  }

  // The URLs that serve an absolute DA path, `/{org}/{site}/...`, and its site's configs.
  async function locate(path) {
    const [, org, site, ...parts] = path.split('/');
    const sitePath = parts.length ? `/${parts.join('/')}` : '';
    const aemPath = sitePath.replace(/\.html$/, '');
    const [{ daAdmin }, hlx6] = await Promise.all([connection, isHlx6({ org, site })]);
    const orgConfig = `${daAdmin}/config/${org}/`;
    if (hlx6) {
      const base = `${AEM_API}/${org}/sites/${site}`;
      return {
        hlx6,
        source: `${base}/source${sitePath}`,
        list: `${base}/source${sitePath}/`,
        preview: `${base}/preview${aemPath}`,
        live: `${base}/live${aemPath}`,
        orgConfig,
        siteConfig: `${base}/config/editor/da.json`,
      };
    }
    return {
      hlx6,
      source: `${daAdmin}/source${path}`,
      list: `${daAdmin}/list${path}`,
      preview: `${HLX_ADMIN}/preview/${org}/${site}/main${aemPath}`,
      live: `${HLX_ADMIN}/live/${org}/${site}/main${aemPath}`,
      orgConfig,
      siteConfig: `${daAdmin}/config/${org}/${site}/`,
    };
  }

  return { request, locate };
}
