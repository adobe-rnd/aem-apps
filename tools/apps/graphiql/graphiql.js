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
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { hashChange, loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { getColorScheme } from 'https://da.live/nx2/scripts/nx.js';
import { showToast, VARIANT_ERROR } from 'https://da.live/nx2/blocks/shared/toast/toast.js';
import { createDaAdapter } from './adapters/da.js';
import { buildHash, isSameRoute, toRoute } from './ui/utils/route.js';
import { messageStyle, renderLoading, renderMessage } from './ui/shared/message/message.js';
import { canvasStyle } from './ui/shared/canvas/canvas.js';
import { headerStyle, renderHeader } from './ui/header/header.js';

import 'https://da.live/nx2/public/sl/components.js';
import './ui/graphiql/graphiql.js';

const EL_NAME = 'gqi-app';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const da = createDaAdapter(DA_SDK);

const setHash = ({ route, replace }) => {
  const url = new URL(window.location.href);
  url.hash = buildHash(route);
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
};

const isSameSite = (a, b) => a?.org === b?.org && a?.site === b?.site;

// Routes #/{org}/{site}/{endpoint} and loads the endpoints of the site.
class GraphiqlApp extends LitElement {
  static properties = {
    _route: { state: true },
    _site: { state: true },
    _changingSite: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [
      buttonStyle, canvasStyle, headerStyle, messageStyle, style,
    ];
    this._unsubscribe = hashChange.subscribe((details) => this.openRoute(toRoute(details)));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribe?.();
  }

  get ready() {
    return !!(this._route?.endpoint && this._site?.endpoints?.length);
  }

  // GraphiQL lives in the light DOM, slotted in, so that its global styles and popups apply.
  updated() {
    if (!this.ready) {
      this._view?.remove();
      return;
    }
    this._view ??= document.createElement('gqi-graphiql');
    this._view.site = this._site;
    this._view.endpoint = this._route.endpoint;
    if (!this._view.isConnected) this.append(this._view);
  }

  async openRoute(route) {
    const current = this._route;
    if (isSameRoute({ route, other: current })) return;
    if (!isSameSite(route, current) || this._site?.error) this._site = undefined;
    this._route = route;
    if (!route?.site) {
      this.handleChangeSite();
      return;
    }
    const site = this._site ?? await this.loadSite(route);
    // Without an endpoint in the hash, open the first one.
    if (this._route === route && !route.endpoint && site?.endpoints?.length) {
      this.selectEndpoint(site.endpoints[0], { replace: true });
    }
  }

  async loadSite(route) {
    const site = { org: route.org, site: route.site, ...await da.loadSite(route) };
    if (isSameSite(this._route, route)) this._site = site;
    return site;
  }

  selectEndpoint(endpoint, { replace } = {}) {
    const route = { ...this._route, endpoint };
    setHash({ route, replace });
    this._route = route;
  }

  async handleChangeSite() {
    try {
      await import('./ui/shared/site-picker/site-picker.js');
      this._changingSite = true;
    } catch {
      showToast({ text: 'The site picker could not be loaded. Reload the page.', variant: VARIANT_ERROR });
    }
  }

  handleSiteChange({ detail }) {
    this._changingSite = undefined;
    window.location.hash = buildHash(detail);
  }

  renderHeader() {
    const { org, site, endpoint } = this._route ?? {};
    return renderHeader({
      org,
      site,
      endpoint: this.ready ? endpoint : undefined,
      endpoints: this._site?.endpoints,
      onChangeSite: () => this.handleChangeSite(),
      onEndpointChange: ({ detail }) => this.selectEndpoint(detail.endpoint),
    });
  }

  renderMain() {
    const { org, site, endpoint } = this._route ?? {};
    if (!site) {
      return renderMessage({
        heading: 'No site selected',
        text: 'Choose an organization and site to query its GraphQL endpoints.',
        action: 'Choose a site',
        onAction: () => this.handleChangeSite(),
      });
    }
    if (!this._site) return renderLoading('Loading endpoints…');
    if (this._site.error) {
      return renderMessage({
        heading: 'The site could not be loaded',
        text: html`The endpoints of <strong>${org}/${site}</strong> could not be loaded. Check
          the names and your access, then try again.`,
        action: 'Try again',
        onAction: () => {
          this._site = undefined;
          this.loadSite(this._route);
        },
        role: 'alert',
      });
    }
    if (!this._site.endpoints.length) {
      return renderMessage({
        heading: 'No endpoints',
        text: html`<strong>${org}/${site}</strong> has no GraphQL endpoints yet. Create one in the
          GraphQL Endpoints app, then reload.`,
        action: 'Change site',
        onAction: () => this.handleChangeSite(),
      });
    }
    return endpoint ? html`<slot></slot>` : renderLoading('Opening the endpoint…');
  }

  render() {
    const { org, site } = this._route ?? {};
    return html`
      ${this.renderHeader()}
      <div class="content">${this.renderMain()}</div>
      ${this._changingSite ? html`
        <gqi-site-picker .org=${org} .site=${site}
          @site-change=${this.handleSiteChange}
          @site-cancel=${() => { this._changingSite = undefined; }}></gqi-site-picker>` : nothing}`;
  }
}

customElements.define(EL_NAME, GraphiqlApp);

document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
// The adapter fetches through the DA SDK, so wait for the shell's handshake before loading data.
await DA_SDK;
document.body.append(document.createElement(EL_NAME));
