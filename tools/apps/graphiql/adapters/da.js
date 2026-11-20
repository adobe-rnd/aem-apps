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
const ENDPOINT_NAME = /^[a-z][a-z0-9-]{2,31}$/;
const SERVICE_URL_KEY = 'sc.graphql.url';

// The SDK's fetch adds the user's token to any URL, so only known DA admins are used.
const DA_ADMINS = [
  'https://admin.da.live',
  'https://stage-admin.da.live',
  'https://admin.da.page',
  'https://stage-admin.da.page',
  'http://localhost:8787',
];

// DA lists `{ name, ext? }`; the source bus lists `{ name }` with folders as `name/`.
const folderNames = (items, hlx6) => items
  .filter((item) => (hlx6 ? item.name?.endsWith('/') : !item.ext))
  .map(({ name }) => name.replace(/\/$/, ''));

// DA serves a config as a sheet; the source bus serves a site's as `{ [sheetName]: rows }`.
function firstSheetRows(config, hlx6) {
  if (hlx6) return Object.values(config ?? {})[0];
  if (config?.[':type'] !== 'multi-sheet') return config?.data;
  return config[config[':names']?.[0]]?.data;
}

const configValue = (config, key, hlx6) => {
  const rows = firstSheetRows(config, hlx6);
  return Array.isArray(rows) ? rows.find((row) => row?.key === key)?.value : undefined;
};

/**
 * Reads what the GraphQL Endpoints app stores, over the DA SDK the da.live shell hands over:
 * the endpoint names of a site, and the GraphQL service URL from the DA config.
 * @param {Promise<object>|object} sdk the DA SDK's `{ context, actions }`
 */
// eslint-disable-next-line import/prefer-default-export
export function createDaAdapter(sdk) {
  const connection = Promise.resolve(sdk).then(({ context, actions }) => ({
    daFetch: actions.daFetch,
    daAdmin: DA_ADMINS.includes(context?.daOrigin) ? context.daOrigin : DA_ADMINS[0],
  }));

  // Resolves to the response, or undefined when the request fails before one.
  async function request(url) {
    const { daFetch } = await connection;
    const privileged = [HLX_ADMIN, AEM_API].includes(new URL(url).origin);
    try {
      return await daFetch(url, privileged ? { referrerPolicy: 'unsafe-url' } : {});
    } catch {
      return undefined;
    }
  }

  const json = async (url, { missing } = {}) => {
    const resp = await request(url);
    if (resp?.status === 404 && missing) return missing;
    return resp?.ok ? resp.json().catch(() => undefined) : undefined;
  };

  // The AEM admin's ping announces a Helix 6 site.
  async function isHlx6({ org, site }) {
    const resp = await request(`${HLX_ADMIN}/ping/${org}/${site}`);
    return resp?.headers.has('x-api-upgrade-available') === true;
  }

  // The site's `sc.graphql.url`, else the org's: the base URL of the da-sc-graphql worker.
  async function loadServiceUrl({
    org, site, daAdmin, hlx6,
  }) {
    const siteConfig = hlx6
      ? `${AEM_API}/${org}/sites/${site}/config/editor/da.json`
      : `${daAdmin}/config/${org}/${site}/`;
    const [orgValue, siteValue] = await Promise.all([
      json(`${daAdmin}/config/${org}/`).then((config) => configValue(config, SERVICE_URL_KEY)),
      json(siteConfig).then((config) => configValue(config, SERVICE_URL_KEY, hlx6)),
    ]);
    return siteValue || orgValue;
  }

  /**
   * The site's endpoints, from `.da/graphql/endpoints/{name}/`, and its service URL:
   * `{ endpoints, serviceUrl }` or `{ error }`.
   */
  async function loadSite({ org, site }) {
    const [{ daAdmin }, hlx6] = await Promise.all([connection, isHlx6({ org, site })]);
    const base = `${AEM_API}/${org}/sites/${site}`;
    const folder = '.da/graphql/endpoints';
    const [items, serviceUrl] = await Promise.all([
      json(
        hlx6 ? `${base}/source/${folder}/` : `${daAdmin}/list/${org}/${site}/${folder}`,
        { missing: [] },
      ),
      loadServiceUrl({
        org, site, daAdmin, hlx6,
      }),
    ]);
    if (!Array.isArray(items)) return { error: `Could not load the endpoints of ${org}/${site}.` };
    const endpoints = folderNames(items, hlx6).filter((name) => ENDPOINT_NAME.test(name)).sort();
    return { endpoints, serviceUrl };
  }

  return { loadSite };
}
