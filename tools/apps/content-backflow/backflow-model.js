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
export const MODES = ['add', 'update', 'mirror'];
export const EXCLUDED = ['/.da', '/drafts'];
export const CONCURRENCY = 5;

const MIME_TYPES = {
  html: 'text/html',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  txt: 'text/plain',
};

const TEXT_EXTENSIONS = ['html', 'json'];

/** Parse `/org/site` (or `org/site`) into `{ org, site }`; null when malformed. */
export function parseSite(value) {
  const parts = (value || '').trim().replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) return null;
  const [org, site] = parts;
  return { org, site };
}

export const formatSite = (location) => (location ? `/${location.org}/${location.site}` : '');

export const sameSite = (a, b) => a?.org === b?.org && a?.site === b?.site;

/** File extension of a path, lowercased; '' for none. */
export function ext(path) {
  const name = path.split('/').pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export const mimeType = (path) => MIME_TYPES[ext(path)] || 'application/octet-stream';

/** Docs and sheets: rewritten on copy and versioned before an overwrite. */
export const isText = (path) => TEXT_EXTENSIONS.includes(ext(path));

/** Whether `path` is `folder` or inside it. */
export function isWithin(path, folder) {
  if (folder === '/') return true;
  return path === folder || path.startsWith(`${folder}/`);
}

/** Never copied, overwritten or deleted. */
export const isExcluded = (path) => EXCLUDED.some((folder) => isWithin(path, folder));

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Point DA content/admin URLs and aem.page/live hosts at `target` instead of `source`. */
export function rewriteRefs(text, source, target) {
  const org = escape(source.org);
  const site = escape(source.site);
  const daUrl = new RegExp(`(https?://(?:content|admin)\\.da\\.live(?:/[a-z]+)?/)${org}/${site}(?![\\w.-])`, 'g');
  const aemHost = new RegExp(`(?<![\\w-])main--${site}--${org}\\.aem\\.(page|live)(?![\\w-])`, 'g');
  return text
    .replace(daUrl, `$1${target.org}/${target.site}`)
    .replace(aemHost, `main--${target.site}--${target.org}.aem.$1`);
}

/** Drop paths already covered by a selected ancestor folder. */
export function normalizeSelection(paths) {
  const unique = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
  return unique.filter((path) => !unique.some((other) => other !== path && isWithin(path, other)));
}

/**
 * One row per change: `create`, `skip` (add mode, target exists), `overwrite`, or (mirror)
 * `delete` for target files under a selected folder with no source counterpart.
 * `irreversible`: a binary overwrite (DA can't version it) or any delete.
 */
export function planCopy({
  sourceFiles, targetFiles, mode, selectedFolders = [],
}) {
  const source = new Set(sourceFiles.filter((path) => !isExcluded(path)));
  const target = new Set(targetFiles.filter((path) => !isExcluded(path)));
  const rows = [...source].map((path) => {
    let action = 'create';
    if (target.has(path)) action = mode === 'add' ? 'skip' : 'overwrite';
    return { path, action, irreversible: action === 'overwrite' && !isText(path) };
  });
  if (mode === 'mirror') {
    [...target]
      .filter((path) => !source.has(path))
      .filter((path) => selectedFolders.some((folder) => isWithin(path, folder)))
      .forEach((path) => rows.push({ path, action: 'delete', irreversible: true }));
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** Count rows per action, plus irreversible ones. */
export function summarize(rows) {
  const counts = {
    create: 0, skip: 0, overwrite: 0, delete: 0, irreversible: 0,
  };
  rows.forEach((row) => {
    counts[row.action] += 1;
    if (row.irreversible) counts.irreversible += 1;
  });
  return counts;
}

export const snapshotLabel = (source, date = new Date()) => `Content backflow from ${formatSite(source)} ${date.toISOString()}`;

/** The target's preview URL for a DA file: `.html` dropped, `index` is its folder. */
export function toAemUrl(path, { org, site }) {
  let aemPath = path;
  if (ext(path) === 'html') {
    aemPath = path.slice(0, -'.html'.length);
    if (aemPath.endsWith('/index')) aemPath = aemPath.slice(0, -'index'.length);
  }
  return `https://main--${site}--${org}.aem.page${aemPath}`;
}

/** A page's media folder (`/a/b.html` → `/a/.b`), which DA's list never shows; else null. */
export function mediaFolder(path) {
  if (ext(path) !== 'html') return null;
  const slash = path.lastIndexOf('/');
  return `${path.slice(0, slash)}/.${path.slice(slash + 1, -'.html'.length)}`;
}

/**
 * Every file in `paths` (folders recursively, pages with their media folders), skipping
 * excluded paths. Page media folders are listed last, so the total is known early.
 * @param {(path: string) => Promise<Array<{ path: string, isFolder: boolean }>>} list
 * @param {Array<{ path: string, isFolder: boolean }>} items selected files and folders
 * @param {(progress: { done: number, pending: number }) => void} [onProgress] after each batch
 * @param {number} [limit] concurrent list calls
 */
export async function expandSelection(list, items, onProgress = () => {}, limit = CONCURRENCY) {
  const files = new Set();
  const folders = [];
  const media = [];
  let done = 0;
  const add = (item) => {
    if (isExcluded(item.path)) return;
    if (item.isFolder) {
      folders.push(item.path);
      return;
    }
    files.add(item.path);
    const folder = mediaFolder(item.path);
    if (folder) media.push(folder);
  };
  items.forEach(add);
  while (folders.length || media.length) {
    const batch = (folders.length ? folders : media).splice(0, limit);
    // eslint-disable-next-line no-await-in-loop
    const listings = await Promise.all(batch.map((path) => list(path)));
    listings.flat().forEach(add);
    done += batch.length;
    onProgress({ done, pending: folders.length + media.length });
  }
  return [...files];
}

/** Run `worker` over `items`, at most `limit` at a time; settles every item, in order. */
export async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
