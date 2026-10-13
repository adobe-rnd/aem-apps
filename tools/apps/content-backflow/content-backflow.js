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
/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  listFolder, readSource, writeSource, snapshotSource, deleteSource,
} from './api.js';
import {
  MODES, CONCURRENCY, parseSite, formatSite, sameSite, isExcluded, isText, isWithin, mimeType,
  rewriteRefs, normalizeSelection, planCopy, summarize, snapshotLabel, toAemUrl, mediaFolder,
  expandSelection, runPool,
} from './backflow-model.js';

// daFetch ensures a fresh IMS token is used on every request (handles token expiry)
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

const NX = 'https://da.live/nx2';
let nexter = null;
let sl = null;
let styles = null;
try {
  const [{ default: getStyle }, { loadStyle, getColorScheme }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);
  document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
  await Promise.all([
    loadStyle(`${NX}/styles/styles.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);
  await import(`${NX}/public/sl/components.js`);
  [nexter, sl, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

const STORAGE_KEY = 'content-backflow-location';

const STEPS = [
  { id: 'select', label: 'Choose content' },
  { id: 'review', label: 'Review' },
  { id: 'run', label: 'Copy' },
];

const MODE_LABELS = {
  add: {
    title: 'Add new only',
    hint: 'Copy only files the target doesn\'t have yet. Nothing is overwritten.',
  },
  update: {
    title: 'Update',
    hint: 'Also overwrite existing files. Pages and sheets are versioned first.',
  },
  mirror: {
    title: 'Mirror',
    hint: 'Update, then delete files in the selected folders that aren\'t in the source.',
  },
};

const ACTION_LABELS = {
  create: 'New', overwrite: 'Overwrite', delete: 'Delete', skip: 'Skip',
};

const RESULT_LABELS = {
  pending: 'Waiting', done: 'Done', error: 'Failed', skipped: 'Not run',
};

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'create', label: 'New', test: (row) => row.action === 'create' },
  { id: 'overwrite', label: 'Overwrite', test: (row) => row.action === 'overwrite' },
  { id: 'delete', label: 'Delete', test: (row) => row.action === 'delete' },
  { id: 'skip', label: 'Skip', test: (row) => row.action === 'skip' },
  { id: 'irreversible', label: 'Can\'t be undone', test: (row) => row.irreversible },
];

const WRITES = ['create', 'overwrite'];

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

class ContentBackflowApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    _state: { state: true },
    _sourceValue: { state: true },
    _targetValue: { state: true },
    _source: { state: true },
    _target: { state: true },
    _message: { state: true },
    _step: { state: true },
    _mode: { state: true },
    _folders: { state: true },
    _expanded: { state: true },
    _selected: { state: true },
    _rows: { state: true },
    _confirmed: { state: true },
    _filter: { state: true },
    _pending: { state: true },
    _results: { state: true },
    _deletesSkipped: { state: true },
    _fallbackUrls: { state: true },
    _scan: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);

    this._state = 'idle';
    this._source = null;
    this._target = null;
    this._message = null;
    this._mode = 'add';
    this.resetSelection();

    const params = new URLSearchParams(window.location.search);
    const stored = ContentBackflowApp.readStorage();
    const { org, repo } = this.context || {};
    const paramSource = params.get('org') && params.get('site')
      ? `/${params.get('org')}/${params.get('site')}` : '';
    const contextSource = org && repo ? `/${org}/${repo}` : '';
    this._sourceValue = paramSource || stored.source || contextSource;
    this._targetValue = params.get('target') || stored.target || '';

    const source = parseSite(this._sourceValue);
    const target = parseSite(this._targetValue);
    if (source && target && !sameSite(source, target)) this.load(source, target);
  }

  static readStorage() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  persistLocation(source, target) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('org', source.org);
      url.searchParams.set('site', source.site);
      url.searchParams.set('target', formatSite(target));
      window.history.replaceState(null, '', url);
    } catch (e) {
      console.warn('[content-backflow] updating URL failed:', e);
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        source: formatSite(source), target: formatSite(target),
      }));
    } catch (e) {
      console.warn('[content-backflow] persisting to localStorage failed:', e);
    }
  }

  resetSelection() {
    this._step = 'select';
    this._folders = new Map();
    this._expanded = new Set();
    this._selected = new Map();
    this._rows = [];
    this._confirmed = false;
    this._filter = 'all';
    this._pending = false;
    this._results = new Map();
    this._deletesSkipped = false;
    this._fallbackUrls = '';
    this._scan = null;
  }

  // ---- Loading ----

  handleLoadClick() {
    const source = parseSite(this.shadowRoot.querySelector('#source-input')?.value);
    const target = parseSite(this.shadowRoot.querySelector('#target-input')?.value);
    if (!source || !target) {
      this._message = { type: 'error', text: 'Enter source and target as /org/site.' };
      return;
    }
    if (sameSite(source, target)) {
      this._message = { type: 'error', text: 'Source and target must be different sites.' };
      return;
    }
    this.load(source, target);
  }

  async load(source, target) {
    this._state = 'loading';
    this._message = null;
    this._source = source;
    this._target = target;
    this._sourceValue = formatSite(source);
    this._targetValue = formatSite(target);
    this.resetSelection();
    this.persistLocation(source, target);

    try {
      const items = await this.list(source, '/');
      this.setFolder('/', { items: items.filter((item) => !isExcluded(item.path)) });
      this._state = 'loaded';
    } catch (e) {
      this._state = 'error';
      this._message = { type: 'error', text: `Failed to load ${formatSite(source)} (${e.message}).` };
    }
  }

  list(location, path) {
    return listFolder({ ...location, path }, daFetch);
  }

  // ---- Tree ----

  async loadFolder(path) {
    if (this._folders.get(path)?.items) return;
    this.setFolder(path, { loading: true });
    try {
      const items = (await this.list(this._source, path)).filter((item) => !isExcluded(item.path));
      this.setFolder(path, { items });
    } catch {
      this.setFolder(path, { error: true });
    }
  }

  setFolder(path, state) {
    this._folders = new Map(this._folders).set(path, state);
  }

  toggleFolder(item) {
    const expanded = new Set(this._expanded);
    if (expanded.delete(item.path)) {
      this._expanded = expanded;
      return;
    }
    expanded.add(item.path);
    this._expanded = expanded;
    this.loadFolder(item.path);
  }

  // A selected ancestor folder already includes this item.
  isImplied(path) {
    return [...this._selected.keys()].some((other) => other !== path && isWithin(path, other));
  }

  toggleSelected(item, checked) {
    const selected = new Map(this._selected);
    if (checked) selected.set(item.path, item);
    else selected.delete(item.path);
    this._selected = selected;
  }

  // ---- Review ----

  async review() {
    if (!this._selected.size || this._pending) return;
    this._pending = true;
    this._rows = [];
    this._confirmed = false;
    this._filter = 'all';
    this._message = { type: 'info', text: `Comparing ${formatSite(this._source)} with ${formatSite(this._target)}…` };
    try {
      this._rows = await this.plan();
      this._step = 'review';
      this._message = this._rows.some((row) => row.action !== 'skip')
        ? null
        : { type: 'warning', text: 'Nothing to copy.' };
      await this.updateComplete;
      this.shadowRoot.querySelector('#review-heading')?.focus();
    } catch {
      this._message = { type: 'error', text: 'The changes could not be worked out. Try again.' };
    } finally {
      this._pending = false;
      this._scan = null;
    }
  }

  // Progress for one of the two scans, each half the bar. The target scan follows the
  // source structure, so the source's folder count sizes it. The bar never moves back.
  scanning(half, estimate = 0) {
    this._scan ??= 0;
    const progress = { done: 0 };
    progress.update = ({ done, pending }) => {
      progress.done = done;
      const value = (half + done / Math.max(estimate, done + pending, 1)) / 2;
      this._scan = Math.max(this._scan ?? 0, value);
    };
    return progress;
  }

  async plan() {
    const selection = normalizeSelection([...this._selected.keys()])
      .map((path) => this._selected.get(path));
    const folderItems = selection.filter((item) => item.isFolder);
    const fileItems = selection.filter((item) => !item.isFolder);
    const listSource = (path) => this.list(this._source, path);
    const listTarget = (path) => this.list(this._target, path);

    const sourceScan = this.scanning(0);
    const sourceFiles = await expandSelection(listSource, selection, sourceScan.update);
    const parents = [...new Set(fileItems.map((item) => item.path.replace(/\/[^/]*$/, '') || '/'))];
    const targetScan = this.scanning(1, sourceScan.done);
    const listings = await runPool(parents, CONCURRENCY, listTarget);
    const listed = new Set(listings.flatMap((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value.map((item) => item.path);
    }));
    const pageMedia = sourceFiles.map(mediaFolder).filter(Boolean)
      .map((path) => ({ path, isFolder: true }));
    const targetFiles = await expandSelection(listTarget, [
      ...folderItems,
      ...fileItems.filter((item) => listed.has(item.path)),
      ...pageMedia,
    ], targetScan.update);
    const selectedFolders = [
      ...folderItems.map((item) => item.path),
      ...fileItems.map((item) => mediaFolder(item.path)).filter(Boolean),
    ];
    return planCopy({
      sourceFiles, targetFiles, mode: this._mode, selectedFolders,
    });
  }

  get counts() {
    return summarize(this._rows);
  }

  get workCount() {
    const { counts } = this;
    return counts.create + counts.overwrite + counts.delete;
  }

  get runDisabled() {
    return this._pending || !this.workCount
      || (this.counts.irreversible > 0 && !this._confirmed);
  }

  // ---- Run ----

  setResult(path, result) {
    this._results = new Map(this._results).set(path, result);
  }

  async copyFile(row, label) {
    const { path } = row;
    const source = this._source;
    const content = await readSource({ ...source, path }, daFetch);
    const text = isText(path) ? rewriteRefs(await content.text(), source, this._target) : null;
    const blob = new Blob([text ?? content], { type: mimeType(path) });
    const location = { ...this._target, path };
    if (row.action === 'overwrite' && isText(path)) {
      await snapshotSource(location, label, daFetch).catch(() => {
        throw new Error('Could not save a version first, so the file was not overwritten.');
      });
    }
    await writeSource(location, blob, daFetch);
  }

  async runRows(rows, task) {
    await runPool(rows, CONCURRENCY, async (row) => {
      try {
        await task(row);
        this.setResult(row.path, { state: 'done' });
      } catch (error) {
        this.setResult(row.path, { state: 'error', error: error.message });
      }
    });
  }

  async run() {
    if (this.runDisabled) return;
    this._pending = true;
    this._step = 'run';
    this._deletesSkipped = false;
    this._fallbackUrls = '';
    const work = this._rows.filter((row) => row.action !== 'skip');
    this._results = new Map(work.map((row) => [row.path, { state: 'pending' }]));
    this._message = { type: 'info', text: 'Copying… Keep this page open.' };
    const label = snapshotLabel(this._source);
    const writes = work.filter((row) => WRITES.includes(row.action));
    await this.runRows(writes, (row) => this.copyFile(row, label));
    const deletes = work.filter((row) => row.action === 'delete');
    if (this.errors.length) {
      deletes.forEach((row) => this.setResult(row.path, { state: 'skipped' }));
      this._deletesSkipped = deletes.length > 0;
    } else {
      const remove = (row) => deleteSource({ ...this._target, path: row.path }, daFetch);
      await this.runRows(deletes, remove);
    }
    this._pending = false;
    const { length } = this.errors;
    this._message = length
      ? { type: 'error', text: `Finished with ${plural(length, 'error')}.` }
      : { type: 'success', text: `Done. ${plural(this.doneCount, 'file')} changed.` };
  }

  get errors() {
    return [...this._results].filter(([, result]) => result.state === 'error');
  }

  get doneCount() {
    return [...this._results.values()].filter((result) => result.state !== 'pending').length;
  }

  get copiedUrls() {
    return this._rows
      .filter((row) => WRITES.includes(row.action) && this._results.get(row.path)?.state === 'done')
      .map((row) => toAemUrl(row.path, this._target));
  }

  async copyUrls() {
    const urls = this.copiedUrls;
    const text = urls.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this._fallbackUrls = '';
      this._message = { type: 'success', text: `${plural(urls.length, 'URL')} copied.` };
    } catch {
      this._fallbackUrls = text;
      this._message = { type: 'error', text: 'The URLs could not be copied automatically.' };
      await this.updateComplete;
      this.shadowRoot.querySelector('#fallback-urls')?.select();
    }
  }

  startOver() {
    this._step = 'select';
    this._rows = [];
    this._results = new Map();
    this._selected = new Map();
    this._confirmed = false;
    this._fallbackUrls = '';
    this._message = null;
  }

  goTo(step) {
    if (this._pending || step === this._step || step === 'run' || this._step === 'run') return;
    if (step === 'review' && !this._rows.length) return;
    this._step = step;
    this._message = null;
  }

  // ---- Render: toolbar ----

  renderToolbar() {
    const busy = this._state === 'loading' || this._pending;
    const onEnter = (e) => { if (e.key === 'Enter') this.handleLoadClick(); };
    return html`
      <div class="cb-toolbar">
        <header class="cb-toolbar-header">
          <h1 class="cb-title">Content Backflow</h1>
          <p class="cb-intro">
            Copy pages, sheets and media from one site to another, e.g. from production to a
            lower environment. Drafts and DA settings are never copied, changed or deleted.
            Nothing is previewed or published.
          </p>
        </header>
        <div class="cb-site-form">
          <label class="cb-field">
            <span>Source</span>
            <sl-input id="source-input" type="text" placeholder="/org/site" autocomplete="off"
              .value=${this._sourceValue} @keydown=${onEnter}></sl-input>
          </label>
          <label class="cb-field">
            <span>Target</span>
            <sl-input id="target-input" type="text" placeholder="/org/site" autocomplete="off"
              .value=${this._targetValue} @keydown=${onEnter}></sl-input>
          </label>
          <sl-button class="pw-fill-accent" @click=${() => this.handleLoadClick()} ?disabled=${busy}>
            ${this._state === 'loading' ? 'Loading…' : 'Load'}
          </sl-button>
        </div>
      </div>
    `;
  }

  renderLoading() {
    return html`
      <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
        <div class="cb-spinner" aria-hidden="true"></div>
        <p class="loading-label">Loading…</p>
      </div>
    `;
  }

  renderMessage() {
    if (!this._message) return nothing;
    return html`
      <div class="message ${this._message.type}" role="status" aria-live="polite">
        <span>${this._message.text}</span>
      </div>
    `;
  }

  renderStep(step, index, current) {
    const disabled = this._step === 'run' || step.id === 'run' || step.id === this._step
      || (step.id === 'review' && !this._rows.length);
    return html`
      <li class=${index < current ? 'is-done' : ''}>
        <button type="button" class="cb-step"
          aria-current=${this._step === step.id ? 'step' : 'false'}
          ?disabled=${disabled}
          @click=${() => this.goTo(step.id)}>
          <span class="cb-step-number" aria-hidden="true">${index + 1}</span>
          <span>${step.label}</span>
        </button>
      </li>
    `;
  }

  renderStepper() {
    const current = STEPS.findIndex((step) => step.id === this._step);
    return html`
      <nav class="cb-stepper" aria-label="Steps">
        <ol>${STEPS.map((step, index) => this.renderStep(step, index, current))}</ol>
      </nav>
    `;
  }

  // ---- Render: select ----

  renderFolder(path) {
    const folder = this._folders.get(path);
    if (!folder || folder.loading) return html`<p class="cb-tree-note">Loading…</p>`;
    if (folder.error) return html`<p class="cb-tree-note is-error">This folder could not be loaded.</p>`;
    if (!folder.items.length) return html`<p class="cb-tree-note">Empty folder</p>`;
    return html`
      <ul class="cb-tree" role="list">
        ${folder.items.map((item) => this.renderItem(item))}
      </ul>
    `;
  }

  renderItem(item) {
    const { name, path, isFolder } = item;
    const open = this._expanded.has(path);
    const implied = this.isImplied(path);
    return html`
      <li>
        <div class="cb-tree-row">
          ${isFolder ? html`
            <button type="button" class="cb-toggle" aria-expanded=${String(open)}
              aria-label="${open ? 'Collapse' : 'Expand'} ${name}"
              @click=${() => this.toggleFolder(item)}>${open ? '−' : '+'}</button>
          ` : html`<span class="cb-toggle" aria-hidden="true"></span>`}
          <label>
            <input type="checkbox" .checked=${implied || this._selected.has(path)} ?disabled=${implied}
              aria-label="Select ${path}"
              @change=${(e) => this.toggleSelected(item, e.target.checked)}>
            <span class="cb-item-name ${isFolder ? 'is-folder' : ''}">${name}</span>
          </label>
        </div>
        ${isFolder && open ? this.renderFolder(path) : nothing}
      </li>
    `;
  }

  renderSelect() {
    return html`
      <section class="cb-section" aria-labelledby="tree-heading">
        <fieldset class="cb-modes">
          <legend>When a file already exists</legend>
          ${MODES.map((mode) => html`
            <label class="cb-mode ${this._mode === mode ? 'is-selected' : ''}">
              <input type="radio" name="mode" value=${mode} .checked=${this._mode === mode}
                @change=${() => { this._mode = mode; }}>
              <span>
                <strong>${MODE_LABELS[mode].title}</strong>
                <span class="cb-muted">${MODE_LABELS[mode].hint}</span>
              </span>
            </label>
          `)}
        </fieldset>
        <div class="cb-section-title">
          <h2 id="tree-heading" tabindex="-1">Content in ${formatSite(this._source)}</h2>
          ${this._selected.size ? html`<span class="cb-badge">${this._selected.size} selected</span>` : nothing}
        </div>
        <p class="cb-muted">A selected folder includes everything in it. Pages include their media.</p>
        <div class="cb-panel cb-tree-panel">${this.renderFolder('/')}</div>
      </section>
    `;
  }

  // ---- Render: review ----

  renderActionLabel(action) {
    return html`<span class="cb-action cb-action-${action}">${ACTION_LABELS[action]}</span>`;
  }

  filterCount(filter) {
    return filter === 'all' ? this._rows.length : this.counts[filter];
  }

  async onFilterKeyDown(e, filters) {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    const ids = filters.map((filter) => filter.id);
    const index = (ids.indexOf(this._filter) + delta + ids.length) % ids.length;
    this._filter = ids[index];
    await this.updateComplete;
    this.shadowRoot.querySelector(`#filter-${this._filter}`)?.focus();
  }

  renderRows(rows, cell) {
    return html`
      <table class="cb-rows">
        <thead><tr><th scope="col">File</th><th scope="col">Change</th></tr></thead>
        <tbody>
          ${rows.map((row) => html`<tr><td class="cb-path">${row.path}</td><td>${cell(row)}</td></tr>`)}
        </tbody>
      </table>
    `;
  }

  renderReview() {
    const { counts } = this;
    const filters = FILTERS.filter((filter) => filter.id === 'all' || this.filterCount(filter.id));
    const active = FILTERS.find((filter) => filter.id === this._filter) || FILTERS[0];
    const rows = this._rows.filter(active.test);
    return html`
      <section class="cb-section" aria-labelledby="review-heading">
        <div class="cb-section-title">
          <h2 id="review-heading" tabindex="-1">Changes to ${formatSite(this._target)}</h2>
        </div>
        <p class="cb-muted">
          ${counts.create} new, ${counts.overwrite} overwritten, ${counts.delete} deleted, ${counts.skip} skipped
        </p>
        ${counts.irreversible ? html`
          <label class="cb-confirm message warning">
            <input type="checkbox" .checked=${this._confirmed}
              @change=${(e) => { this._confirmed = e.target.checked; }}>
            <span>I understand ${plural(counts.irreversible, 'change')} can't be undone.</span>
          </label>
        ` : nothing}
        <div class="cb-tabs" role="tablist" aria-label="Show changes">
          ${filters.map((filter) => html`
            <button id="filter-${filter.id}" type="button" role="tab" class="cb-tab"
              aria-selected=${String(filter.id === this._filter)} aria-controls="review-panel"
              tabindex=${filter.id === this._filter ? '0' : '-1'}
              @click=${() => { this._filter = filter.id; }}
              @keydown=${(e) => this.onFilterKeyDown(e, filters)}>
              ${filter.label} <span class="cb-tab-count">${this.filterCount(filter.id)}</span>
            </button>
          `)}
        </div>
        <div id="review-panel" role="tabpanel" aria-labelledby="filter-${this._filter}">
          ${this.renderRows(rows, (row) => html`
            ${this.renderActionLabel(row.action)}
            ${row.irreversible ? html`<span class="cb-badge">Can't be undone</span>` : nothing}
          `)}
        </div>
      </section>
    `;
  }

  // ---- Render: run ----

  renderRun() {
    const work = this._rows.filter((row) => row.action !== 'skip');
    const { errors } = this;
    return html`
      <section class="cb-section" aria-labelledby="run-heading">
        <div class="cb-section-title">
          <h2 id="run-heading" tabindex="-1">Copying to ${formatSite(this._target)}</h2>
        </div>
        <progress class="cb-progress" max=${work.length} .value=${this.doneCount}></progress>
        <p class="cb-muted">${this.doneCount} of ${work.length} done</p>
        ${this._deletesSkipped ? html`
          <p class="message warning">Deletes were not run because some files failed to copy.</p>
        ` : nothing}
        ${errors.length ? html`
          <div class="cb-panel cb-errors">
            <h3>Failed (${errors.length})</h3>
            <ul>${errors.map(([path, result]) => html`<li><span class="cb-path">${path}</span>: ${result.error}</li>`)}</ul>
          </div>
        ` : nothing}
        ${!this._pending && this.copiedUrls.length ? html`
          <p class="cb-muted">
            Copy the URLs and paste them into
            <a href="https://da.live/apps/bulk" target="_blank" rel="noopener">Bulk Operations</a>
            to preview or publish them.
          </p>
        ` : nothing}
        ${this._fallbackUrls ? html`
          <label class="cb-field cb-run-urls">
            <span>Copy these URLs:</span>
            <sl-textarea id="fallback-urls" readonly .value=${this._fallbackUrls}></sl-textarea>
          </label>
        ` : nothing}
        ${this.renderRows(work, (row) => this.renderResult(row))}
      </section>
    `;
  }

  renderResult(row) {
    const state = this._results.get(row.path)?.state || 'pending';
    return html`
      ${this.renderActionLabel(row.action)}
      <span class="cb-result cb-result-${state}">${RESULT_LABELS[state]}</span>
    `;
  }

  // ---- Render: actions ----

  renderActions() {
    if (this._step === 'select') {
      return html`
        <sl-button class="pw-fill-accent" @click=${() => this.review()}
          ?disabled=${!this._selected.size || this._pending}>
          ${this._pending ? 'Comparing…' : 'Review changes'}
        </sl-button>
      `;
    }
    if (this._step === 'review') {
      return html`
        <sl-button class="pw-quiet-secondary" @click=${() => this.goTo('select')}>Back</sl-button>
        <sl-button class="pw-fill-accent" @click=${() => this.run()} ?disabled=${this.runDisabled}>
          Copy ${plural(this.workCount, 'file')}
        </sl-button>
      `;
    }
    return html`
      <sl-button class="pw-quiet-secondary" @click=${() => this.startOver()} ?disabled=${this._pending}>
        Start over
      </sl-button>
      <sl-button class="pw-fill-accent" @click=${() => this.copyUrls()}
        ?disabled=${this._pending || !this.copiedUrls.length}>
        Copy URLs
      </sl-button>
    `;
  }

  renderWizard() {
    const body = {
      select: () => this.renderSelect(),
      review: () => this.renderReview(),
      run: () => this.renderRun(),
    }[this._step]();
    return html`
      <div class="cb-wizard">
        ${this.renderStepper()}
        <div class="cb-step-body" .inert=${this._pending}>${body}</div>
        <div class="cb-footer">
          <div class="cb-footer-status">
            ${this.renderMessage()}
            ${this._scan != null ? html`
              <progress class="cb-progress" aria-label="Comparing sites" .value=${this._scan}></progress>
            ` : nothing}
          </div>
          <div class="cb-actions">${this.renderActions()}</div>
        </div>
      </div>
    `;
  }

  // ---- Render: top-level ----

  render() {
    return html`
      ${this.renderToolbar()}
      ${this._state === 'loading' ? this.renderLoading() : nothing}
      ${this._state === 'idle' || this._state === 'error' ? this.renderMessage() : nothing}
      ${this._state === 'loaded' ? this.renderWizard() : nothing}
    `;
  }
}

customElements.define('content-backflow-app', ContentBackflowApp);

(async function init() {
  const { context, token } = await DA_SDK;
  const cmp = document.createElement('content-backflow-app');
  cmp.context = context;
  cmp.token = token;
  document.body.append(cmp);
}());
