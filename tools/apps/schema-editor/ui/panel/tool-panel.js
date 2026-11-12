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
import { LitElement, html } from 'da-lit';
import { icon } from '../shared/icons.js';
import { buttons, loadStyle } from '../shared/styles.js';
import { toast } from '../shared/toast.js';
import { BusController } from '../shared/bus-controller.js';
import {
  DEFAULT_VIEW, viewById, viewsFor, shownView,
} from './views.js';

const style = await loadStyle(import.meta.url);

const STORAGE_KEY = 'se-tool-panel';

function readView() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeView(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked: the panel still works, it just won't remember.
  }
}

/**
 * `<se-tool-panel>`: one view at a time behind tabs, each loaded on first use and kept (with its
 * scroll and state) across switches. Follows `panelRequest`s; offers only the mode's views.
 * Fires `panel-close`, not `close`, which its menus and popovers fire (composed) when they close.
 */
class SeToolPanel extends LitElement {
  static properties = {
    store: { attribute: false },
    _activeId: { state: true },
    _mode: { state: true },
  };

  _elements = new Map();

  /** The last `panelRequest`, until the view it names is mounted. */
  _request = null;

  constructor() {
    super();
    this._activeId = viewById(readView()) ? readView() : DEFAULT_VIEW;
    this._mode = 'build';
    this._subscriptions = new BusController(this, (bus) => [
      bus.panelRequest.subscribe((req) => this._onRequest(req)),
      bus.pageState.subscribe(({ mode }) => { this._mode = mode; }),
    ]);
  }

  get _shownId() {
    return shownView(this._activeId, this._mode);
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, style];
  }

  willUpdate(changed) {
    if (changed.has('store')) {
      this._elements.forEach((element) => { element.store = this.store; });
    }
  }

  updated() {
    this._mountActive();
  }

  show(id) {
    if (shownView(id, this._mode) !== id || id === this._activeId) return;
    this._activeId = id;
    writeView(id);
  }

  _onRequest(request) {
    if (shownView(request.view, this._mode) !== request.view) return;
    this._request = request;
    this.show(request.view);
    this.requestUpdate();
  }

  async _mountActive() {
    const id = this._shownId;
    const element = await this._elementFor(id);
    const content = this.shadowRoot.querySelector('.content');
    if (!element || !content || id !== this._shownId) return;
    if (content.firstElementChild !== element) content.replaceChildren(element);
    if (this._request?.view === id) {
      element.applyRequest?.(this._request);
      this._request = null;
    }
  }

  async _elementFor(id) {
    if (this._elements.has(id)) return this._elements.get(id);
    const view = viewById(id);
    try {
      await view.load();
    } catch {
      toast({ message: `The ${view.label} panel could not be loaded.`, variant: 'negative' });
      return null;
    }
    if (this._elements.has(id)) return this._elements.get(id);
    const element = document.createElement(view.tag);
    element.store = this.store;
    this._elements.set(id, element);
    return element;
  }

  _onTabKeydown(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const views = viewsFor(this._mode);
    const index = views.findIndex((view) => view.id === this._shownId);
    const next = views[(index + step + views.length) % views.length];
    this.show(next.id);
    this.updateComplete.then(() => this.shadowRoot.querySelector(`#tab-${next.id}`)?.focus());
  }

  render() {
    return html`
      <div class="header">
        <div class="tabs" role="tablist" aria-label="Panels" @keydown=${this._onTabKeydown}>
          ${viewsFor(this._mode).map((view) => {
    const active = view.id === this._shownId;
    return html`
            <button type="button" role="tab" id=${`tab-${view.id}`} class="tab"
              aria-selected=${active ? 'true' : 'false'} tabindex=${active ? '0' : '-1'}
              aria-controls="panel-content" @click=${() => this.show(view.id)}>${view.label}</button>`;
  })}
        </div>
        <span class="divider" aria-hidden="true"></span>
        <button type="button" class="nx-action-btn-icon close" aria-label="Close panel"
          title="Close panel"
          @click=${() => this.dispatchEvent(new Event('panel-close'))}>${icon('panel')}</button>
      </div>
      <div class="content" id="panel-content" role="tabpanel"
        aria-labelledby=${`tab-${this._shownId}`}></div>
    `;
  }
}

if (!customElements.get('se-tool-panel')) customElements.define('se-tool-panel', SeToolPanel);
