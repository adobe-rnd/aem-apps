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
import { getColorScheme } from 'https://da.live/nx2/scripts/nx.js';
import { getEndpointUrl, introspect } from '../../core/client.js';
import { firstListField, listQuery } from '../../core/query.js';

const CDN = {
  react: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  reactDom: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  graphiql: 'https://unpkg.com/graphiql@3.8.3/graphiql.min.js',
  graphiqlCss: 'https://unpkg.com/graphiql@3.8.3/graphiql.min.css',
  graphql: 'https://esm.sh/graphql@16.9.0',
};

const EL_NAME = 'gqi-graphiql';

// Wait for the API key to settle before introspecting again.
const KEY_DELAY = 600;

const loadScript = (src) => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = src;
  script.crossOrigin = 'anonymous';
  script.onload = resolve;
  script.onerror = () => reject(new Error(`Could not load ${src}`));
  document.head.append(script);
});

const loadSheet = async (url) => {
  const sheet = new CSSStyleSheet();
  return sheet.replace(await (await fetch(url)).text());
};

// GraphiQL 3 is the last release with a UMD build; it reads React from the window.
let libraries;
const loadLibraries = () => {
  libraries ??= Promise.all([
    loadScript(CDN.react)
      .then(() => loadScript(CDN.reactDom))
      .then(() => loadScript(CDN.graphiql)),
    import(CDN.graphql),
    loadSheet(CDN.graphiqlCss),
    loadStyle(import.meta.url),
  ]).then(([, graphql, ...sheets]) => {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...sheets];
    return {
      graphql, React: window.React, ReactDOM: window.ReactDOM, GraphiQL: window.GraphiQL,
    };
  });
  libraries.catch(() => { libraries = undefined; });
  return libraries;
};

const keysWith = (prefix) => Object.keys(window.localStorage)
  .filter((key) => key.startsWith(prefix));

// GraphiQL keeps its tabs and history in storage; one namespace per endpoint.
const endpointStorage = (prefix) => ({
  getItem: (key) => window.localStorage.getItem(`${prefix}${key}`),
  setItem: (key, value) => window.localStorage.setItem(`${prefix}${key}`, value),
  removeItem: (key) => window.localStorage.removeItem(`${prefix}${key}`),
  clear: () => keysWith(prefix).forEach((key) => window.localStorage.removeItem(key)),
  get length() {
    return keysWith(prefix).length;
  },
});

const createFetcher = ({ url, apiKey }) => async (params, options) => {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey && { 'x-api-key': apiKey }),
      ...options?.headers,
    },
    body: JSON.stringify(params),
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { errors: [{ message: `HTTP ${resp.status}: ${text || resp.statusText}` }] };
  }
};

// GraphiQL for one endpoint, with the schema Content AI serves, by introspection. Rendered in
// the light DOM so that GraphiQL's styles and popups apply.
class GraphiqlView extends LitElement {
  static properties = {
    site: { attribute: false },
    endpoint: { type: String },
    apiKey: { type: String },
    _status: { state: true },
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Moved out and back in: GraphiQL was unmounted, so render it again.
    if (this.hasUpdated && this.endpoint) this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._keyTimer);
    this._root?.unmount();
    this._root = undefined;
    this._container = undefined;
  }

  get url() {
    const { org, site } = this.site ?? {};
    return getEndpointUrl({ org, site, endpoint: this.endpoint });
  }

  updated(props) {
    if ((props.has('endpoint') || props.has('site')) && this.endpoint) this.load();
    else if (props.has('apiKey') && this.endpoint) {
      clearTimeout(this._keyTimer);
      this._keyTimer = setTimeout(() => this.load({ quiet: true }), KEY_DELAY);
    }
  }

  // `quiet` keeps GraphiQL on screen while the schema reloads.
  async load({ quiet = false } = {}) {
    clearTimeout(this._keyTimer);
    const {
      site, endpoint, url, apiKey,
    } = this;
    const current = () => site === this.site && endpoint === this.endpoint
      && apiKey === this.apiKey;
    if (!quiet) this._status = { text: 'Loading the schema…' };
    if (!url) {
      this._status = { error: `No valid endpoint URL for ${endpoint}.` };
      return;
    }
    let libs;
    try {
      libs = await loadLibraries();
    } catch {
      if (current()) this._status = { error: 'GraphiQL could not be loaded. Reload the page.' };
      return;
    }
    const fetcher = createFetcher({ url, apiKey });
    const served = await introspect({ fetcher, query: libs.graphql.getIntrospectionQuery() });
    if (!current()) return;
    if (served.error) {
      this._status = { error: `Could not load the schema of ${endpoint}: ${served.error}` };
      return;
    }
    this._status = undefined;
    await this.updateComplete;
    this._rendered = {
      libs,
      fetcher,
      schema: served.schema,
      query: listQuery(firstListField(served.schema)),
      key: `${site.org}/${site.site}/${endpoint}`,
    };
    this.renderGraphiql(this._rendered);
  }

  renderGraphiql({
    libs, fetcher, schema, query, key,
  }) {
    const { React, ReactDOM, GraphiQL } = libs;
    const container = this.querySelector('.graphiql-root');
    if (this._container !== container) {
      this._root?.unmount();
      this._root = ReactDOM.createRoot(container);
      this._container = container;
    }
    // The key remounts GraphiQL, with its own storage, when the endpoint changes.
    this._root.render(React.createElement(GraphiQL, {
      key,
      fetcher,
      schema,
      defaultQuery: query,
      storage: endpointStorage(`gqi:${key}:`),
      forcedTheme: getColorScheme() === 'dark-scheme' ? 'dark' : 'light',
      shouldPersistHeaders: false,
    }));
  }

  render() {
    const status = this._status;
    return html`
      ${status ? html`
        <p class="gqi-status ${status.error ? 'gqi-error' : ''}"
          role=${status.error ? 'alert' : 'status'}>${status.error ?? status.text}</p>` : nothing}
      <div class="graphiql-root" ?hidden=${!!status}></div>`;
  }
}

customElements.define(EL_NAME, GraphiqlView);
