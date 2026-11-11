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
import { icon, iconFile } from '../shared/icons.js';
import {
  SchemaCatalog, SORTS, filterItems, sortItems,
} from '../../core/catalog.js';
import { deriveSchemaName } from '../../core/model/keys.js';
import { buttons, shared, loadStyle } from '../shared/styles.js';
import { relativeTime, plural } from '../shared/format.js';
import { confirmDialog } from '../shared/confirm.js';
import { toast as showToast } from '../shared/toast.js';
import { createPrompt } from '../../core/prompts.js';
import { schemaDialog } from './schema-dialog.js';

await Promise.all([
  import('https://da.live/nx2/blocks/shared/menu/menu.js'),
  import('https://da.live/nx2/blocks/shared/search/search.js'),
]);

const style = await loadStyle(import.meta.url);

const SUMMARY_CONCURRENCY = 6;
const OLD_EDITOR = 'https://da.live/apps/schema';

const NEW_ITEMS = [
  {
    id: 'blank', label: 'Blank', icon: iconFile('add'), description: 'Start from an empty schema.',
  },
  {
    id: 'json',
    label: 'From JSON Schema…',
    icon: iconFile('code'),
    description: 'Paste an existing schema definition.',
  },
];

const AI_ITEM = {
  id: 'ai', label: 'With AI…', icon: iconFile('ai'), description: 'Describe it to the assistant.',
};

const ROW_ITEMS = [
  { id: 'open', label: 'Open', icon: iconFile('edit') },
  { id: 'duplicate', label: 'Duplicate…', icon: iconFile('duplicate') },
  { id: 'copy', label: 'Copy JSON', icon: iconFile('code') },
  { id: 'old', label: 'Open in old editor', icon: iconFile('schema') },
  { divider: true },
  { id: 'delete', label: 'Delete…', icon: iconFile('delete') },
];

const SORT_ITEMS = Object.entries(SORTS).map(([id, label]) => ({ id, label }));

function toast(message, variant) {
  showToast({ message, variant });
}

/**
 * `<se-browse>`: lists one site's schemas and creates, duplicates and deletes them through the
 * catalog. With chat available, the list reloads after each completed assistant turn.
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
  };

  constructor() {
    super();
    this._items = [];
    this._summaries = new Map();
    this._query = '';
    this._sort = 'modified';
    this._loadId = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
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
    this._unsubscribeChat = this.chat?.available
      ? this.chat.onTurnCompleted(({ status } = {}) => {
        if (status === 'completed' && this._status !== 'loading') this._load({ quiet: true });
      })
      : undefined;
  }

  get _newItems() {
    return this.chat?.available ? [...NEW_ITEMS, AI_ITEM] : NEW_ITEMS;
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

    const { items, error, status } = await this._catalog.list();
    if (loadId !== this._loadId) return;
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
    const fromJson = kind === 'json';
    schemaDialog({
      title: fromJson ? 'New schema from JSON Schema' : 'New schema',
      confirmLabel: 'Create',
      existingNames: this._names,
      withJson: fromJson,
      initialTitle: fromJson ? '' : 'Untitled',
      onSubmit: async ({ title, name, json }) => {
        const result = await this._catalog.create({ name, title: title || 'Untitled', json });
        if (result.ok) this._open(name);
        return result;
      },
    });
  }

  _duplicate(item) {
    schemaDialog({
      title: `Duplicate "${this._titleOf(item)}"`,
      confirmLabel: 'Duplicate',
      existingNames: this._names,
      withTitle: false,
      initialName: deriveSchemaName(`${item.name} copy`, this._names),
      onSubmit: async ({ name }) => {
        const result = await this._catalog.duplicate({ from: item.name, name });
        if (result.ok) this._open(name);
        return result;
      },
    });
  }

  async _copyJson(item) {
    const { raw, error } = await this._catalog.rawJson(item);
    if (error) {
      toast(`Couldn't read "${item.name}": ${error}`, 'negative');
      return;
    }
    try {
      await navigator.clipboard.writeText(raw);
      toast('Schema JSON copied.', 'positive');
    } catch {
      toast('Couldn\'t access the clipboard.', 'negative');
    }
  }

  async _delete(item) {
    const fields = this._summaries.get(item.name)?.fields ?? 1;
    const confirmed = await confirmDialog({
      title: `Delete "${this._titleOf(item)}"?`,
      message: `Documents that use "${item.name}" will no longer open in the form editor.`,
      confirmLabel: 'Delete',
      destructive: true,
      requireText: fields > 0 ? item.name : undefined,
    });
    if (!confirmed) return;
    const { ok, error } = await this._catalog.remove(item);
    if (!ok) {
      toast(`Couldn't delete "${item.name}": ${error}`, 'negative');
      return;
    }
    this._items = this._items.filter(({ name }) => name !== item.name);
    toast(`Deleted "${item.name}".`, 'positive');
  }

  _onRowAction(item, id) {
    const actions = {
      open: () => this._open(item.name),
      duplicate: () => this._duplicate(item),
      copy: () => this._copyJson(item),
      old: () => window.open(`${OLD_EDITOR}#/${this.org}/${this.site}`, '_blank', 'noopener'),
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
      badge = html`<span class="chip is-error">${icon('alert')} ${plural(summary.errors, 'error')}</span>`;
    } else if (summary.warnings) {
      badge = html`<span class="chip is-warning">${icon('alert')}
        ${plural(summary.warnings, 'warning')}</span>`;
    }
    return html`<span class="muted">${parts.join(' · ')}</span>${badge}`;
  }

  _renderRow(item) {
    const href = routeHash({ org: this.org, site: this.site, name: item.name });
    return html`
      <li class="row">
        <a class="row-link" href=${href}>
          <span class="row-icon">${icon('schema')}</span>
          <span class="row-names">
            <span class="row-title">${this._titleOf(item)}</span>
            <span class="row-name muted">${item.name}</span>
          </span>
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

  _renderList() {
    if (this._status === 'loading') {
      return html`
        <ul class="list" aria-busy="true" aria-label="Loading schemas">
          ${[0, 1, 2, 3].map(() => html`
            <li class="row"><span class="skeleton row-skeleton"></span></li>`)}
        </ul>
      `;
    }
    if (this._status === 'error') return this._renderError();
    if (!this._items.length) return this._renderEmpty();

    const visible = sortItems(
      filterItems(this._items, this._query, this._summaries),
      this._sort,
      this._summaries,
    );
    if (!visible.length) {
      return html`<div class="empty"><p>No schemas match "${this._query}".</p></div>`;
    }
    return html`<ul class="list">${visible.map((item) => this._renderRow(item))}</ul>`;
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

  _renderToolbar() {
    if (this._status !== 'ready' || !this._items.length) return nothing;
    return html`
      <div class="toolbar">
        <nx-search placeholder="Search schemas" label="Search schemas" .value=${this._query}
          @input=${(e) => { this._query = e.target.value ?? ''; }}></nx-search>
        <nx-menu placement="below-end" .items=${SORT_ITEMS}
          @select=${(e) => { this._sort = e.detail.id; }}>
          <button slot="trigger" type="button" class="nx-action-btn-quiet">
            Sort: ${SORTS[this._sort]} ${icon('chevronDown')}
          </button>
        </nx-menu>
      </div>
    `;
  }

  render() {
    return html`
      <section class="browse">
        <header class="header">
          <div>
            <p class="eyebrow">Schemas</p>
            <h1>${this.org} / ${this.site}</h1>
          </div>
          <nx-menu placement="below-end" .items=${this._newItems}
            @select=${(e) => this._create(e.detail.id)}>
            <button slot="trigger" type="button" class="nx-btn-accent">
              ${icon('add')} New schema
            </button>
          </nx-menu>
        </header>
        ${this._renderToolbar()}
        ${this._renderList()}
      </section>
    `;
  }
}

if (!customElements.get('se-browse')) customElements.define('se-browse', SeBrowse);
