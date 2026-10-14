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

// Content listing for the fragment picker. Legacy DA sites list through
// admin.da.live; Helix 6 sites keep their content in the AEM source bus
// (api.aem.live), which admin.da.live doesn't see. Both are normalized to the
// DA list shape: { path: '/org/repo/a/b.html', name: 'b', ext: 'html' } for
// files and { path: '/org/repo/a', name: 'a' } for folders.

const DA_ADMIN = 'https://admin.da.live';
const AEM_API = 'https://api.aem.live';
const HLX_ADMIN = 'https://admin.hlx.page';
const LOCALE_PATTERN = /^[a-z]{2}(-[a-z]{2,4})?$/i;

export function isLocaleFolder(name) {
  return LOCALE_PATTERN.test(name);
}

function stripOrgRepoPrefix(path, org, repo) {
  const prefix = `/${org}/${repo}`;
  return path.startsWith(prefix) ? path.substring(prefix.length) || '/' : path;
}

function isFolderItem(item) {
  return !item.ext && !item.name.includes('.') && item.name !== 'drafts';
}

/**
 * Whether the site runs on Helix 6 (content in the source bus). The admin
 * ping announces it with the X-API-Upgrade-Available header.
 * @param {string} org
 * @param {string} repo
 * @param {Function} [fetchFn]
 * @returns {Promise<boolean>}
 */
export async function isHlx6(org, repo, fetchFn = fetch) {
  try {
    const resp = await fetchFn(`${HLX_ADMIN}/ping/${org}/${repo}`);
    return resp.headers.get('x-api-upgrade-available') !== null;
  } catch {
    return false;
  }
}

function toDaItem(org, repo, folderPath, item) {
  const isFolder = item['content-type'] === 'application/folder' || item.name.endsWith('/');
  const name = item.name.replace(/\/$/, '');
  const path = `/${org}/${repo}${folderPath}/${name}`;
  if (isFolder) return { path, name };
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { path, name };
  return { path, name: name.substring(0, dot), ext: name.substring(dot + 1) };
}

// The admin API (api.aem.live, incl. source listing) is limited to 10 requests
// per second per project (https://www.aem.live/docs/limits). Its 429 carries no
// CORS headers, so in the browser it surfaces as a network error.
const HLX6_CONCURRENCY = 4;
const HLX6_MIN_INTERVAL_MS = 125; // at most 8 request starts per second
const RETRY_DELAYS_MS = [1000, 2000, 4000];

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function createLimiter(max, minIntervalMs) {
  let active = 0;
  let nextStart = 0;
  const waiting = [];
  return async (task) => {
    if (active >= max) await new Promise((resolve) => { waiting.push(resolve); });
    active += 1;
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + minIntervalMs;
    if (wait) await defaultSleep(wait);
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

async function fetchWithRetry(fetchFn, url, opts, sleep) {
  for (let attempt = 0; ; attempt += 1) {
    let resp;
    try {
      // eslint-disable-next-line no-await-in-loop
      resp = await fetchFn(url, opts);
    } catch (e) {
      resp = null;
    }
    const retryable = !resp || resp.status === 429 || resp.status === 503;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) return resp;
    // eslint-disable-next-line no-await-in-loop
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

/**
 * Creates a folder lister for the site.
 * @param {object} opts
 * @param {string} opts.org
 * @param {string} opts.repo
 * @param {string} opts.token IMS token from the DA SDK
 * @param {boolean} opts.hlx6 list from the source bus instead of admin.da.live
 * @param {Function} [opts.fetchFn]
 * @param {number} [opts.concurrency] max parallel source bus requests
 * @param {number} [opts.minIntervalMs] min time between source bus request starts
 * @param {Function} [opts.sleep] delay function used between retries
 * @returns {(path: string) => Promise<{ok: boolean, items: object[]}>} lists a
 *   site-relative folder path ('' for the root, '/fragments', ...)
 */
export function createLister({
  org, repo, token, hlx6, fetchFn = fetch,
  concurrency = HLX6_CONCURRENCY, minIntervalMs = HLX6_MIN_INTERVAL_MS, sleep = defaultSleep,
}) {
  const headers = { Authorization: `Bearer ${token}` };
  const limit = createLimiter(concurrency, minIntervalMs);
  return async (path) => {
    const folderPath = (path || '').replace(/\/$/, '');
    const url = hlx6
      ? `${AEM_API}/${org}/sites/${repo}/source${folderPath}/`
      : `${DA_ADMIN}/list/${org}/${repo}${folderPath}`;
    const resp = hlx6
      ? await limit(() => fetchWithRetry(fetchFn, url, { headers }, sleep))
      : await fetchFn(url, { headers });
    if (!resp?.ok) return { ok: false, items: [] };
    const body = await resp.json();
    if (!Array.isArray(body)) return { ok: true, items: [] };
    if (!hlx6) return { ok: true, items: body };
    const items = body
      .filter((item) => item.name && !item.name.startsWith('.'))
      .map((item) => toDaItem(org, repo, folderPath, item));
    return { ok: true, items };
  };
}

/**
 * Recursively collects the .html files below a site-relative folder.
 * @param {Function} list lister from createLister
 * @param {string} org
 * @param {string} repo
 * @param {string} path site-relative folder path
 * @returns {Promise<object[]>} DA-shaped file items
 */
export async function crawlHtml(list, org, repo, path) {
  const files = [];
  const folders = [path];
  while (folders.length) {
    const batch = folders.splice(0, folders.length);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch.map((folder) => list(folder)));
    results.forEach(({ items }) => {
      items.forEach((item) => {
        if (item.ext) {
          if (item.ext === 'html') files.push(item);
        } else {
          folders.push(stripOrgRepoPrefix(item.path, org, repo));
        }
      });
    });
  }
  return files;
}

/**
 * Discover all "fragments" folders at levels 0, 1, or 2
 * @param {string} org - Organization name
 * @param {string} repo - Repository name
 * @param {Function} list - lister from createLister
 * @returns {Promise<Array>} Array of discovered fragment roots with metadata
 */
export async function discoverFragmentRoots(org, repo, list) {
  const roots = [];

  try {
    const { ok } = await list('/fragments');
    if (ok) {
      roots.push({
        path: '/fragments',
        locale: null,
        depth: 1,
        label: '/fragments',
      });
    }
  } catch (error) {
    // Ignore
  }

  try {
    const { ok, items } = await list('');
    if (ok) {
      const folders = items.filter(isFolderItem);

      const level1Checks = folders.map(async (folder) => {
        const folderPath = stripOrgRepoPrefix(folder.path || `/${folder.name}`, org, repo);
        const folderName = folder.name;

        try {
          const frag = await list(`${folderPath}/fragments`);
          if (frag.ok) {
            const locale = isLocaleFolder(folderName) ? folderName : null;
            roots.push({
              path: `${folderPath}/fragments`,
              locale,
              depth: 2,
              label: `${folderPath}/fragments`,
            });
          }
        } catch (err) {
          // Ignore
        }
      });

      await Promise.all(level1Checks);

      const level2Checks = folders.map(async (folder) => {
        const folderPath = stripOrgRepoPrefix(folder.path || `/${folder.name}`, org, repo);

        try {
          const sub = await list(folderPath);

          if (sub.ok) {
            const subFolders = sub.items.filter(isFolderItem);

            const level2FragmentChecks = subFolders.map(async (subFolder) => {
              const subFolderPath = stripOrgRepoPrefix(
                subFolder.path || `${folderPath}/${subFolder.name}`,
                org,
                repo,
              );

              try {
                const frag = await list(`${subFolderPath}/fragments`);
                if (frag.ok) {
                  const pathSegments = subFolderPath.split('/').filter(Boolean);
                  const locale = pathSegments.length === 2 && isLocaleFolder(pathSegments[1])
                    ? pathSegments[1] : null;
                  roots.push({
                    path: `${subFolderPath}/fragments`,
                    locale,
                    depth: 3,
                    label: `${subFolderPath}/fragments`,
                  });
                }
              } catch (err) {
                // Ignore
              }
            });

            await Promise.all(level2FragmentChecks);
          }
        } catch (err) {
          // Ignore
        }
      });

      await Promise.all(level2Checks);
    }
  } catch (error) {
    // Ignore
  }

  return roots.sort((a, b) => {
    if (!a.locale && b.locale) return -1;
    if (a.locale && !b.locale) return 1;
    return a.label.localeCompare(b.label);
  });
}
