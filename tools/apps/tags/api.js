/* eslint-disable import/no-unresolved */

import { DA_ORIGIN, resolveTaxonomyLocation, fetchTaxonomySheet } from './taxonomy.js';

// daFetch ensures a fresh IMS token is used on every request (handles token expiry)
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');
const { crawl } = await import('https://da.live/nx/public/utils/tree.js');

export { DA_ORIGIN, resolveTaxonomyLocation };
export const AEM_ADMIN = 'https://admin.hlx.page';

// Bounded page-fetch concurrency for bulk search, and crawl's own request
// throttle — kept modest so a large-site search doesn't hammer DA admin.
const FETCH_CONCURRENCY = 6;
const CRAWL_THROTTLE = 20;

/**
 * App-side convenience wrapper: this app runs directly on da.live, so it
 * always fetches with its own top-level `daFetch` import (see
 * `fetchTaxonomySheet` in `taxonomy.js` for why the plugin can't do the same).
 * @param {string} sourceUrl
 * @returns {Promise<{ok: boolean, status: number, sheet: Object|null}>}
 */
export async function fetchTaxonomy(sourceUrl) {
  return fetchTaxonomySheet(daFetch, sourceUrl);
}

/**
 * Saves a taxonomy sheet to DA source.
 * @param {string} sourceUrl
 * @param {Object} sheet `{ total, limit, offset, data }` envelope
 * @returns {Promise<{success: boolean, status?: number, error?: string}>}
 */
export async function saveTaxonomy(sourceUrl, sheet) {
  try {
    const formData = new FormData();
    formData.append('data', new Blob([JSON.stringify(sheet)], { type: 'application/json' }));
    const response = await daFetch(sourceUrl, { method: 'PUT', body: formData });
    return { success: response.ok, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Runs the AEM Admin API preview step for a resource, so `.aem.page` (and,
 * after `publishTaxonomy`, `.aem.live`) reflect the saved source.
 * @param {string} org
 * @param {string} repo
 * @param {string} path Site-relative path, e.g. `/taxonomy.json`
 */
export async function previewTaxonomy(org, repo, path) {
  try {
    const response = await daFetch(`${AEM_ADMIN}/preview/${org}/${repo}/main${path}`, { method: 'POST' });
    return { success: response.ok, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Publishes a previewed resource live.
 * @param {string} org
 * @param {string} repo
 * @param {string} path Site-relative path, e.g. `/taxonomy.json`
 */
export async function publishTaxonomy(org, repo, path) {
  try {
    const response = await daFetch(`${AEM_ADMIN}/live/${org}/${repo}/main${path}`, { method: 'POST' });
    return { success: response.ok, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function fetchSiteList(org) {
  try {
    const response = await daFetch(`${DA_ORIGIN}/list/${org}/`);
    if (!response.ok) return [];
    const items = await response.json();
    if (!Array.isArray(items)) return [];
    return items.filter((item) => !item.ext).map((item) => item.name);
  } catch {
    return [];
  }
}

/**
 * Checks a page's DA source markup for a metadata block entry naming the
 * given tag path. Assumes the standard EDS block markup — a `.metadata`
 * block whose rows are `<div><div>Key</div><div>Value</div></div>` — with a
 * `Tags` row (case-insensitive) holding a comma-separated list of tag paths.
 * @param {string} html Raw DA source HTML for a page
 * @param {string} tagPath Exact tag path to look for, e.g. `Article Types/Race Recap`
 * @returns {boolean}
 */
function pageHasTag(html, tagPath) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const metadataBlock = doc.querySelector('.metadata');
  if (!metadataBlock) return false;

  return Array.from(metadataBlock.querySelectorAll(':scope > div')).some((row) => {
    const cells = row.querySelectorAll(':scope > div');
    const key = cells[0]?.textContent.trim().toLowerCase();
    if (key !== 'tags') return false;
    const value = cells[1]?.textContent || '';
    return value.split(',').map((v) => v.trim()).includes(tagPath);
  });
}

/**
 * Lazily crawls a site (or a subfolder of it) for pages whose metadata block
 * lists the given tag. Nothing runs until called — there's no background or
 * automatic indexing.
 * @param {Object} params
 * @param {string} params.org
 * @param {string} params.repo
 * @param {string} params.rootPath Site-relative subfolder to scope the crawl to, e.g. `/blog`
 * @param {string} params.tagPath Exact tag path to search for
 * @param {Function} [params.onProgress] Called with `{ checked, total, matched, failed }`
 *   after each page is checked
 * @returns {Promise<{ total: number, matches: string[], failed: number }>}
 */
export async function searchPagesForTag({
  org, repo, rootPath = '/', tagPath, onProgress,
}) {
  const scoped = rootPath === '/' ? '' : rootPath.replace(/\/$/, '');
  const files = [];

  const { results } = crawl({
    path: `/${org}/${repo}${scoped}`,
    callback: (file) => {
      if (file.path.endsWith('.html')) files.push(file);
    },
    throttle: CRAWL_THROTTLE,
  });
  await results;

  const orgRepoPrefix = new RegExp(`^/${org}/${repo}`);
  const matches = [];
  let checked = 0;
  let failed = 0;

  async function checkFile(file) {
    const relativePath = file.path.replace(orgRepoPrefix, '');
    try {
      const response = await daFetch(`${DA_ORIGIN}/source/${org}/${repo}${relativePath}`);
      if (!response.ok) {
        failed += 1;
        return;
      }
      const html = await response.text();
      if (pageHasTag(html, tagPath)) matches.push(relativePath);
    } catch {
      failed += 1;
    } finally {
      checked += 1;
      onProgress?.({
        checked, total: files.length, matched: matches.length, failed,
      });
    }
  }

  const queue = [...files];
  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await checkFile(file);
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));

  return { total: files.length, matches, failed };
}
