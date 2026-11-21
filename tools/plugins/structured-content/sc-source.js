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

// Pure helpers for the structured content picker: where SC documents live,
// which schemas exist, and how to read an SC document's source HTML. No
// remote imports so everything here runs under `node --test`.
//
// SC document source shape (see adobe/da-sc-sdk src/html/html2json.js):
//   <main><div>
//     <div class="da-form"><div><div><p>x-schema-name</p></div><div><p>coffee</p></div></div></div>
//     <div class="coffee"><div><div><p>name</p></div><div><p>Morning Muse</p></div></div>...</div>
//     <div class="coffee self-ref-id">...</div>   (nested objects, referenced as self://#ref-id)
//   </div></main>

const DA_ADMIN = 'https://admin.da.live';
const AEM_API = 'https://api.aem.live';
export const SCHEMAS_FOLDER = '/.da/forms/schemas';
export const BLOCK_NAME = 'structured-content';
const SELF_REF = 'self://#';
const MAX_REF_DEPTH = 10;

// ──────────────────────────────────────────────
// Roots from the `editor.path` config entries
// ──────────────────────────────────────────────

function configRows(config) {
  if (!config) return [];
  if (Array.isArray(config.data)) return config.data; // single-sheet JSON
  if (Array.isArray(config.data?.data)) return config.data.data; // multi-sheet, "data" tab
  return [];
}

/**
 * Site-relative folders mapped to the structured content editor via
 * `editor.path` = `/<org>/<site>/<folder>=https://da.live/form#`.
 * Nested roots are collapsed into their ancestor.
 * @param {object[]} configs org and/or site config JSON
 * @param {string} org
 * @param {string} repo
 * @returns {string[]} e.g. ['/coffees', '/products'] ('' means the whole site)
 */
export function getEditorPathRoots(configs, org, repo) {
  const prefix = `/${org}/${repo}`;
  const roots = configs
    .flatMap(configRows)
    .filter((row) => row?.key === 'editor.path' && typeof row.value === 'string')
    .map((row) => {
      const eq = row.value.indexOf('=');
      if (eq < 0) return null;
      const folder = row.value.substring(0, eq).trim().replace(/\/$/, '');
      const editor = row.value.substring(eq + 1).trim();
      if (!editor.includes('/form')) return null;
      if (folder !== prefix && !folder.startsWith(`${prefix}/`)) return null;
      return folder.substring(prefix.length);
    })
    .filter((root) => root !== null);

  const unique = [...new Set(roots)].sort((a, b) => a.length - b.length);
  return unique.filter((root, i) => !unique
    .slice(0, i)
    .some((parent) => parent === '' || root.startsWith(`${parent}/`)));
}

/**
 * Reads org and site configs and returns the SC roots (empty if none configured).
 * @param {object} opts
 * @returns {Promise<string[]>}
 */
export async function fetchConfigRoots({
  org, repo, token, fetchFn = fetch,
}) {
  const headers = { Authorization: `Bearer ${token}` };
  const urls = [`${DA_ADMIN}/config/${org}/`, `${DA_ADMIN}/config/${org}/${repo}/`];
  const configs = await Promise.all(urls.map(async (url) => {
    try {
      const resp = await fetchFn(url, { headers, cache: 'no-store' });
      return resp.ok ? await resp.json() : null;
    } catch {
      return null;
    }
  }));
  return getEditorPathRoots(configs.filter(Boolean), org, repo);
}

// ──────────────────────────────────────────────
// Schemas and document source
// ──────────────────────────────────────────────

/**
 * Lists schema names stored under /.da/forms/schemas.
 * @param {Function} list lister from fragments/source.js createLister
 * @returns {Promise<string[]>}
 */
export async function listSchemas(list) {
  const { items } = await list(SCHEMAS_FOLDER);
  return items
    .filter((item) => item.ext === 'html')
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Source URL of a document.
 * @param {object} opts
 * @param {string} opts.path site-relative path without extension
 */
export function sourceUrl({
  org, repo, path, hlx6,
}) {
  return hlx6
    ? `${AEM_API}/${org}/sites/${repo}/source${path}.html`
    : `${DA_ADMIN}/source/${org}/${repo}${path}.html`;
}

/** Strips `/org/repo` and `.html` from a DA list item path. */
export function toSitePath(itemPath, org, repo) {
  const prefix = `/${org}/${repo}`;
  const path = itemPath.startsWith(prefix) ? itemPath.substring(prefix.length) : itemPath;
  return path.replace(/\.html$/, '');
}

export function previewUrl(org, repo, path) {
  return `https://main--${repo}--${org}.aem.page${path}`;
}

export function editorUrl(org, repo, path) {
  return `https://da.live/form#/${org}/${repo}${path}`;
}

// ──────────────────────────────────────────────
// Parsing (works on any DOM-like element: children, className, textContent)
// ──────────────────────────────────────────────

const kids = (el) => Array.from(el?.children ?? []);
const tag = (el) => (el?.tagName || '').toLowerCase();
const classes = (el) => (el?.className || '').split(/\s+/).filter(Boolean);

function selectBlocks(main) {
  return kids(main).filter((s) => tag(s) === 'div').flatMap((s) => kids(s).filter((b) => tag(b) === 'div'));
}

function typed(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  const num = Number(text);
  if (text !== '' && Number.isFinite(num) && String(num) === text) return num;
  return text;
}

function readBlock(blocks, block, depth) {
  const props = {};
  kids(block).forEach((row) => {
    const [keyCol, valCol] = kids(row);
    if (!valCol) return;
    const key = (keyCol.textContent || '').trim();
    if (!key) return;
    // eslint-disable-next-line no-use-before-define
    props[key] = readValue(blocks, valCol, depth);
  });
  const keys = Object.keys(props);
  return keys.length === 1 && keys[0] === '@items' ? props['@items'] : props;
}

function resolveRef(blocks, text, depth) {
  if (!text.startsWith(SELF_REF) || depth >= MAX_REF_DEPTH) return undefined;
  const refId = text.substring(SELF_REF.length).replaceAll('/', '-').toLowerCase();
  const block = blocks.find((b) => classes(b)[1]?.toLowerCase() === refId);
  return block ? readBlock(blocks, block, depth + 1) : undefined;
}

function readValue(blocks, valCol, depth) {
  const list = kids(valCol).find((c) => tag(c) === 'ul' || tag(c) === 'ol');
  if (list) {
    return kids(list).filter((li) => tag(li) === 'li').map((li) => {
      const text = (li.textContent || '').trim();
      return resolveRef(blocks, text, depth) ?? typed(text);
    });
  }
  const text = (valCol.textContent || '').trim();
  return resolveRef(blocks, text, depth) ?? typed(text);
}

function findRootBlock(blocks, name) {
  return blocks.find((b) => {
    const [first, second] = classes(b);
    return first?.toLowerCase() === name.toLowerCase() && !second;
  });
}

/**
 * Reads an SC document.
 * @param {Element} main the document's <main>
 * @returns {{schemaName: string, data: object}|null} null when not an SC document
 */
export function parseScDocument(main) {
  const blocks = selectBlocks(main);
  const form = findRootBlock(blocks, 'da-form');
  if (!form) return null;
  const meta = readBlock(blocks, form, 0);
  const schemaName = meta['x-schema-name'];
  if (!schemaName || typeof schemaName !== 'string') return null;
  const root = findRootBlock(blocks, schemaName);
  return { schemaName, data: root ? readBlock(blocks, root, 0) : {} };
}

/**
 * Flattens data into [path, value] rows for a key/value preview.
 * @param {*} value
 * @param {string} [prefix]
 * @returns {Array<[string, string]>}
 */
export function flattenForPreview(value, prefix = '') {
  if (Array.isArray(value)) {
    if (!value.length) return [[prefix, '']];
    return value.flatMap((item, i) => flattenForPreview(item, `${prefix}[${i}]`));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return prefix ? [[prefix, '']] : [];
    return entries.flatMap(([k, v]) => flattenForPreview(v, prefix ? `${prefix}.${k}` : k));
  }
  return [[prefix, value === undefined || value === null ? '' : String(value)]];
}

// ──────────────────────────────────────────────
// Scanning and insertion
// ──────────────────────────────────────────────

/**
 * Fetches and parses documents with bounded concurrency.
 * @param {object} opts
 * @param {string[]} opts.paths site-relative document paths
 * @param {(path: string) => Promise<{schemaName, data}|null>} opts.load
 * @param {number} [opts.concurrency]
 * @param {Function} [opts.onProgress] called with (done, total)
 * @returns {Promise<Array<{path, schemaName, data}>>} SC documents only
 */
export async function scanDocuments({
  paths, load, concurrency = 6, onProgress = () => {},
}) {
  const results = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next];
      next += 1;
      let doc = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        doc = await load(path);
      } catch {
        doc = null;
      }
      if (doc) results.push({ path, ...doc });
      done += 1;
      onProgress(done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Block table referencing an SC document, as DA renders authored blocks.
 * @param {string} url aem.page URL of the SC document
 */
export function buildBlockHtml(url) {
  const safe = escapeHtml(url);
  return `<table><tbody><tr><td>${BLOCK_NAME}</td></tr><tr><td><a href="${safe}">${safe}</a></td></tr></tbody></table>`;
}
