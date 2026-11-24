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
/* eslint-disable import/no-unresolved */
import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { showToast, VARIANT_ERROR } from 'https://da.live/nx2/blocks/shared/toast/toast.js';
import { getEndpointPath, getEndpointUrl } from '../../core/endpoint.js';
import { buildHash, getGraphiqlHref } from '../utils/route.js';
import { icon } from '../utils/icons.js';
import { listStyle, renderSortHeading } from '../shared/list/list.js';
import 'https://da.live/nx2/blocks/shared/menu/menu.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-endpoint-list';

const OPEN = { id: 'open', label: 'Open' };
const GRAPHIQL = { id: 'graphiql', label: 'Open in GraphiQL' };
const COPY = { id: 'copy', label: 'Copy endpoint URL' };
const DELETE = { id: 'delete', label: 'Delete…' };

async function copyEndpoint(href) {
  try {
    await navigator.clipboard.writeText(href);
    showToast({ text: 'Endpoint copied.' });
  } catch {
    showToast({ text: 'The endpoint could not be copied.', variant: VARIANT_ERROR });
  }
}

// Renders `endpoints` as given (the screen filters and sorts them). The Name heading emits
// `sort-change`; a row's Delete… emits `endpoint-delete` for the screen to confirm.
class EndpointList extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    endpoints: { attribute: false },
    serviceUrl: { type: String },
    sort: { attribute: false },
    busy: { type: Boolean },
    readOnly: { type: Boolean },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, listStyle, style];
  }

  get menuItems() {
    const items = this.serviceUrl ? [OPEN, COPY, GRAPHIQL] : [OPEN, GRAPHIQL];
    return this.readOnly ? items : [...items, { divider: true }, DELETE];
  }

  hrefOf(endpoint) {
    const { org, site } = this;
    return buildHash({ org, site, endpoint });
  }

  graphiqlHrefOf(endpoint) {
    const { org, site } = this;
    return getGraphiqlHref({
      org, site, endpoint, host: window.location.hostname,
    });
  }

  urlOf(endpoint) {
    const { org, site, serviceUrl } = this;
    return getEndpointUrl({
      serviceUrl, org, site, name: endpoint,
    });
  }

  handleAction(endpoint, id) {
    if (id === OPEN.id) {
      window.location.hash = this.hrefOf(endpoint);
    } else if (id === GRAPHIQL.id) {
      window.open(this.graphiqlHrefOf(endpoint), '_blank', 'noopener');
    } else if (id === COPY.id) {
      copyEndpoint(this.urlOf(endpoint));
    } else if (id === DELETE.id && !this.busy) {
      this.dispatchEvent(new CustomEvent('endpoint-delete', { detail: { endpoint } }));
    }
  }

  renderRow(endpoint) {
    const { org, site } = this;
    const url = this.urlOf(endpoint);
    return html`
      <li class="row">
        <a class="row-link" href=${this.hrefOf(endpoint)}>
          <span class="row-title">${endpoint}</span>
          <code class="row-text muted" title=${url ?? nothing}>${getEndpointPath({ org, site, name: endpoint })}</code>
        </a>
        <a class="graphiql-link nx-action-btn-quiet nx-action-btn-icon" target="_blank" rel="noopener"
          href=${this.graphiqlHrefOf(endpoint)}
          title="Open in GraphiQL" aria-label="Open ${endpoint} in GraphiQL">${icon({ name: 'openIn' })}</a>
        <nx-menu placement="below-end" .items=${this.menuItems}
          @select=${({ detail }) => this.handleAction(endpoint, detail.id)}>
          <button slot="trigger" type="button" class="nx-action-btn-quiet nx-action-btn-icon"
            aria-label="Actions for ${endpoint}">${icon({ name: 'more' })}</button>
        </nx-menu>
      </li>`;
  }

  render() {
    const nameHeading = renderSortHeading({
      key: 'name',
      label: 'Name',
      sort: this.sort,
      disabled: this.busy,
      onSort: (sort) => this.dispatchEvent(new CustomEvent('sort-change', { detail: sort })),
    });
    return html`
      <div class="list">
        <div class="list-head" role="group" aria-label="Sort by">
          ${nameHeading}
          <span aria-hidden="true">Endpoint</span>
          <span aria-hidden="true">GraphiQL</span>
        </div>
        <ul class="rows" aria-label="Endpoints">
          ${this.endpoints.map((endpoint) => this.renderRow(endpoint))}
        </ul>
      </div>`;
  }
}

customElements.define(EL_NAME, EndpointList);
