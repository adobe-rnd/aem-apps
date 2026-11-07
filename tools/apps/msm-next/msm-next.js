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
/* eslint-disable import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import createLoader from './data/loader.js';
import createMockLocalization from './data/mock/mock-localization.js';
import { MOCK_ORG, MOCK_SITE } from './data/mock/fixture.js';
import {
  flattenRows, visibleSet, matchesKind, matchesQuery, matchesType, countPages, ancestors,
  attentionList, nodeKey,
} from './data/tree.js';
import {
  needsAction, editUrl, reasonText, ACTION_LABELS,
} from './data/display.js';
import renderTreeTable from './views/tree-table.js';
import renderDetailPanel from './views/detail-panel.js';
import { pageLabel } from './views/common.js';

const NX = 'https://da.live/nx';
const SDK_TIMEOUT = 5000;
let styles = null;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  styles = await getStyle(import.meta.url);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

const CARDS = [
  { type: 'all', label: 'All pages' },
  { type: 'source', label: 'Sources' },
  { type: 'copies', label: 'Local copies & translations' },
  { type: 'inherited', label: 'Inherited' },
  { type: 'independent', label: 'Independent' },
];

const KINDS = [
  { kind: 'all', label: 'All' },
  { kind: 'localization', label: 'Localization' },
  { kind: 'variation', label: 'Variations' },
];

const ERROR_LABELS = {
  'action-unavailable': 'This action is not available for the page',
  'action-disabled': 'This action is disabled',
  'option-not-allowed': 'This option is not allowed here',
  'target-unreadable': 'The written page could not be read back',
  'remove-failed': 'The local copy could not be deleted',
};

const describeFailure = (result) => {
  const reasons = reasonText(result?.reasons);
  const base = ERROR_LABELS[result?.error] ?? result?.error ?? 'Something went wrong';
  return reasons ? `${base}: ${reasons}` : base;
};

class MsmNextApp extends LitElement {
  static properties = {
    localization: { attribute: false },
    org: { attribute: false },
    site: { attribute: false },
    mode: { attribute: false },
    notice: { attribute: false },
    phase: { state: true },
    error: { state: true },
    tick: { state: true },
    query: { state: true },
    needsActionOnly: { state: true },
    kind: { state: true },
    type: { state: true },
    expanded: { state: true },
    selectedKey: { state: true },
    focusKey: { state: true },
    busy: { state: true },
    toast: { state: true },
    confirm: { state: true },
  };

  constructor() {
    super();
    this.phase = 'loading';
    this.tick = 0;
    this.query = '';
    this.needsActionOnly = false;
    this.kind = 'all';
    this.type = 'all';
    this.expanded = new Set();
    this.busy = new Set();
  }

  connectedCallback() {
    super.connectedCallback();
    if (styles) this.shadowRoot.adoptedStyleSheets = [styles];
    this.loader = createLoader({
      localization: this.localization,
      list: this.localization.list,
      site: this.site,
      onChange: () => { this.tick += 1; },
    });
    this.unsubscribe = this.localization.subscribe?.(
      (page) => this.refreshKey(nodeKey(page.site, page.path)),
    );
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  async load() {
    this.phase = 'loading';
    this.error = '';
    try {
      const tree = await this.loader.load();
      if (!tree) return;
      if (!this.expanded.size && tree.top[0]) this.expanded = new Set([tree.top[0].key]);
      this.phase = tree.nodes.size ? 'ready' : 'empty';
    } catch (e) {
      console.error(e);
      this.error = e.message || String(e);
      this.phase = 'error';
    }
  }

  refreshKey(key) {
    const node = this.loader.tree.nodes.get(key);
    if (node) this.loader.refreshSubtree(node);
  }

  get tree() { return this.loader.tree; }

  get results() { return this.loader.results; }

  showToast(message, tone = 'neutral') {
    this.toast = { message, tone };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; }, 6000);
  }

  filtering() {
    return Boolean(this.query.trim()) || this.needsActionOnly
      || this.kind !== 'all' || this.type !== 'all';
  }

  predicate() {
    return (node) => {
      const result = this.results.get(node.key);
      return matchesQuery(node, this.query)
        && matchesKind(node, this.kind)
        && matchesType(result, this.type)
        && (!this.needsActionOnly || needsAction(result));
    };
  }

  visibleRows() {
    if (!this.filtering()) {
      return { rows: flattenRows(this.tree.top, { expanded: this.expanded }), matches: null };
    }
    const { visible, matches } = visibleSet(this.tree, this.predicate());
    const rows = flattenRows(this.tree.top, {
      expanded: this.expanded, visible, forceExpand: true,
    });
    return { rows, matches };
  }

  toggle(node) {
    const expanded = new Set(this.expanded);
    if (expanded.has(node.key)) expanded.delete(node.key);
    else expanded.add(node.key);
    this.expanded = expanded;
  }

  select(node, reveal = false) {
    this.selectedKey = node.key;
    this.focusKey = node.key;
    this.confirm = null;
    if (reveal) {
      const expanded = new Set(this.expanded);
      ancestors(this.tree.nodes, node).forEach((ancestor) => expanded.add(ancestor.key));
      this.expanded = expanded;
      this.updateComplete.then(() => this.focusRow(node.key, false));
    }
  }

  focusRow(key, focus = true) {
    const row = this.shadowRoot.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    if (focus) row.focus();
  }

  moveFocus(key) {
    this.focusKey = key;
    this.updateComplete.then(() => this.focusRow(key));
  }

  handleKeydown(event, rows) {
    const index = rows.findIndex((row) => row.node.key === this.focusKey);
    const row = rows[index];
    if (!row) return;
    const { node } = row;
    const go = (target) => {
      if (!target) return;
      event.preventDefault();
      this.moveFocus(target.node.key);
    };
    switch (event.key) {
      case 'ArrowDown': go(rows[index + 1]); break;
      case 'ArrowUp': go(rows[index - 1]); break;
      case 'Home': go(rows[0]); break;
      case 'End': go(rows[rows.length - 1]); break;
      case 'ArrowRight':
        event.preventDefault();
        if (row.hasChildren && !row.expanded) this.toggle(node);
        else if (row.expanded) go(rows[index + 1]);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.expanded && !this.filtering()) this.toggle(node);
        else if (node.parent) this.moveFocus(node.parent);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.select(node);
        break;
      default:
    }
  }

  async withBusy(node, task) {
    if (this.busy.has(node.key)) return;
    this.busy = new Set([...this.busy, node.key]);
    try {
      await task();
    } catch (e) {
      console.error(e);
      this.showToast(e.message || String(e), 'negative');
    } finally {
      const busy = new Set(this.busy);
      busy.delete(node.key);
      this.busy = busy;
    }
    await this.loader.refreshSubtree(node);
  }

  runAction(node, { action, option, label }) {
    return this.withBusy(node, async () => {
      const result = await this.localization.execute({
        site: node.site, path: node.path, action, option,
      });
      const name = label ?? ACTION_LABELS[action] ?? action;
      if (result?.ok) this.showToast(`${name}: ${pageLabel(node)} (${node.path}) done`, 'positive');
      else this.showToast(`${name} failed. ${describeFailure(result)}`, 'negative');
    });
  }

  runNext(node, step) {
    if (step.kind === 'review') {
      if (this.localization.resolveReview) {
        this.withBusy(node, async () => {
          await this.localization.resolveReview(node.site, node.path);
          this.showToast(`Mock: changes on ${node.path} reviewed and accepted`, 'positive');
        });
        return;
      }
      window.open(editUrl(this.org, node.site, node.path), '_blank', 'noopener');
      return;
    }
    this.runAction(node, step);
  }

  publish(node, cascade) {
    return this.withBusy(node, async () => {
      const result = await this.localization.publish({ site: node.site, path: node.path, cascade });
      const count = result?.results?.length ?? 0;
      if (result?.ok) {
        this.showToast(`Published ${count} page${count === 1 ? '' : 's'}`, 'positive');
      } else {
        const failed = (result?.results ?? []).filter((entry) => !entry.ok);
        this.showToast(`Publish failed for ${failed.length} of ${count}: ${failed[0]?.error ?? ''}`, 'negative');
      }
    });
  }

  renderHeader() {
    return html`
      <header class="app-header">
        <div class="title-group">
          <h1>Multi-site Management</h1>
          <p class="app-context">
            <span>${this.org}</span><span aria-hidden="true">/</span><strong>${this.site}</strong>
            ${this.mode === 'mock' ? html`<span class="badge informative">Mock data</span>` : nothing}
          </p>
        </div>
        <button type="button" class="btn" ?disabled=${this.phase === 'loading'} @click=${() => this.load()}>Refresh</button>
      </header>
      ${this.notice ? html`<p class="app-notice">${this.notice}</p>` : nothing}`;
  }

  renderBanner(counts) {
    const total = this.tree.nodes.size;
    const checking = counts.loaded < total;
    if (!counts.needsAction && !checking) return nothing;
    return html`
      <section class="banner ${counts.needsAction ? 'notice' : ''}" aria-label="Needs action">
        ${counts.needsAction ? html`<span class="banner-icon" aria-hidden="true">!</span>` : html`<span class="spinner"></span>`}
        <p class="banner-text">
          ${counts.needsAction ? html`<span><strong>${counts.needsAction}</strong> ${counts.needsAction === 1 ? 'page needs' : 'pages need'} action</span>` : nothing}
          ${checking ? html`<span class="banner-progress" role="status">Checking status ${counts.loaded} of ${total}…</span>` : nothing}
        </p>
        ${counts.needsAction ? html`
          <button type="button" class="btn ${this.needsActionOnly ? '' : 'notice-btn'}" aria-pressed=${String(this.needsActionOnly)}
            @click=${() => { this.needsActionOnly = !this.needsActionOnly; }}>
            ${this.needsActionOnly ? 'Show all pages' : 'Show pages needing action'}
          </button>` : nothing}
      </section>`;
  }

  renderCards(counts) {
    return html`
      <div class="cards" role="group" aria-label="Filter by page type">
        ${CARDS.map((card) => html`
          <button type="button" class="card ${this.type === card.type ? 'active' : ''}"
            aria-pressed=${String(this.type === card.type)}
            @click=${() => { this.type = card.type; }}>
            <span class="card-count">${counts[card.type]}</span>
            <span class="card-label">${card.label}</span>
          </button>`)}
      </div>`;
  }

  renderToolbar() {
    return html`
      <div class="toolbar">
        <label class="search">
          <span class="visually-hidden">Search pages</span>
          <input type="search" placeholder="Search pages, paths or languages" .value=${this.query}
            @input=${(event) => { this.query = event.target.value; }}>
        </label>
        <div class="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed="true">Tree</button>
          <button type="button" aria-pressed="false" aria-disabled="true" title="Map view coming soon">Map</button>
        </div>
        ${this.filtering() ? html`
          <button type="button" class="btn quiet" @click=${() => this.clearFilters()}>Clear filters</button>` : nothing}
        <span class="spacer"></span>
        <div class="segmented" role="group" aria-label="Location kind">
          ${KINDS.map((entry) => html`
            <button type="button" aria-pressed=${String(this.kind === entry.kind)}
              @click=${() => { this.kind = entry.kind; }}>${entry.label}</button>`)}
        </div>
      </div>`;
  }

  clearFilters() {
    this.query = '';
    this.needsActionOnly = false;
    this.kind = 'all';
    this.type = 'all';
  }

  renderWorkspace() {
    const { rows, matches } = this.visibleRows();
    if (!rows.some((row) => row.node.key === this.focusKey) && rows[0]) {
      this.focusKey = rows[0].node.key;
    }
    const selected = this.selectedKey ? this.tree.nodes.get(this.selectedKey) : null;
    const ctx = {
      results: this.results,
      errors: this.loader.errors,
      refreshing: this.loader.refreshing,
      busy: this.busy,
      selectedKey: this.selectedKey,
      focusKey: this.focusKey,
      rootSite: this.site,
      org: this.org,
      matches,
      confirm: this.confirm,
      publishState: this.localization.publishState,
      emptyMessage: this.filtering() ? 'No pages match these filters.' : 'No pages found.',
      attention: selected ? attentionList(selected, this.results) : [],
      onToggle: (node) => this.toggle(node),
      onSelect: (node, reveal) => this.select(node, reveal),
      onNext: (node, step) => this.runNext(node, step),
      onAction: (node, button) => this.runAction(node, button),
      onPublish: (node, cascade) => this.publish(node, cascade),
      onConfirm: (confirm) => { this.confirm = confirm; },
      onKeydown: (event) => this.handleKeydown(event, rows),
    };
    return html`
      <div class="workspace">
        <section class="table-wrap" aria-label="Tree view">${renderTreeTable(rows, ctx)}</section>
        <aside class="detail" aria-label="Page details">${renderDetailPanel(selected, ctx)}</aside>
      </div>`;
  }

  renderBody() {
    if (this.phase === 'error') {
      return html`<div class="state error-text" role="alert">Could not load: ${this.error}</div>`;
    }
    if (this.phase === 'loading') {
      return html`<div class="state"><span class="spinner"></span> Loading locations and pages…</div>`;
    }
    if (this.phase === 'empty') {
      return html`<div class="state">No localization locations are configured for <strong>${this.site}</strong>.</div>`;
    }
    const counts = countPages(this.tree, this.results, this.kind);
    return html`
      ${this.renderBanner(counts)}
      ${this.renderCards(counts)}
      ${this.renderToolbar()}
      ${this.renderWorkspace()}`;
  }

  render() {
    return html`
      ${this.renderHeader()}
      ${this.renderBody()}
      <div class="toast-region" role="status" aria-live="polite">
        ${this.toast ? html`<div class="toast ${this.toast.tone}">${this.toast.message}
          <button type="button" class="toast-close" aria-label="Dismiss" @click=${() => { this.toast = null; }}>×</button></div>` : nothing}
      </div>`;
  }
}

customElements.define('msm-next-app', MsmNextApp);

const timeout = (ms) => new Promise((resolve) => { setTimeout(() => resolve(null), ms); });

async function resolveSetup() {
  const params = new URLSearchParams(window.location.search);
  const mockSetup = (notice) => ({
    mode: 'mock',
    org: MOCK_ORG,
    site: MOCK_SITE,
    localization: createMockLocalization(),
    notice,
  });
  if (params.get('mock') === '1') return mockSetup();
  if (window.self === window.top) return mockSetup('Not running inside DA, so this shows mock data. Open the app from da.live to see real content.');
  const sdk = await Promise.race([DA_SDK, timeout(SDK_TIMEOUT)]);
  if (!sdk?.actions?.daFetch) return mockSetup('DA did not respond, so this shows mock data.');
  const org = params.get('org') || sdk.context?.org;
  const site = params.get('site') || sdk.context?.repo;
  if (!org || !site) return mockSetup('No org or site in the DA context, so this shows mock data.');
  const { default: createRealLocalization } = await import('./data/real-localization.js');
  return {
    mode: 'real',
    org,
    site,
    localization: createRealLocalization({ org, actions: sdk.actions }),
  };
}

(async function init() {
  const setup = await resolveSetup();
  const app = document.createElement('msm-next-app');
  Object.assign(app, setup);
  document.body.append(app);
}());
