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
/* eslint-disable no-underscore-dangle, import/no-unresolved */
import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import {
  countChanges, filterSchemaOptions, getSchemaStatus, sortSchemaOptions,
} from './helpers/options.js';
import { SCHEMA_STATUSES, unsavedSchemaChanges } from '../utils/messages.js';
import { icon } from '../utils/icons.js';
import { listStyle, renderSortHeading } from '../shared/list/list.js';
import { renderStatusLight, statusLightStyle } from '../shared/status-light/status-light.js';

const [formStyle, buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/form.css'),
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-schemas-panel';

const DEFAULT_SORT = { key: 'title', direction: 'ascending' };

function renderStatus(option) {
  const kind = getSchemaStatus(option);
  if (!kind) return nothing;
  const { variant, label, title } = SCHEMA_STATUSES[kind];
  const issues = kind === 'invalid' && option.issues.join('\n');
  return renderStatusLight({ variant, label, title: issues || title });
}

const INTRO = html`
  <p class="intro">Select the Structured Content schemas whose content this endpoint can query.</p>`;

// The endpoint's schema selection as a list: each row's label toggles its checkbox. `query`
// comes from the screen's bar search. Emits `schemas-select` with { ids, selected }.
class SchemasPanel extends LitElement {
  static properties = {
    options: { attribute: false },
    query: { type: String },
    busy: { type: Boolean },
    schemaEditorHref: { type: String },
    _sort: { state: true },
  };

  constructor() {
    super();
    this.query = '';
    this._sort = DEFAULT_SORT;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [
      formStyle, buttonStyle, listStyle, statusLightStyle, style,
    ];
  }

  get visible() {
    const options = filterSchemaOptions({
      options: this.options,
      query: this.query,
      statusLabel: (option) => SCHEMA_STATUSES[getSchemaStatus(option)]?.label,
    });
    return sortSchemaOptions({ options, ...this._sort });
  }

  select({ ids, selected }) {
    const detail = { ids, selected };
    this.dispatchEvent(new CustomEvent('schemas-select', { detail, bubbles: true, composed: true }));
  }

  // Unusable schemas can only be deselected, so they count only when selected.
  renderSelectAll(visible) {
    const togglable = visible.filter((option) => option.usable || option.selected);
    const all = togglable.length > 0 && togglable.every((option) => option.selected);
    const some = togglable.some((option) => option.selected);
    const toggle = () => {
      const ids = togglable.filter((option) => option.usable || all).map((option) => option.id);
      this.select({ ids, selected: !all });
    };
    return html`
      <span class="nx-checkbox">
        <input type="checkbox" aria-label="Select all shown schemas"
          .checked=${all} .indeterminate=${some && !all}
          ?disabled=${this.busy || !togglable.length} @change=${toggle} />
      </span>`;
  }

  renderCount() {
    const { options } = this;
    const selected = options.filter((option) => option.selected).length;
    const changes = unsavedSchemaChanges(countChanges(options));
    const note = changes ? html` · <span class="changes">${changes}</span>` : nothing;
    return html`
      <p class="count muted">${selected} of ${options.length} selected${note}</p>`;
  }

  // Invalid schemas link to the Schema Editor, outside the row's label.
  renderEditorLink(option) {
    if (getSchemaStatus(option) !== 'invalid') return html`<span></span>`;
    return html`
      <a class="nx-action-btn-quiet nx-action-btn-icon" href=${this.schemaEditorHref}
        target="_blank" rel="noopener" title="Open in Schema Editor"
        aria-label="Open ${option.id} in Schema Editor">${icon({ name: 'openIn' })}</a>`;
  }

  renderRow(option) {
    const disabled = this.busy || (!option.usable && !option.selected);
    const title = option.title || option.id;
    return html`
      <li class="row ${disabled ? 'disabled' : ''}">
        <label class="row-link">
          <span class="nx-checkbox">
            <input type="checkbox" .checked=${option.selected} ?disabled=${disabled}
              @change=${({ target }) => this.select({ ids: [option.id], selected: target.checked })} />
          </span>
          <span class="row-title" title=${title}>${title}</span>
          <span class="row-text muted" title=${option.id}>${option.id}</span>
          <span class="row-status">${renderStatus(option)}</span>
        </label>
        ${this.renderEditorLink(option)}
      </li>`;
  }

  renderList(visible) {
    const heading = (key, label) => renderSortHeading({
      key, label, sort: this._sort, onSort: (sort) => { this._sort = sort; },
    });
    return html`
      <div class="list">
        <div class="list-head" role="group" aria-label="Sort by">
          ${this.renderSelectAll(visible)}
          ${heading('title', 'Title')}
          ${heading('id', 'ID')}
          ${heading('status', 'Status')}
        </div>
        <ul class="rows" aria-label="Schemas">${visible.map((option) => this.renderRow(option))}</ul>
      </div>`;
  }

  render() {
    if (!this.options.length) {
      return html`
        <div class="empty">
          <h2>No schemas yet</h2>
          <p>This site has no Structured Content schemas yet. Create one in the
            <a href=${this.schemaEditorHref} target="_blank" rel="noopener">Schema Editor</a>
            first.</p>
        </div>`;
    }
    const { visible } = this;
    const list = visible.length
      ? this.renderList(visible)
      : html`<div class="empty"><p>No schemas match "${this.query.trim()}".</p></div>`;
    return html`${INTRO}${this.renderCount()}${list}`;
  }
}

customElements.define(EL_NAME, SchemasPanel);
