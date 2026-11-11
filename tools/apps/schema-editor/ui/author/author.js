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
import { routeHash } from '../../core/routes.js';
import { createModel } from '../../core/model/elements.js';
import { buttons, shared, loadStyle } from '../shared/styles.js';
import { BusController } from '../shared/bus-controller.js';
import './header.js';
import './canvas.js';

const style = await loadStyle(import.meta.url);

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when a keyboard event comes from a field that handles its own undo. */
export function isTextEntry(event) {
  const [target] = event.composedPath?.() ?? [event.target];
  return !!target && (TEXT_ENTRY.has(target.tagName) || target.isContentEditable === true);
}

/** @returns {'undo'|'redo'|'save'|null} The editor-level shortcut of a keydown. */
export function shortcutOf(event) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 's') return 'save';
  if (isTextEntry(event)) return null;
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/**
 * `<se-author>`: the authoring screen. Mirrors the store's bus state into the header and the
 * current page; the tool panel views read the bus themselves.
 */
class SeAuthor extends LitElement {
  static properties = {
    store: { attribute: false },
    panelOpen: { type: Boolean },
    _state: { state: true },
    _selection: { state: true },
    _saveState: { state: true },
    _mode: { state: true },
    _chatAvailable: { state: true },
    _chatOpen: { state: true },
  };

  constructor() {
    super();
    this._subscriptions = new BusController(this, (bus) => [
      bus.modelState.subscribe((state) => { this._state = state; }),
      bus.selectionState.subscribe((selection) => { this._selection = selection; }),
      bus.saveState.subscribe((saveState) => { this._saveState = saveState; }),
      bus.pageState.subscribe(({ mode }) => { this._mode = mode; }),
      bus.chatState.subscribe(({ available, open }) => {
        this._chatAvailable = available;
        this._chatOpen = !!open;
      }),
    ]);
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
    window.addEventListener('keydown', this._onKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKeydown);
  }

  _onKeydown = (event) => {
    if (event.defaultPrevented || this._state?.status !== 'ready') return;
    const shortcut = shortcutOf(event);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === 'save') {
      if (this._state.dirty) this.store.save();
      return;
    }
    this.store[shortcut]();
  };

  _create() {
    const { name } = this.store;
    this.store.open(createModel({ name, title: name }), { saved: false });
  }

  _renderLoading() {
    return html`
      <div class="skeleton" aria-busy="true" aria-label="Loading schema">
        <span class="bar title"></span>
        <span class="bar"></span><span class="bar"></span><span class="bar short"></span>
      </div>
    `;
  }

  _renderError({ error, missing, raw }) {
    const { org, site } = this.store;
    return html`
      <section class="empty error-state" role="alert">
        <h2>${missing ? 'Schema not found' : 'This schema can’t be opened'}</h2>
        <p class="muted">${error}</p>
        ${raw ? html`<pre class="raw">${raw}</pre>` : nothing}
        <div class="actions">
          <a class="nx-action-btn" href=${routeHash({ org, site })}>Back to schemas</a>
          ${missing ? html`
            <button type="button" class="nx-btn-accent" @click=${this._create}>Create it</button>
          ` : nothing}
        </div>
      </section>
    `;
  }

  _renderMode() {
    const { model, issues } = this._state;
    // Separate templates, so a page switch starts a fresh canvas instead of reusing its state.
    if (this._mode === 'components') {
      return html`
        <se-canvas view="components" .store=${this.store} .model=${model} .issues=${issues}
          .selection=${this._selection?.nodeId ?? null}></se-canvas>
      `;
    }
    return html`
      <se-canvas .store=${this.store} .model=${model} .issues=${issues}
        .selection=${this._selection?.nodeId ?? null}></se-canvas>
    `;
  }

  render() {
    const state = this._state;
    if (!state || state.status === 'idle' || state.status === 'loading') {
      return html`<div class="bar-placeholder"></div>
        <div class="scroller">${this._renderLoading()}</div>`;
    }
    if (state.status === 'error') return html`<div class="scroller">${this._renderError(state)}</div>`;
    return html`
      <se-header .store=${this.store} .state=${state} .saveState=${this._saveState}
        .mode=${this._mode} .chatAvailable=${!!this._chatAvailable}
        .chatOpen=${!!this._chatOpen}
        .panelOpen=${!!this.panelOpen}></se-header>
      <div class="scroller">
        <main class="body">${this._renderMode()}</main>
      </div>
    `;
  }
}

if (!customElements.get('se-author')) customElements.define('se-author', SeAuthor);
