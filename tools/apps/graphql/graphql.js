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
import { core } from './adapters/index.js';
import { buildHash, isSameRoute, toRoute } from './ui/utils/route.js';
import { messageStyle, renderLoading, renderMessage } from './ui/shared/message/message.js';

import 'https://da.live/nx2/public/sl/components.js';
import './ui/header/header.js';

const EL_NAME = 'graphql-app';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const setHash = ({ route, replace }) => {
  const url = new URL(window.location.href);
  url.hash = buildHash(route);
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
};

const screenFor = (route) => (route.endpoint ? 'endpoint-screen' : 'endpoints-screen');

const showLoadError = () => showToast({
  text: 'Part of the app could not be loaded. Reload the page to try again.',
  variant: VARIANT_ERROR,
});

const loadScreen = (route) => {
  const screen = screenFor(route);
  return import(`./ui/${screen}/${screen}.js`).catch(showLoadError);
};

const isSameSite = (a, b) => a?.org === b?.org && a?.site === b?.site;

// Routes the hash to a screen and loads the site the screens share.
class Graphql extends LitElement {
  static properties = {
    _route: { state: true },
    _site: { state: true },
    _isNew: { state: true },
    _changingSite: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, messageStyle, style];
    const unsubscribeHash = hashChange.subscribe((details) => {
      const route = toRoute(details);
      const staleHash = route?.site && window.location.hash !== buildHash(route);
      if (staleHash) setHash({ route, replace: true });
      this.openRoute(route);
    });
    const onBeforeUnload = (event) => { if (this.endpointScreen?.dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    this._teardown = () => {
      unsubscribeHash();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardown?.();
  }

  get endpointScreen() {
    return this.shadowRoot.querySelector('gql-endpoint-screen');
  }

  async openRoute(route, { isNew, confirmed } = {}) {
    const current = this._route;
    if (isSameRoute({ route, other: current })) {
      this._isNew = isNew;
      return;
    }
    if (!confirmed && this.endpointScreen?.dirty) {
      setHash({ route: current, replace: true });
      if (!await this.endpointScreen.confirmLeave() || this._route !== current) return;
      setHash({ route });
    }
    this._route = route;
    this._isNew = isNew;
    if (!isSameSite(route, current) || this._site?.error) this._site = undefined;
    if (!route?.site) {
      this.handleChangeSite();
      return;
    }
    await Promise.all([this._site ? undefined : this.loadSite(route), loadScreen(route)]);
  }

  async loadSite(route) {
    const loaded = await core.listEndpoints(route);
    if (this._route !== route) return;
    this._site = { ...loaded, org: route.org, site: route.site };
  }

  handleRouteChange({ detail }) {
    const { route, isNew, replace } = detail;
    setHash({ route, replace });
    this.openRoute(route, { isNew, confirmed: true });
  }

  async handleChangeSite() {
    try {
      await import('./ui/shared/site-picker/site-picker.js');
      this._changingSite = true;
    } catch {
      showLoadError();
    }
  }

  handleEndpointsChange({ detail }) {
    this._site = { ...this._site, endpoints: detail.endpoints };
  }

  handleSiteChange({ detail }) {
    this._changingSite = undefined;
    window.location.hash = buildHash(detail);
  }

  renderNoSite() {
    return renderMessage({
      heading: 'No site selected',
      text: 'Choose an organization and site to manage its GraphQL endpoints.',
      action: 'Choose a site',
      onAction: () => this.handleChangeSite(),
    });
  }

  renderSiteMissing() {
    const { org, site } = this._route;
    return renderMessage({
      heading: 'Site not found',
      text: html`No site was found at <strong>${org}/${site}</strong>. Verify the organization
        and site names, or request access from your administrator.`,
      action: 'Change site',
      onAction: () => this.handleChangeSite(),
      role: 'alert',
    });
  }

  renderSiteError() {
    const { org, site } = this._route;
    return renderMessage({
      heading: 'The site could not be loaded',
      text: html`<strong>${org}/${site}</strong> could not be loaded. Check your connection and
        access, then try again.`,
      action: 'Try again',
      onAction: () => {
        this._site = undefined;
        this.loadSite(this._route);
      },
      role: 'alert',
    });
  }

  renderScreen() {
    const { endpoint } = this._route;
    if (endpoint) {
      return html`
        <gql-endpoint-screen .site=${this._site} name=${endpoint}
          ?isNew=${!!this._isNew}
          @route-change=${this.handleRouteChange}
          @endpoints-change=${this.handleEndpointsChange}
          @change-site=${this.handleChangeSite}></gql-endpoint-screen>`;
    }
    return html`
      <gql-endpoints-screen .site=${this._site}
        @route-change=${this.handleRouteChange}
        @endpoints-change=${this.handleEndpointsChange}
        @change-site=${this.handleChangeSite}></gql-endpoints-screen>`;
  }

  renderMain() {
    const { org, site } = this._route ?? {};
    const header = html`
      <gql-header org=${org ?? nothing} site=${site ?? nothing}
        @change-site=${this.handleChangeSite}></gql-header>`;
    if (!site) return html`${header}${this.renderNoSite()}`;
    if (!this._site) {
      return html`${header}${renderLoading('Loading endpoints…')}`;
    }
    if (this._site.error) return html`${header}${this.renderSiteError()}`;
    if (!this._site.found) return html`${header}${this.renderSiteMissing()}`;
    return this.renderScreen();
  }

  renderSitePicker() {
    const { org, site } = this._route ?? {};
    return html`
      <gql-site-picker .org=${org} .site=${site}
        @site-change=${this.handleSiteChange}
        @site-cancel=${() => { this._changingSite = undefined; }}></gql-site-picker>`;
  }

  render() {
    return html`
      ${this.renderMain()}
      ${this._changingSite ? this.renderSitePicker() : nothing}`;
  }
}

customElements.define(EL_NAME, Graphql);

document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
// nx2 daFetch reads the token DA_SDK hands over, so wait for it before loading data.
await DA_SDK;
document.body.append(document.createElement(EL_NAME));
