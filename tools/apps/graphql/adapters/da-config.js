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

// DA serves a config as a sheet; the source bus serves a site's as `{ [sheetName]: rows }`.
function firstSheetRows(json, hlx6) {
  if (hlx6) return Object.values(json ?? {})[0];
  if (json?.[':type'] !== 'multi-sheet') return json?.data;
  return json[json[':names']?.[0]]?.data;
}

async function readPattern({ api, url, hlx6 }) {
  const resp = await api.request(url);
  const json = resp?.ok ? await resp.json().catch(() => undefined) : undefined;
  const rows = firstSheetRows(json, hlx6);
  if (!Array.isArray(rows)) return undefined;
  return rows.find((row) => row?.key === ENDPOINT_PATTERN_KEY)?.value;
}

// The site's `graphql.endpoint` URL pattern, else the org's; undefined when unset or unreadable.
// eslint-disable-next-line import/prefer-default-export
export async function loadEndpointPattern({ api, org, site }) {
  const { hlx6, orgConfig, siteConfig } = await api.locate(`/${org}/${site}`);
  const [orgPattern, sitePattern] = await Promise.all([
    readPattern({ api, url: orgConfig }),
    readPattern({ api, url: siteConfig, hlx6 }),
  ]);
  return sitePattern || orgPattern;
}
