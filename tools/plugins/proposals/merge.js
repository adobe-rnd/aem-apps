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

const DA_METADATA_SELECTOR = 'body > .da-metadata';
const EMPTY_CONFIG = {};
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export const NOT_MERGEABLE = (what) => `${what} is not a page that can be merged.`;

export function elementMetadata(el) {
  if (!el) return {};
  return [...el.childNodes].reduce((rdx, row) => {
    if (row.children && row.children.length > 1) {
      const key = row.children[0].textContent.trim().toLowerCase();
      const content = row.children[1];
      if (key) rdx[key] = { content, text: content.textContent.trim().toLowerCase() };
    }
    return rdx;
  }, {});
}

const readMetadata = (el) => Object.fromEntries(Object.entries(elementMetadata(el))
  .map(([key, { content }]) => [key, content.innerHTML]));

const listOf = (el, key) => (elementMetadata(el)[key]?.text || '')
  .split(',').map((hash) => hash.trim()).filter(Boolean);

function sectionedMain(doc) {
  const main = doc?.querySelectorAll('main').length === 1 && doc.querySelector('body > main');
  const isText = (node) => node.nodeType === TEXT_NODE && node.textContent.trim();
  const isLoose = (node) => isText(node)
    || (node.nodeType === ELEMENT_NODE && (node.nodeName !== 'DIV' || [...node.childNodes].some(isText)));
  return main && ![...main.childNodes].some(isLoose) ? main : null;
}

export function buildPageHtml(content, daMetadata = {}) {
  const metadata = Object.entries(daMetadata)
    .map(([key, value]) => `<div><div>${key}</div><div>${value ?? ''}</div></div>`)
    .join('');
  return `
      <body>
        <header></header>
        <main>${content}</main>
        ${metadata ? `\n  <div class="da-metadata">${metadata}</div>\n` : ''}<footer></footer>
      </body>
    `;
}

export default function createMerger({
  engine, parse, store, site,
}) {
  const hashes = (doc) => engine.getBlockHashes({ doc, site, config: EMPTY_CONFIG });

  function readPage(html, what) {
    const doc = parse(html);
    if (!sectionedMain(doc)) throw new Error(NOT_MERGEABLE(what));
    const marked = !!doc.querySelector(engine.LOC_MARKERS);
    engine.removeLocTags(doc);
    return { doc, marked };
  }

  async function load(path, what) {
    const source = await store.readSource(path);
    if (!source) throw new Error(`${what} ${path} was not found.`);
    return source;
  }

  async function prepare({ draftPath, target, baseVersionId }) {
    if (!baseVersionId) throw new Error(`${target} has no base version, so it cannot be merged here.`);
    const [draft, current] = await Promise.all([load(draftPath, 'The draft'), load(target, 'The page')]);
    const source = readPage(draft.html, `The draft ${draftPath}`);
    const dest = readPage(current.html, `The page ${target}`);
    if (dest.marked) {
      throw new Error(`${target} still has unresolved change markers. Resolve them in the editor first.`);
    }
    const baseHtml = await store.readVersion(target, baseVersionId);
    const base = await hashes(readPage(baseHtml, `The base version of ${target}`).doc);
    const metadataEl = dest.doc.querySelector(DA_METADATA_SELECTOR);
    const metadata = readMetadata(metadataEl);
    const sourceHashes = await hashes(source.doc);
    if (sourceHashes.join() === base.join()) {
      return {
        unchanged: true, skipped: 0, current, metadata,
      };
    }
    const merged = await engine.smartMerge({
      base,
      source: source.doc,
      dest: dest.doc,
      rejected: listOf(metadataEl, 'rejectedhashes'),
      site,
      config: EMPTY_CONFIG,
    });
    return {
      unchanged: false,
      skipped: merged.skipped,
      page: buildPageHtml(merged.html, metadata),
      current,
      metadata,
    };
  }

  async function check(entry) {
    const { skipped, unchanged } = await prepare(entry);
    return { skipped, unchanged };
  }

  async function preview(entry) {
    const prepared = await prepare(entry);
    if (prepared.unchanged) return { unchanged: true, skipped: 0, differences: 0 };
    const upstream = parse(prepared.page);
    const local = readPage(prepared.current.html, `The page ${entry.target}`).doc;
    const diffed = await engine.regionalDiff(upstream, local, [], [], {
      site, config: EMPTY_CONFIG,
    });
    return {
      unchanged: false,
      skipped: prepared.skipped,
      differences: diffed.querySelectorAll(engine.LOC_MARKERS).length,
      html: buildPageHtml(diffed.innerHTML, prepared.metadata),
    };
  }

  async function merge(entry) {
    const prepared = await prepare(entry);
    if (prepared.unchanged) return { written: false, unchanged: true, skipped: 0 };
    await store.writeSource(entry.target, prepared.page, { ifMatch: prepared.current.etag });
    const label = `Merged from ${entry.draftPath}`;
    try {
      await store.createVersion(entry.target, label);
    } catch (error) {
      throw new Error(`${entry.target} was merged, but its version could not be saved: ${error.message}`);
    }
    return {
      written: true, unchanged: false, skipped: prepared.skipped, label,
    };
  }

  return { check, preview, merge };
}
