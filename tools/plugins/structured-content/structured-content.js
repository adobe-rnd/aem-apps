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
// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

import { isHlx6, createLister, crawlHtml } from '../fragments/source.js';
import {
  fetchConfigRoots, listSchemas, sourceUrl, toSitePath, previewUrl, editorUrl,
  parseScDocument, flattenForPreview, scanDocuments, buildBlockHtml,
} from './sc-source.js';

const state = {
  context: null,
  actions: null,
  docsBySchema: new Map(),
  selected: null,
};

const $ = (selector) => document.querySelector(selector);

function setStatus(text, { error = false, loading = false } = {}) {
  const el = $('.sc-status');
  el.textContent = text;
  el.classList.toggle('error', error);
  el.classList.toggle('loading', loading);
}

function renderPreview(doc) {
  const { org, repo } = state.context;
  const tbody = $('.sc-fields tbody');
  const title = doc?.path.split('/').pop() || 'Select a document';
  $('.sc-preview-title').textContent = title;
  $('.sc-insert').disabled = !doc;
  $('.sc-open').classList.toggle('hidden', !doc);
  $('.sc-placeholder').classList.toggle('hidden', !!doc);
  $('.sc-fields').classList.toggle('hidden', !doc);
  tbody.replaceChildren();
  if (!doc) return;

  $('.sc-open').href = editorUrl(org, repo, doc.path);
  const rows = flattenForPreview(doc.data);
  if (!rows.length) rows.push(['(no data)', '']);
  rows.forEach(([key, value]) => {
    const tr = document.createElement('tr');
    const k = document.createElement('td');
    const v = document.createElement('td');
    k.textContent = key;
    v.textContent = value;
    tr.append(k, v);
    tbody.append(tr);
  });
}

function select(doc, button) {
  state.selected = doc;
  document.querySelectorAll('.sc-list button').forEach((b) => b.setAttribute('aria-selected', 'false'));
  button?.setAttribute('aria-selected', 'true');
  renderPreview(doc);
}

function renderList() {
  const schema = $('.sc-schema').value;
  const filter = $('.sc-search').value.trim().toLowerCase();
  const docs = (state.docsBySchema.get(schema) || [])
    .filter((doc) => !filter || doc.path.toLowerCase().includes(filter));
  const list = $('.sc-list');
  list.replaceChildren();
  select(null);

  docs.forEach((doc) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-selected', 'false');
    const name = document.createElement('span');
    name.textContent = doc.path.split('/').pop();
    const path = document.createElement('span');
    path.className = 'sc-path';
    path.textContent = doc.path;
    button.append(name, path);
    button.addEventListener('click', () => select(doc, button));
    button.addEventListener('dblclick', () => { select(doc, button); $('.sc-insert').click(); });
    li.append(button);
    list.append(li);
  });

  if (schema) setStatus(docs.length ? '' : 'No documents for this schema.');
}

function renderSchemas(schemaNames) {
  const selectEl = $('.sc-schema');
  const names = [...new Set([...schemaNames, ...state.docsBySchema.keys()])]
    .sort((a, b) => a.localeCompare(b));
  selectEl.replaceChildren(new Option(names.length ? 'Choose a schema…' : 'No schemas found', ''));
  names.forEach((name) => {
    const count = state.docsBySchema.get(name)?.length || 0;
    selectEl.append(new Option(`${name} (${count})`, name));
  });
  selectEl.disabled = !names.length;
  $('.sc-search').disabled = !names.length;
}

function insert() {
  const doc = state.selected;
  if (!doc) return;
  if (!state.actions?.sendHTML) {
    setStatus('Cannot insert: editor not available.', { error: true });
    return;
  }
  const { org, repo } = state.context;
  state.actions.sendHTML(buildBlockHtml(previewUrl(org, repo, doc.path)));
  state.actions.closeLibrary?.();
}

async function load() {
  const { context, token, actions } = await DA_SDK;
  state.context = context;
  state.actions = actions;
  const { org, repo } = context;
  const headers = { Authorization: `Bearer ${token}` };

  setStatus('Reading configuration…', { loading: true });
  const hlx6 = await isHlx6(org, repo);
  const list = createLister({
    org, repo, token, hlx6,
  });
  const [configRoots, schemaNames] = await Promise.all([
    fetchConfigRoots({ org, repo, token }),
    listSchemas(list).catch(() => []),
  ]);
  // No editor.path configured: crawl the whole site.
  const roots = configRoots.length ? configRoots : [''];

  setStatus(`Listing documents in ${roots.map((r) => r || '/').join(', ')}…`, { loading: true });
  const files = (await Promise.all(roots.map((root) => crawlHtml(list, org, repo, root)))).flat();
  const paths = [...new Set(files.map((f) => toSitePath(f.path, org, repo)))]
    .filter((path) => !path.split('/').some((seg) => seg.startsWith('.') || seg === 'drafts'));

  const parser = new DOMParser();
  const docs = await scanDocuments({
    paths,
    load: async (path) => {
      const resp = await fetch(sourceUrl({
        org, repo, path, hlx6,
      }), { headers });
      if (!resp.ok) return null;
      const html = parser.parseFromString(await resp.text(), 'text/html');
      return parseScDocument(html.querySelector('main'));
    },
    onProgress: (done, total) => setStatus(`Reading documents ${done}/${total}…`, { loading: true }),
  });

  docs.forEach((doc) => {
    if (!state.docsBySchema.has(doc.schemaName)) state.docsBySchema.set(doc.schemaName, []);
    state.docsBySchema.get(doc.schemaName).push(doc);
  });
  renderSchemas(schemaNames);
  setStatus(docs.length ? 'Choose a schema.' : 'No structured content documents found.');
}

(async function init() {
  $('.sc-schema').addEventListener('change', renderList);
  $('.sc-search').addEventListener('input', renderList);
  $('.sc-insert').addEventListener('click', insert);
  try {
    await load();
  } catch (error) {
    setStatus(`Failed to load structured content: ${error.message}`, { error: true });
  }
}());
