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
import { repository, loadScSdk, loadChat } from './adapters/index.js';
import { SchemaStore } from './core/session/store.js';
import { connectChat } from './core/session/chat.js';
import {
  SCREENS, parseRoute, routeHash, sameRoute,
} from './core/routes.js';
import { buttons, shared, loadStyle } from './ui/shared/styles.js';
import { confirmDialog } from './ui/shared/confirm.js';
import { toast } from './ui/shared/toast.js';
import { getNx2 } from './ui/shared/nx.js';

const nx2 = getNx2();
const [{ hashChange }, { getColorScheme, setConfig }] = await Promise.all([
  import(`${nx2}/utils/utils.js`),
  import(`${nx2}/scripts/nx.js`),
]);

const EL_NAME = 'se-app';

const style = await loadStyle(import.meta.url);

const SCREEN_MODULES = {
  [SCREENS.BROWSE]: () => import('./ui/browse/browse.js'),
  [SCREENS.AUTHOR]: () => Promise.all([
    import('./ui/author/author.js'),
    import('./ui/panel/tool-panel.js'),
  ]),
};

async function loadValidator() {
  try {
    const { validateSchema } = await loadScSdk();
    return validateSchema;
  } catch {
    toast({ message: 'Schema validation is unavailable: the Structured Content SDK could not be loaded.', variant: 'warning' });
    return undefined;
  }
}

/**
 * `<se-app>`: routes the hash to a screen and owns the SchemaStore lifecycle, the unsaved-changes
 * guard and the panel's open state. Screens get inputs as properties and navigate via the hash.
 */
class SeApp extends LitElement {
  static properties = {
    _route: { state: true },
    _store: { state: true },
    _panelOpen: { state: true },
    _chat: { state: true },
    _changingSite: { state: true },
  };

  _navigation = 0;

  constructor() {
    super();
    this._panelOpen = true;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
    this._chatReady = loadChat().then((chat) => { this._chat = chat; return chat; });
    this._unsubscribeHash = hashChange.subscribe((state) => this._onRoute(parseRoute(state)));
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeHash?.();
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    this._closeSession();
  }

  _onBeforeUnload = (event) => {
    if (this._store?.dirty) event.preventDefault();
  };

  async _onRoute(route) {
    if (sameRoute(route, this._route)) return;
    this._navigation += 1;
    const navigation = this._navigation;

    if (this._store?.dirty) {
      const leave = await confirmDialog({
        title: 'Discard unsaved changes?',
        message: `Your changes to "${this._store.name}" haven't been saved.`,
        confirmLabel: 'Discard',
        destructive: true,
      });
      if (navigation !== this._navigation) return;
      if (!leave) {
        window.history.replaceState(null, '', routeHash(this._route));
        return;
      }
    }

    try {
      await SCREEN_MODULES[route.screen]?.();
    } catch {
      toast({ message: 'Part of the app could not be loaded. Reload the page to try again.', variant: 'negative' });
      return;
    }
    const validateSchema = route.screen === SCREENS.AUTHOR ? await loadValidator() : undefined;
    const chat = await this._chatReady;
    if (navigation !== this._navigation) return;
    this._enter(route, { validateSchema, chat });
  }

  _enter(route, { validateSchema, chat }) {
    this._closeSession();
    this._route = route;

    if (route.invalidName) {
      toast({ message: `"${route.invalidName}" is not a valid schema name.`, variant: 'negative' });
    }
    if (route.screen === SCREENS.NONE) this._changeSite();
    if (route.screen !== SCREENS.AUTHOR) return;

    const { org, site, name } = route;
    const store = new SchemaStore({
      org, site, name, repository, validateSchema,
    });
    this._sessionSubs = [
      store.bus.toastRequest.subscribe(toast),
      store.bus.panelRequest.subscribe(({ open }) => { if (open) this._panelOpen = true; }),
      connectChat({ store, chat }),
    ];
    this._store = store;
    store.load();
  }

  _closeSession() {
    this._sessionSubs?.forEach((unsubscribe) => unsubscribe());
    this._sessionSubs = null;
    this._store = null;
  }

  _changeSite = async () => {
    try {
      await import('./ui/shared/site-picker.js');
      this._changingSite = true;
    } catch {
      toast({ message: 'Part of the app could not be loaded. Reload the page to try again.', variant: 'negative' });
    }
  };

  _onSiteChange({ detail }) {
    this._changingSite = false;
    window.location.hash = routeHash(detail);
  }

  _renderSitePicker() {
    if (!this._changingSite) return nothing;
    const { org, site } = this._route ?? {};
    return html`
      <se-site-picker .org=${org} .site=${site}
        @site-change=${this._onSiteChange}
        @site-cancel=${() => { this._changingSite = false; }}></se-site-picker>
    `;
  }

  _renderNoSite() {
    import(`${nx2}/public/sl/components.js`);
    return html`
      <section class="message">
        <h2>No site selected</h2>
        <p>Choose an organization and site to browse and edit its structured content schemas.</p>
        <sl-button class="primary outline" @click=${this._changeSite}>Choose a site</sl-button>
      </section>
    `;
  }

  _renderAuthor() {
    return html`
      <div class="author-layout ${this._panelOpen ? 'panel-open' : ''}">
        <se-author .store=${this._store} .panelOpen=${this._panelOpen}></se-author>
        <se-tool-panel .store=${this._store} ?hidden=${!this._panelOpen}
          @panel-close=${() => { this._panelOpen = false; }}></se-tool-panel>
      </div>
    `;
  }

  _renderScreen() {
    const { screen, org, site } = this._route ?? {};
    if (screen === SCREENS.NONE) return this._renderNoSite();
    if (screen === SCREENS.BROWSE) {
      return html`
        <se-browse .org=${org} .site=${site} .repository=${repository} .chat=${this._chat}
          @change-site=${this._changeSite}></se-browse>
      `;
    }
    if (screen === SCREENS.AUTHOR && this._store) return this._renderAuthor();
    return nothing;
  }

  render() {
    return html`${this._renderScreen()}${this._renderSitePicker()}`;
  }
}

if (!customElements.get(EL_NAME)) customElements.define(EL_NAME, SeApp);

document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
// nx2 components read `codeBase` once, on first load, to build `<use href>` icon URLs, which must
// be same-origin: point it at the app's `ui/`, whose img/icons also has the icons nx2 uses
// outright. Set it before the first screen loads.
await setConfig({ codeBase: new URL('ui', import.meta.url).href });
document.body.append(document.createElement(EL_NAME));
