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
import { hashChange } from 'https://da.live/nx2/utils/utils.js';
import { getColorScheme } from 'https://da.live/nx2/scripts/nx.js';
import {
  repository, loadScSdk, loadChat, loadFrameless,
} from './adapters/index.js';
import { SchemaStore } from './core/session/store.js';
import { connectChat } from './core/session/chat.js';
import {
  SCREENS, parseRoute, routeHash, sameRoute,
} from './core/routes.js';
import { configureNx } from './ui/shared/nx.js';
import { buttons, shared, loadStyle } from './ui/shared/styles.js';
import { confirmDialog } from './ui/shared/confirm.js';
import { toast } from './ui/shared/toast.js';
import './ui/fields/input.js';

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

  _openSite(event) {
    event.preventDefault();
    const value = event.target.querySelector('se-input')?.value?.trim() ?? '';
    const [org, site] = value.replace(/^\/+/, '').split('/');
    if (org && site) window.location.hash = routeHash({ org, site });
  }

  _renderNoSite() {
    return html`
      <section class="no-site">
        <h1>Schemas</h1>
        <p class="muted">Open a site to browse and edit its structured content schemas.</p>
        <form @submit=${this._openSite}>
          <se-input label="Organization / site" placeholder="my-org/my-site"></se-input>
          <button type="submit" class="nx-btn-accent">Open</button>
        </form>
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

  render() {
    const { screen, org, site } = this._route ?? {};
    if (screen === SCREENS.NONE) return this._renderNoSite();
    if (screen === SCREENS.BROWSE) {
      return html`
        <se-browse .org=${org} .site=${site} .repository=${repository} .chat=${this._chat}></se-browse>
      `;
    }
    if (screen === SCREENS.AUTHOR && this._store) return this._renderAuthor();
    return nothing;
  }
}

if (!customElements.get(EL_NAME)) customElements.define(EL_NAME, SeApp);

document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
// The adapters fetch through the DA SDK and nx2 components need their config, both before the
// first screen loads. `frameless`: the shell dropped its frame, so the app draws its own surfaces.
const [frameless] = await Promise.all([loadFrameless(), configureNx()]);
const app = document.createElement(EL_NAME);
app.toggleAttribute('frameless', frameless);
document.body.append(app);
