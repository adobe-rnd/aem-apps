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

const ENDPOINT_PATTERN_KEY = 'graphql.endpoint';
const REINDEX_URL_KEY = 'sc.graphql.url';

// DA serves a config as a sheet; the source bus serves a site's as `{ [sheetName]: rows }`.
function firstSheetRows(json, hlx6) {
  if (hlx6) return Object.values(json ?? {})[0];
  if (json?.[':type'] !== 'multi-sheet') return json?.data;
  return json[json[':names']?.[0]]?.data;
}

async function readValue({
  api, url, hlx6, key,
}) {
  const resp = await api.request(url);
  const json = resp?.ok ? await resp.json().catch(() => undefined) : undefined;
  const rows = firstSheetRows(json, hlx6);
  if (!Array.isArray(rows)) return undefined;
  return rows.find((row) => row?.key === key)?.value;
}

// The site's value of `key` in the config's first sheet, else the org's.
async function loadValue({
  api, org, site, key,
}) {
  const { hlx6, orgConfig, siteConfig } = await api.locate(`/${org}/${site}`);
  const [orgValue, siteValue] = await Promise.all([
    readValue({ api, url: orgConfig, key }),
    readValue({
      api, url: siteConfig, hlx6, key,
    }),
  ]);
  return siteValue || orgValue;
}

// The site's `graphql.endpoint` URL pattern, else the org's; undefined when unset or unreadable.
export const loadEndpointPattern = ({ api, org, site }) => loadValue({
  api, org, site, key: ENDPOINT_PATTERN_KEY,
});

// The site's `sc.graphql.url`, else the org's; undefined unless an https URL.
export async function loadReindexUrl({ api, org, site }) {
  const value = await loadValue({
    api, org, site, key: REINDEX_URL_KEY,
  });
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'https:' ? url.href.replace(/\/+$/, '') : undefined;
  } catch {
    return undefined;
  }
}
