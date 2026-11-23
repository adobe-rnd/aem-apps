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
import { LitElement, html, nothing } from 'da-lit';
import { routeHash } from '../../core/routes.js';
import { icon } from '../shared/icons.js';
import {
  SchemaCatalog, DEFAULT_SORT, filterItems, sortItems, toggleSort,
} from '../../core/catalog.js';
import {
  buttons, shared, bar, loadStyle,
} from '../shared/styles.js';
import { relativeTime, plural, severityCount } from '../shared/format.js';
import { createPrompt, sitePrompt } from '../../core/prompts.js';
import {
  newSchemaItems, ROW_ITEMS, createSchema, duplicateSchema, copySchemaJson,
  deleteSchema,
} from './schema-actions.js';
import { getNx2 } from '../shared/nx.js';

const nx2 = getNx2();
await Promise.all([
  import(`${nx2}/blocks/shared/menu/menu.js`),
  import(`${nx2}/blocks/shared/popover/popover.js`),
  import(`${nx2}/blocks/shared/search/search.js`),
]);

// The schema list's sort orders, named for people, as on da.live browse: a Sort popover in the
// bar and sortable column headings. Sorting itself is `sortItems` (core/catalog.js).

const SORT_COLUMNS = {
  title: { label: 'Title', ascending: 'A-Z', descending: 'Z-A' },
  name: { label: 'Name', ascending: 'A-Z', descending: 'Z-A' },
  modified: { label: 'Modified', ascending: 'oldest first', descending: 'newest first' },
};

const SORT_OPTIONS = [
  ['title', 'ascending', 'Title (A-Z)'],
  ['title', 'descending', 'Title (Z-A)'],
  ['name', 'ascending', 'Name (A-Z)'],
  ['name', 'descending', 'Name (Z-A)'],
  ['modified', 'descending', 'Modified at (Newest)'],
  ['modified', 'ascending', 'Modified at (Oldest)'],
].map(([property, direction, label]) => ({ property, direction, label }));

/** "Title (A-Z)", "Modified (newest first)": the order a sort announces. */
const sortedBy = ({ property, direction }) => {
  const column = SORT_COLUMNS[property];
  return `${column.label} (${column[direction]})`;
};

const sameSort = (a, b) => a?.property === b?.property && a?.direction === b?.direction;

const style = await loadStyle(import.meta.url);

const SUMMARY_CONCURRENCY = 6;

/**
 * `<se-browse>`: lists one site's schemas and creates, duplicates and deletes them through the
 * catalog. With chat available, it offers a chat toggle and reloads the list after each
 * completed assistant turn.
 */
class SeBrowse extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    repository: { attribute: false },
    chat: { attribute: false },
    _status: { state: true },
    _error: { state: true },
    _items: { state: true },
    _summaries: { state: true },
    _query: { state: true },
    _sort: { state: true },
    _sortOpen: { state: true },
    _sortStatus: { state: true },
    _chatOpen: { state: true },
  };

  constructor() {
    super();
    this._items = [];
    this._summaries = new Map();
    this._query = '';
    this._sort = DEFAULT_SORT;
    this._sortStatus = '';
    this._loadId = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, bar, style];
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._loadId += 1;
    this._unsubscribeChat?.();
    this._unsubscribeChat = undefined;
  }

  willUpdate(changed) {
    if (changed.has('org') || changed.has('site') || changed.has('repository')) this._load();
    if (changed.has('chat')) this._subscribeChat();
  }

  _subscribeChat() {
    this._unsubscribeChat?.();
    this._unsubscribeChat = undefined;
    this._chatOpen = false;
    if (!this.chat?.available) return;
    const unsubscribers = [
      this.chat.onTurnCompleted(({ status } = {}) => {
        if (status === 'completed' && this._status !== 'loading') this._load({ quiet: true });
      }),
      this.chat.onVisibilityChange((open) => { this._chatOpen = open; }),
    ];
    this._unsubscribeChat = () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  get _names() {
    return this._items.map((item) => item.name);
  }

  /** `quiet` refreshes in place (no loading state; errors keep the list). */
  async _load({ quiet = false } = {}) {
    this._loadId += 1;
    const loadId = this._loadId;
    const { org, site, repository } = this;
    this._catalog = new SchemaCatalog({ org, site, repository });
    if (!quiet) {
      this._status = 'loading';
      this._summaries = new Map();
    }

    const {
      items, error, status, siteMissing,
    } = await this._catalog.list();
    if (loadId !== this._loadId) return;
    if (siteMissing) {
      this._items = [];
      this._status = 'missing';
      return;
    }
    if (error && quiet) return;
    if (error) {
      this._status = 'error';
      this._error = { message: error, status };
      return;
    }
    this._items = items;
    this._status = 'ready';
    this._loadSummaries(items, loadId);
  }

  async _loadSummaries(items, loadId) {
    const queue = [...items];
    const next = async () => {
      const item = queue.shift();
      if (!item || loadId !== this._loadId) return;
      const { summary, error } = await this._catalog.summary(item);
      if (loadId !== this._loadId) return;
      this._summaries = new Map(this._summaries).set(item.name, summary ?? { error });
      await next();
    };
    await Promise.all(Array.from({ length: SUMMARY_CONCURRENCY }, next));
  }

  _open(name) {
    window.location.hash = routeHash({ org: this.org, site: this.site, name });
  }

  _create(kind) {
    if (kind === 'ai') {
      this.chat.ask(createPrompt({ org: this.org, site: this.site }));
      return;
    }
    createSchema(this._catalog, {
      names: this._names, fromJson: kind === 'json', onCreated: (name) => this._open(name),
    });
  }

  async _delete(item) {
    const fields = this._summaries.get(item.name)?.fields ?? 1;
    if (await deleteSchema(this._catalog, item, { title: this._titleOf(item), fields })) {
      this._items = this._items.filter(({ name }) => name !== item.name);
    }
  }

  _onRowAction(item, id) {
    const actions = {
      open: () => this._open(item.name),
      duplicate: () => duplicateSchema(this._catalog, item, {
        title: this._titleOf(item), names: this._names, onCreated: (name) => this._open(name),
      }),
      copy: () => copySchemaJson(this._catalog, item),
      delete: () => this._delete(item),
    };
    actions[id]?.();
  }

  _titleOf(item) {
    return this._summaries.get(item.name)?.title || item.name;
  }

  _renderSummary(item) {
    const summary = this._summaries.get(item.name);
    if (!summary) return html`<span class="skeleton summary-skeleton" aria-hidden="true"></span>`;
    if (summary.error) return html`<span class="chip is-error">${icon('alert')} Can't read</span>`;
    const parts = [plural(summary.fields, 'field')];
    if (summary.components) parts.push(plural(summary.components, 'component'));
    let badge = nothing;
    if (summary.errors) {
      badge = html`<span class="chip is-error">${icon('alert')} ${severityCount('error', summary.errors)}</span>`;
    } else if (summary.warnings) {
      badge = html`<span class="chip is-warning">${icon('alert')}
        ${severityCount('warning', summary.warnings)}</span>`;
    }
    return html`<span class="muted">${parts.join(' · ')}</span>${badge}`;
  }

  _renderRow(item) {
    const href = routeHash({ org: this.org, site: this.site, name: item.name });
    return html`
      <li class="row">
        <a class="row-link" href=${href}>
          <span class="row-icon">${icon('schema')}</span>
          <span class="row-title">${this._titleOf(item)}</span>
          <span class="row-name muted">${item.name}</span>
          <span class="row-summary">${this._renderSummary(item)}</span>
          <span class="row-modified muted">${relativeTime(item.lastModified)}</span>
        </a>
        <nx-menu class="row-menu" placement="below-end" .items=${ROW_ITEMS}
          @select=${(e) => this._onRowAction(item, e.detail.id)}>
          <button slot="trigger" type="button" class="nx-action-btn-quiet nx-action-btn-icon"
            aria-label=${`Actions for ${item.name}`}>${icon('more')}</button>
        </nx-menu>
      </li>
    `;
  }

  /**
   * Title, Name and Modified headings sort the list (as on da.live browse). The rest is visual
   * only: each row's link already reads out every cell.
   */
  _renderTable(rows, busy = false) {
    return html`
      <div class="list">
        <div class="list-head" role="group" aria-label="Sort by">
          <span aria-hidden="true"></span>
          ${this._renderSortHeading('title', busy)}
          ${this._renderSortHeading('name', busy)}
          <span aria-hidden="true">Contents</span>
          ${this._renderSortHeading('modified', busy)}
        </div>
        <ul class="rows" aria-busy=${busy ? 'true' : nothing}
          aria-label=${busy ? 'Loading schemas' : 'Schemas'}>${rows}</ul>
      </div>
    `;
  }

  /** The arrow shows on the sorted column only; the button names its order for screen readers. */
  _renderSortHeading(property, disabled) {
    const column = SORT_COLUMNS[property];
    const direction = this._sort.property === property ? this._sort.direction : undefined;
    return html`
      <button type="button" class="sort-heading" ?disabled=${disabled}
        @click=${() => this._setSort(toggleSort(this._sort, property))}>
        <span>${column.label}${direction ? html`<span class="sr-only">, sorted ${column[direction]}</span>` : nothing}</span>
        <span class="sort-icon">${direction ? icon(direction === 'ascending' ? 'sortUp' : 'sortDown') : nothing}</span>
      </button>
    `;
  }

  /** Announces the new order once, not each moved row. */
  _setSort(sort) {
    this._sort = sort;
    const count = filterItems(this._items, this._query, this._summaries).length;
    this._sortStatus = `Sorted by ${sortedBy(sort)}, ${plural(count, 'schema')}`;
  }

  _renderList() {
    if (this._status === 'loading') {
      return this._renderTable([0, 1, 2, 3].map(() => html`
        <li class="row"><span class="skeleton row-skeleton"></span></li>`), true);
    }
    if (this._status === 'error') return this._renderError();
    if (this._status === 'missing') return this._renderSiteMissing();
    if (!this._items.length) return this._renderEmpty();

    const visible = sortItems(
      filterItems(this._items, this._query, this._summaries),
      this._sort,
      this._summaries,
    );
    if (!visible.length) {
      return html`<div class="empty"><p>No schemas match "${this._query}".</p></div>`;
    }
    return this._renderTable(visible.map((item) => this._renderRow(item)));
  }

  _renderEmpty() {
    return html`
      <div class="empty">
        ${icon('schema', 'empty-icon')}
        <h2>No schemas yet</h2>
        <p>Schemas define the fields authors fill in for structured content.</p>
        <div class="empty-actions">
          <button type="button" class="nx-btn-accent" @click=${() => this._create('blank')}>
            New schema
          </button>
          <button type="button" class="nx-action-btn" @click=${() => this._create('json')}>
            From JSON…
          </button>
          ${this.chat?.available ? html`
            <button type="button" class="nx-action-btn" @click=${() => this._create('ai')}>
              ${icon('ai')} With AI…
            </button>` : nothing}
        </div>
      </div>
    `;
  }

  _renderSiteMissing() {
    return html`
      <div class="empty" role="alert">
        ${icon('alert', 'empty-icon')}
        <h2>Site not found</h2>
        <p>No site was found at <strong>${this.org}/${this.site}</strong>. Check the organization
          and site names, or ask your administrator for access.</p>
        <button type="button" class="nx-action-btn"
          @click=${() => this.dispatchEvent(new Event('change-site'))}>Change site</button>
      </div>
    `;
  }

  _renderError() {
    const { status, message } = this._error ?? {};
    const denied = status === 401 || status === 403;
    const heading = denied
      ? `You don't have access to ${this.org}/${this.site}`
      : 'Couldn\'t load schemas';
    return html`
      <div class="empty" role="alert">
        ${icon('alert', 'empty-icon')}
        <h2>${heading}</h2>
        ${denied ? nothing : html`<p>${message}</p>`}
        <button type="button" class="nx-action-btn" @click=${() => this._load()}>Retry</button>
      </div>
    `;
  }

  /** Search and sort once there is a list to filter, ahead of New (as in da.live browse). */
  _renderControls() {
    if (this._status !== 'ready' || !this._items.length) return nothing;
    return html`
      <div class="tools">
        <nx-search size="m" placeholder="Search schemas" label="Search schemas" .value=${this._query}
          @input=${(e) => { this._query = e.target.value ?? ''; }}></nx-search>
        ${this._renderSort()}
        <span class="divider" aria-hidden="true"></span>
      </div>
    `;
  }

  /** As on da.live browse: a Sort button opening every order, the current one checked. */
  _renderSort() {
    const current = sortedBy(this._sort);
    return html`
      <button type="button" class="nx-action-btn-quiet sort-btn" title="Sorted by ${current}"
        aria-label="Sort: ${current}" aria-haspopup="dialog"
        aria-expanded=${this._sortOpen ? 'true' : 'false'} @click=${this._toggleSortPopover}>
        ${icon('sort')}<span class="wide">Sort</span>
      </button>
      <nx-popover class="sort-popover" role="dialog" aria-label="Sort"
        @close=${() => { this._sortOpen = false; }} @keydown=${this._onSortKeydown}>
        ${SORT_OPTIONS.map((option) => this._renderSortOption(option))}
      </nx-popover>
    `;
  }

  _renderSortOption(option) {
    const selected = sameSort(option, this._sort);
    return html`
      <button type="button" class="nx-action-btn-quiet sort-option"
        aria-pressed=${selected ? 'true' : 'false'} @click=${() => this._pickSort(option)}>
        ${icon('checkmark', selected ? '' : 'unchecked')}<span>${option.label}</span>
      </button>
    `;
  }

  async _toggleSortPopover({ currentTarget }) {
    const popover = this.shadowRoot.querySelector('.sort-popover');
    if (this._sortOpen) {
      popover.close();
      return;
    }
    this._sortOpen = true;
    popover.show({ anchor: currentTarget, placement: 'auto' });
    // nx-popover stays `visibility: hidden` until its positioning frame; focus after it.
    await popover.updateComplete;
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
    popover.querySelector('[aria-pressed="true"]')?.focus();
  }

  _pickSort({ property, direction }) {
    this._setSort({ property, direction });
    this._closeSortPopover();
  }

  _closeSortPopover() {
    this.shadowRoot.querySelector('.sort-popover')?.close();
    this.shadowRoot.querySelector('.sort-btn')?.focus();
  }

  _onSortKeydown = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    this._closeSortPopover();
  };

  /** No New on a site that doesn't exist: there is nowhere to create it. */
  _renderNew() {
    if (this._status === 'missing') return nothing;
    return html`
      <nx-menu placement="below-end" .items=${newSchemaItems(this.chat?.available)}
        @select=${(e) => this._create(e.detail.id)}>
        <button slot="trigger" type="button" class="nx-btn-accent new-btn" aria-label="New schema">
          New ${icon('chevronDown')}
        </button>
      </nx-menu>
    `;
  }

  /** Same toggle as the editor bar; hidden while the chat is open (on hosts that report it). */
  _renderChatToggle() {
    if (!this.chat?.available || this._chatOpen) return nothing;
    return html`
      <button type="button" class="nx-action-btn-icon" part="btn toggle-chat"
        aria-label="Open chat" title="Ask the assistant about these schemas"
        @click=${() => this.chat.ask(sitePrompt({ org: this.org, site: this.site }))}>${icon('chat')}</button>
      <span class="divider" aria-hidden="true"></span>
    `;
  }

  render() {
    const key = `${this.org}/${this.site}`;
    return html`
      <header class="bar">
        <div class="group group-start">
          ${this._renderChatToggle()}
          <span class="site" title=${key}>${key}</span>
          <button type="button" class="nx-action-btn-icon change-site"
            title="Change site (${key})" aria-label="Change site, ${key}"
            @click=${() => this.dispatchEvent(new Event('change-site'))}>${icon('edit')}</button>
          <span class="divider" aria-hidden="true"></span>
          <h1 class="title">Schemas</h1>
        </div>
        <div class="group group-end">
          ${this._renderControls()}
          ${this._renderNew()}
        </div>
      </header>
      <div class="content">
        <section class="browse">${this._renderList()}</section>
      </div>
      <p class="sr-only" role="status">${this._sortStatus}</p>
    `;
  }
}

if (!customElements.get('se-browse')) customElements.define('se-browse', SeBrowse);
