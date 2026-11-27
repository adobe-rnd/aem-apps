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

const [formStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/form.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-confirm';

// ask() resolves true when confirmed; closing the dialog any other way resolves false.
class Confirm extends LitElement {
  static properties = {
    _request: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [formStyle, style];
  }

  async ask({
    title, body, confirmLabel, negative = false,
  }) {
    await import('https://da.live/nx2/blocks/shared/dialog/dialog.js');
    this._request?.resolve(false);
    return new Promise((resolve) => {
      this._request = {
        title, body, confirmLabel, negative, resolve,
      };
    });
  }

  settle(confirmed) {
    const request = this._request;
    this._request = undefined;
    request?.resolve(confirmed);
  }

  render() {
    if (!this._request) return nothing;
    const {
      title, body, confirmLabel, negative,
    } = this._request;
    return html`
      <nx-dialog title=${title} @close=${() => this.settle(false)}>
        <div class="dialog-text">${body}</div>
        <button type="button" slot="actions" class="nx-form-btn-secondary"
          @click=${() => this.shadowRoot.querySelector('nx-dialog')?.close()}>Cancel</button>
        <button type="button" slot="actions"
          class="nx-form-btn-primary ${negative ? 'negative' : ''}"
          @click=${() => this.settle(true)}>${confirmLabel}</button>
      </nx-dialog>`;
  }
}

customElements.define(EL_NAME, Confirm);
