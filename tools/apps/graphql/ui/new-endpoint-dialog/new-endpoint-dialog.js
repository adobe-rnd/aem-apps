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
import {
  ENDPOINT_NAME_MAX_LENGTH, ENDPOINT_NAME_MIN_LENGTH, validateEndpointName,
} from '../../core/endpoint.js';

const [formStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/form.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-new-endpoint-dialog';

const NAME_HINT = `Use ${ENDPOINT_NAME_MIN_LENGTH}–${ENDPOINT_NAME_MAX_LENGTH} lowercase letters, `
  + 'numbers, or hyphens, starting with a letter.';

// ask({ existing }) resolves a valid new endpoint name, or undefined when the dialog is closed.
class NewEndpointDialog extends LitElement {
  static properties = {
    _request: { state: true },
    _name: { state: true },
    _error: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [formStyle, style];
  }

  async ask({ existing = [] } = {}) {
    await import('https://da.live/nx2/blocks/shared/dialog/dialog.js');
    this._request?.resolve(undefined);
    this._name = '';
    this._error = undefined;
    return new Promise((resolve) => { this._request = { existing, resolve }; });
  }

  settle(name) {
    const request = this._request;
    this._request = undefined;
    request?.resolve(name);
  }

  handleInput({ target }) {
    this._name = target.value;
    this._error = undefined;
  }

  submit(event) {
    event?.preventDefault();
    const name = this._name;
    this._error = validateEndpointName({ name, existing: this._request.existing });
    if (this._error) {
      this.shadowRoot.querySelector('input')?.focus();
      return;
    }
    this.settle(name);
  }

  render() {
    if (!this._request) return nothing;
    const error = this._error;
    return html`
      <nx-dialog title="New endpoint" @close=${() => this.settle(undefined)}>
        <form @submit=${this.submit}>
          <div class="nx-form-field ${error ? 'nx-field-error' : ''}">
            <label for="endpoint-name">Name</label>
            <input id="endpoint-name" class="nx-input" type="text" name="name"
              placeholder="endpoint name" autofocus
              required minlength=${ENDPOINT_NAME_MIN_LENGTH} maxlength=${ENDPOINT_NAME_MAX_LENGTH}
              autocomplete="off" spellcheck="false"
              aria-invalid=${error ? 'true' : 'false'} aria-describedby="endpoint-name-help"
              .value=${this._name} @input=${this.handleInput} />
            <p id="endpoint-name-help" class=${error ? 'nx-input-error-msg' : 'field-hint'}
              role=${error ? 'alert' : nothing}>${error ?? NAME_HINT}</p>
          </div>
          <button type="submit" hidden></button>
        </form>
        <button type="button" slot="actions" class="nx-form-btn-secondary"
          @click=${() => this.shadowRoot.querySelector('nx-dialog')?.close()}>Cancel</button>
        <button type="button" slot="actions" class="nx-form-btn-primary"
          @click=${() => this.submit()}>Continue</button>
      </nx-dialog>`;
  }
}

customElements.define(EL_NAME, NewEndpointDialog);
