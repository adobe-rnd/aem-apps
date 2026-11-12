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
import { buttons, shared, loadStyle } from '../shared/styles.js';
import { BusController } from '../shared/bus-controller.js';

const panelStyle = await loadStyle(import.meta.url);

/** Panel view base: mirrors the store's broadcasts; edits go through the store or `actions.js`. */
export class PanelView extends LitElement {
  static properties = {
    store: { attribute: false },
    model: { state: true },
    issues: { state: true },
    selection: { state: true },
    editingDefId: { state: true },
    /** The page shown: `{ mode, componentId }` (see core/session/modes.js). */
    page: { state: true },
    chatAvailable: { state: true },
  };

  /** Extra style sheets of the subclass, adopted after the shared ones. */
  static sheets = [];

  constructor() {
    super();
    this._subscriptions = new BusController(this, (bus) => {
      this._reset();
      return [
        bus.modelState.subscribe((state) => {
          this.model = state.status === 'ready' ? state.model : null;
          this.issues = state.issues ?? [];
        }),
        bus.selectionState.subscribe(({ nodeId, editingDefId }) => {
          this.selection = nodeId;
          this.editingDefId = editingDefId;
        }),
        bus.pageState.subscribe((page) => { this.page = page; }),
        bus.chatState.subscribe(({ available }) => { this.chatAvailable = available; }),
      ];
    });
    this._reset();
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, panelStyle, ...this.constructor.sheets];
  }

  get bus() {
    return this.store?.bus;
  }

  _reset() {
    this.model = null;
    this.issues = [];
    this.selection = null;
    this.editingDefId = null;
    this.page = { mode: 'build', componentId: null };
    this.chatAvailable = false;
  }

  get ready() {
    return !!this.store && !!this.model;
  }

  renderNotReady() {
    return html`<div class="empty"><p>Open a schema to use this panel.</p></div>`;
  }
}
