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

/**
 * Reads what the GraphQL Endpoints app stores, over the DA SDK the da.live shell hands over:
 * the endpoint names of a site and the saved endpoint documents.
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

  /** The site's endpoints, from `.da/graphql/endpoints/{name}/`: `{ endpoints }` or `{ error }`. */
  async function loadSite({ org, site }) {
    const [{ daAdmin }, hlx6] = await Promise.all([connection, isHlx6({ org, site })]);
    const base = `${AEM_API}/${org}/sites/${site}`;
    const folder = '.da/graphql/endpoints';
    const items = await json(
      hlx6 ? `${base}/source/${folder}/` : `${daAdmin}/list/${org}/${site}/${folder}`,
      { missing: [] },
    );
    if (!Array.isArray(items)) return { error: `Could not load the endpoints of ${org}/${site}.` };
    const endpoints = folderNames(items, hlx6).filter((name) => ENDPOINT_NAME.test(name)).sort();
    return { endpoints };
  }

  /**
   * The saved source of `/.da/graphql/endpoints/{endpoint}/endpoint.html`: `{ html }` or
   * `{ error }`.
   */
  async function loadEndpoint({ org, site, endpoint }) {
    const [{ daAdmin }, hlx6] = await Promise.all([connection, isHlx6({ org, site })]);
    const file = `.da/graphql/endpoints/${endpoint}/endpoint.html`;
    const resp = await request(hlx6
      ? `${AEM_API}/${org}/sites/${site}/source/${file}`
      : `${daAdmin}/source/${org}/${site}/${file}`);
    if (!resp?.ok) return { error: `Could not load the ${endpoint} endpoint of ${org}/${site}.` };
    return { html: await resp.text() };
  }

  return { loadSite, loadEndpoint };
}
