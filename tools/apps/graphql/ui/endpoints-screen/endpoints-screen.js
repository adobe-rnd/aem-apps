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
import { showToast, VARIANT_ERROR } from 'https://da.live/nx2/blocks/shared/toast/toast.js';
import { endpointDeleted } from '../utils/messages.js';
import { core } from '../../adapters/index.js';
import { icon } from '../utils/icons.js';
import { canvasStyle } from '../shared/canvas/canvas.js';
import { headerStyle, renderHeader } from '../header/header.js';
import { listStyle } from '../shared/list/list.js';
import { inlineAlertStyle, renderReadOnlyAlert } from '../shared/inline-alert/inline-alert.js';
import { DEFAULT_ENDPOINT_SORT, filterEndpoints, sortEndpoints } from './helpers/endpoints.js';
import 'https://da.live/nx2/blocks/shared/search/search.js';
import '../shared/sort-menu/sort-menu.js';
import '../endpoint-list/endpoint-list.js';

const buttonStyle = await loadStyle('https://da.live/nx2/styles/buttons.css');

const EL_NAME = 'gql-endpoints-screen';

const SORT_OPTIONS = [
  { key: 'name', direction: 'ascending', label: 'Name (A–Z)' },
  { key: 'name', direction: 'descending', label: 'Name (Z–A)' },
];

const countEndpoints = (count) => `${count} ${count === 1 ? 'endpoint' : 'endpoints'}`;

// The endpoint list screen. `site` is { org, site, endpoints, canWrite, serviceUrl? }.
// Emits `change-site`, `endpoints-change` (after a delete) and `route-change` (to a new endpoint).
class EndpointsScreen extends LitElement {
  static properties = {
    site: { attribute: false },
    _query: { state: true },
    _sort: { state: true },
    _sortStatus: { state: true },
    _busy: { state: true },
    _searchOpen: { state: true },
  };

  constructor() {
    super();
    this._query = '';
    this._sort = DEFAULT_ENDPOINT_SORT;
    this._sortStatus = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [
      buttonStyle, canvasStyle, headerStyle, listStyle, inlineAlertStyle,
    ];
  }

  get visibleEndpoints() {
    const endpoints = filterEndpoints({ endpoints: this.site.endpoints, query: this._query });
    return sortEndpoints({ endpoints, sort: this._sort });
  }

  // Announced once for the new order rather than per moved row.
  setSort(sort) {
    this._sort = sort;
    const label = SORT_OPTIONS.find((option) => option.key === sort.key
      && option.direction === sort.direction)?.label;
    this._sortStatus = `Sorted by ${label}, ${countEndpoints(this.visibleEndpoints.length)}`;
  }

  // On a narrow bar the search is a button until opened; empty, it closes when it loses focus.
  async openSearch() {
    this._searchOpen = true;
    await this.updateComplete;
    this.shadowRoot.querySelector('nx-search')?.focus();
  }

  closeSearch() {
    if (!this._query) this._searchOpen = false;
  }

  // Naming only starts an unsaved endpoint screen; nothing is saved until the user saves it.
  async handleNew() {
    if (this._busy || !this.site.canWrite) return;
    await import('../new-endpoint-dialog/new-endpoint-dialog.js');
    const dialog = this.shadowRoot.querySelector('gql-new-endpoint-dialog');
    const name = await dialog.ask({ existing: this.site.endpoints });
    if (!name) return;
    const { org, site } = this.site;
    const detail = { route: { org, site, endpoint: name }, isNew: true };
    this.dispatchEvent(new CustomEvent('route-change', { detail }));
  }

  async handleDelete(name) {
    if (this._busy || !this.site.canWrite) return;
    await import('../shared/confirm/confirm.js');
    const confirmed = await this.shadowRoot.querySelector('gql-confirm').ask({
      title: 'Delete endpoint?',
      body: html`<p>The <strong>${name}</strong> endpoint and its GraphQL schema will be
        permanently deleted. Client applications that query it will no longer be able to
        retrieve content.</p>`,
      confirmLabel: 'Delete',
      negative: true,
    });
    if (!confirmed || this._busy) return;
    this._busy = true;
    const { org, site } = this.site;
    const result = await core.deleteEndpoint({ org, site, name });
    this._busy = undefined;
    if (result.error) {
      showToast({ text: result.error, variant: VARIANT_ERROR });
      return;
    }
    const endpoints = this.site.endpoints.filter((endpoint) => endpoint !== name);
    this.dispatchEvent(new CustomEvent('endpoints-change', { detail: { endpoints } }));
    showToast({ text: endpointDeleted(name) });
  }

  renderControls() {
    if (!this.site.endpoints.length) return nothing;
    const open = this._searchOpen || !!this._query;
    return html`
      ${open ? nothing : html`
        <button type="button" class="nx-action-btn-quiet nx-action-btn-icon search-toggle"
          title="Search endpoints" aria-label="Search endpoints"
          @click=${this.openSearch}>${icon({ name: 'search' })}</button>`}
      <nx-search size="m" class=${open ? nothing : 'collapsed'} placeholder="Search endpoints"
        label="Search endpoints" .value=${this._query}
        @input=${({ target }) => { this._query = target.value ?? ''; }}
        @focusout=${this.closeSearch}>
      </nx-search>
      <gql-sort-menu .options=${SORT_OPTIONS} .sort=${this._sort}
        @sort-change=${({ detail }) => this.setSort(detail)}></gql-sort-menu>
      <span class="divider" aria-hidden="true"></span>`;
  }

  renderEmpty() {
    const { canWrite } = this.site;
    return html`
      <div class="empty">
        ${icon({ name: 'code', className: 'empty-icon' })}
        <h2>No endpoints yet</h2>
        <p>Endpoints serve the site's structured content through a GraphQL schema generated from
          its content schemas.</p>
        ${canWrite ? html`
          <div class="empty-actions">
            <button type="button" class="nx-btn-accent" ?disabled=${this._busy}
              @click=${this.handleNew}>New endpoint</button>
          </div>` : nothing}
      </div>`;
  }

  renderList() {
    if (!this.site.endpoints.length) return this.renderEmpty();
    const endpoints = this.visibleEndpoints;
    if (!endpoints.length) {
      return html`<div class="empty"><p>No endpoints match "${this._query}".</p></div>`;
    }
    const {
      org, site, canWrite, serviceUrl,
    } = this.site;
    return html`
      <gql-endpoint-list org=${org} site=${site} .endpoints=${endpoints}
        .serviceUrl=${serviceUrl} .sort=${this._sort}
        ?busy=${!!this._busy} ?readOnly=${!canWrite}
        @sort-change=${({ detail }) => this.setSort(detail)}
        @endpoint-delete=${({ detail }) => this.handleDelete(detail.endpoint)}>
      </gql-endpoint-list>`;
  }

  render() {
    const { org, site, canWrite } = this.site;
    const header = renderHeader({
      org,
      site,
      onChangeSite: () => this.dispatchEvent(new Event('change-site')),
      end: html`
        ${this.renderControls()}
        <button type="button" class="nx-btn-accent new-btn" ?disabled=${this._busy || !canWrite}
          @click=${this.handleNew}>New</button>`,
    });
    return html`
      ${header}
      <div class="content">
        <section class="page">
          ${canWrite ? nothing : renderReadOnlyAlert()}
          ${this.renderList()}
        </section>
      </div>
      <p class="sr-only" role="status">${this._sortStatus}</p>
      <gql-new-endpoint-dialog></gql-new-endpoint-dialog>
      <gql-confirm></gql-confirm>`;
  }
}

customElements.define(EL_NAME, EndpointsScreen);
