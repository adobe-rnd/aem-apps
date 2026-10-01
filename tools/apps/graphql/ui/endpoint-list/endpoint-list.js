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
/* eslint-disable no-underscore-dangle, import/no-unresolved, class-methods-use-this */
import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { showToast, VARIANT_ERROR } from 'https://da.live/nx2/blocks/shared/toast/toast.js';
import { getDeliveryPath } from '../../core/endpoint.js';
import { buildHash } from '../utils/route.js';
import { icon } from '../utils/icons.js';
import { delegateRowClick, tableStyle } from '../shared/table/table.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-endpoint-list';

async function copyPath(path) {
  try {
    await navigator.clipboard.writeText(path);
    showToast({ text: 'Endpoint path copied.' });
  } catch {
    showToast({ text: 'The endpoint path could not be copied.', variant: VARIANT_ERROR });
  }
}

class EndpointList extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    endpoints: { attribute: false },
    busy: { type: Boolean },
    readOnly: { type: Boolean },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, tableStyle, style];
  }

  renderPath(name) {
    const path = getDeliveryPath({ name });
    return html`
      <div class="endpoint-cell">
        <code title=${path}>${path}</code>
        <button type="button" class="nx-action-btn-icon nx-btn-sm copy" title="Copy endpoint" aria-label="Copy endpoint ${path}"
          @click=${() => copyPath(path)}>${icon({ name: 'copy' })}</button>
      </div>`;
  }

  emitDelete(endpoint) {
    this.dispatchEvent(new CustomEvent('endpoint-delete', { detail: { endpoint } }));
  }

  renderRowActions(name) {
    if (this.readOnly) return nothing;
    return html`
      <div class="actions">
        <button type="button" class="nx-action-btn-icon row-action delete" title="Delete"
          aria-label="Delete ${name}" ?disabled=${this.busy}
          @click=${() => this.emitDelete(name)}>${icon({ name: 'delete' })}</button>
      </div>`;
  }

  renderRow(name) {
    return html`
      <tr class="endpoint-row clickable" @click=${delegateRowClick}>
        <td class="name">
          <a class="row-control" href=${buildHash({ org: this.org, site: this.site, endpoint: name })}>${name}</a>
          <div class="stacked-path">${this.renderPath(name)}</div>
        </td>
        <td class="endpoint">${this.renderPath(name)}</td>
        <td class="row-actions">${this.renderRowActions(name)}</td>
      </tr>`;
  }

  render() {
    if (!this.endpoints.length) {
      return html`<p class="empty">No endpoints yet. Create one to generate a GraphQL schema
        from the site's schemas.</p>`;
    }
    return html`
      <table class="list-table endpoint-list">
        <thead>
          <tr>
            <th class="name" scope="col">Name</th>
            <th class="endpoint" scope="col">Endpoint</th>
            <th class="row-actions" scope="col" aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>${this.endpoints.map((name) => this.renderRow(name))}</tbody>
      </table>`;
  }
}

customElements.define(EL_NAME, EndpointList);
