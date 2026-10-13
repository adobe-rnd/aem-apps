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
const DA_ORIGIN = 'https://admin.da.live';
const TOKEN_HEADER = 'da-continuation-token';
const MAX_RETRY_DELAY = 30000;
const DEFAULT_RETRY_DELAY = 2000;

const url = (api, org, site, path) => `${DA_ORIGIN}/${api}/${org}/${site}${path}`;

function check(response, action) {
  if (!response.ok) throw new Error(`DA ${action} failed: ${response.status}`);
  return response;
}

let pausedUntil = 0;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Hold until any 429 pause has passed; a pause set meanwhile extends it. */
async function whenUnpaused() {
  while (Date.now() < pausedUntil) {
    // eslint-disable-next-line no-await-in-loop
    await wait(pausedUntil - Date.now());
  }
}

/** Pause every request for `Retry-After` seconds if sent (capped), else 2s. */
function pause(response) {
  const retryAfter = Number.parseFloat(response.headers?.get?.('retry-after'));
  const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : DEFAULT_RETRY_DELAY;
  pausedUntil = Math.max(pausedUntil, Date.now() + Math.min(Math.max(delay, 0), MAX_RETRY_DELAY));
}

/** `daFetch`; a 429 pauses every request, then is retried once. */
async function request(daFetch, requestUrl, options) {
  await whenUnpaused();
  const response = await daFetch(requestUrl, options);
  if (response.status !== 429) return response;
  pause(response);
  await whenUnpaused();
  return daFetch(requestUrl, options);
}

/**
 * One folder of a DA site, every page merged; a missing folder is empty. Paths are
 * site-relative; folders have no ext. DA omits dot-folders (page media, `.da`).
 * @param {{ org: string, site: string, path?: string }} location
 * @returns {Promise<Array<{ path: string, name: string, ext: string, isFolder: boolean,
 *   lastModified: number|null }>>}
 */
export async function listFolder({ org, site, path = '/' }, daFetch) {
  const folder = path === '/' ? '' : path.replace(/\/$/, '');
  const prefix = `/${org}/${site}`;
  const items = [];
  let token;
  do {
    const headers = token ? { [TOKEN_HEADER]: token } : {};
    // eslint-disable-next-line no-await-in-loop
    const response = await request(daFetch, url('list', org, site, folder || '/'), { cache: 'no-store', headers });
    if (response.status === 404 && !token) return [];
    check(response, 'list');
    // eslint-disable-next-line no-await-in-loop
    items.push(...await response.json());
    token = response.headers?.get?.(TOKEN_HEADER);
  } while (token);
  return items.filter((item) => item.path?.startsWith(`${prefix}/`)).map((item) => {
    const itemPath = item.path.slice(prefix.length);
    return {
      path: itemPath,
      name: itemPath.split('/').pop(),
      ext: item.ext || '',
      isFolder: !item.ext,
      lastModified: item.lastModified ?? null,
    };
  });
}

/** A DA file's content as a Blob. */
export async function readSource({ org, site, path }, daFetch) {
  const response = check(await request(daFetch, url('source', org, site, path), { cache: 'no-store' }), 'read');
  return response.blob();
}

/** Create or replace a DA file. Does not create a version. */
export async function writeSource({ org, site, path }, blob, daFetch) {
  const body = new FormData();
  body.append('data', blob);
  check(await request(daFetch, url('source', org, site, path), { method: 'PUT', body }), 'write');
}

/** Save a labelled version of a doc or sheet (DA versions html/json only). */
export async function snapshotSource({ org, site, path }, label, daFetch) {
  check(await request(daFetch, url('versionsource', org, site, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  }), 'version');
}

export async function deleteSource({ org, site, path }, daFetch) {
  check(await request(daFetch, url('source', org, site, path), { method: 'DELETE' }), 'delete');
}
