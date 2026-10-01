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
import { buildHash, ENDPOINTS_SECTION } from '../utils/route.js';
import { icon } from '../shared/icons.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-header';

// The trail is app-specific (GraphQL › endpoints › name), so it is not nx-breadcrumb.
class Header extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    endpoint: { type: String },
    addable: { type: Boolean },
    addDisabled: { type: Boolean },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, style];
  }

  renderSiteContext() {
    if (!this.site) return nothing;
    return html`
      <div class="site-context">
        <span>${this.org} / ${this.site}</span>
        <button type="button" class="nx-action-btn-icon nx-btn-sm change-site"
          title="Change site" aria-label="Change site"
          @click=${() => this.dispatchEvent(new Event('change-site'))}>${icon({ name: 'edit' })}</button>
      </div>`;
  }

  renderAdd() {
    if (!this.addable) return nothing;
    return html`
      <div class="crumb">
        <button type="button" class="nx-action-btn-icon nx-btn-sm add-endpoint" title="New endpoint"
          aria-label="New endpoint" ?disabled=${this.addDisabled}
          @click=${() => this.dispatchEvent(new Event('endpoint-add'))}>${icon({ name: 'addCircle' })}</button>
      </div>`;
  }

  render() {
    const { org, site, endpoint } = this;
    const current = (label) => html`<span class="crumb-label" aria-current="page">${label}</span>`;
    const section = endpoint
      ? html`<a class="crumb-label" href=${buildHash({ org, site })}>${ENDPOINTS_SECTION}</a>`
      : current(ENDPOINTS_SECTION);
    return html`
      <h1 class="visually-hidden">${endpoint ?? 'GraphQL endpoints'}</h1>
      ${this.renderSiteContext()}
      <div class="crumb-trail">
        <nav aria-label="Breadcrumb">
          <ol>
            <li class="crumb"><span class="crumb-label">GraphQL</span></li>
            <li class="crumb">${section}</li>
            ${endpoint ? html`<li class="crumb">${current(endpoint)}</li>` : nothing}
          </ol>
        </nav>
        ${this.renderAdd()}
      </div>
      <slot></slot>`;
  }
}

customElements.define(EL_NAME, Header);
