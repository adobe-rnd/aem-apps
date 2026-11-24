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
import { html, LitElement } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { icon } from '../utils/icons.js';
import 'https://da.live/nx2/blocks/shared/popover/popover.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gqi-endpoint-menu';

// The current endpoint as the last crumb of the bar; its popover lists the endpoints of the
// site, the current one checked, like the sort menu of the GraphQL Endpoints app. Picking one
// emits `endpoint-change` with its name.
class EndpointMenu extends LitElement {
  static properties = {
    endpoint: { type: String },
    endpoints: { attribute: false },
    _open: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, style];
  }

  get popover() {
    return this.shadowRoot.querySelector('nx-popover');
  }

  get names() {
    const endpoints = this.endpoints ?? [];
    return endpoints.includes(this.endpoint) ? endpoints : [this.endpoint, ...endpoints];
  }

  async toggle({ currentTarget }) {
    if (this._open) {
      this.popover.close();
      return;
    }
    this._open = true;
    this.popover.show({ anchor: currentTarget, placement: 'below' });
    // nx-popover stays hidden until its positioning frame, so focus after it.
    await this.popover.updateComplete;
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
    this.popover.querySelector('[aria-pressed="true"]')?.focus();
  }

  close() {
    this.popover?.close();
    this.shadowRoot.querySelector('.trigger')?.focus();
  }

  pick(name) {
    this.close();
    if (name === this.endpoint) return;
    this.dispatchEvent(new CustomEvent('endpoint-change', { detail: { endpoint: name } }));
  }

  handleKeydown(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    this.close();
  }

  renderOption(name) {
    const selected = name === this.endpoint;
    return html`
      <button type="button" class="nx-action-btn-quiet option"
        aria-pressed=${selected ? 'true' : 'false'} @click=${() => this.pick(name)}>
        ${icon({ name: 'checkmark', className: selected ? 'check' : 'check unchecked' })}
        <span class="option-label">${name}</span>
      </button>`;
  }

  render() {
    return html`
      <button type="button" class="trigger" title="Switch endpoint"
        aria-label="Endpoint: ${this.endpoint}" aria-current="page" aria-haspopup="dialog"
        aria-expanded=${this._open ? 'true' : 'false'} @click=${this.toggle}>
        <span class="label">${this.endpoint}</span>${icon({ name: 'chevronDown', className: 'chevron' })}
      </button>
      <nx-popover class="popover" role="dialog" aria-label="Endpoints"
        @close=${() => { this._open = false; }} @keydown=${this.handleKeydown}>
        ${this.names.map((name) => this.renderOption(name))}
      </nx-popover>`;
  }
}

customElements.define(EL_NAME, EndpointMenu);
