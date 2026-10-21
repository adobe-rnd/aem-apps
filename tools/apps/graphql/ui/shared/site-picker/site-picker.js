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

const EL_NAME = 'gql-site-picker';

class SitePicker extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    _open: { state: true },
    _errors: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [formStyle, style];
  }

  firstUpdated() {
    this.openDialog();
  }

  get complete() {
    return !!(this.org && this.site);
  }

  get dialog() {
    return this.shadowRoot.querySelector('nx-dialog');
  }

  async openDialog() {
    await import('https://da.live/nx2/blocks/shared/dialog/dialog.js');
    this._open = true;
  }

  handleSubmit(event) {
    event?.preventDefault();
    const [org, site] = ['org', 'site'].map((name) => this.shadowRoot
      .querySelector(`input[name="${name}"]`).value?.trim().toLowerCase());
    const errors = {
      ...(!org && { org: 'An organization name is required.' }),
      ...(!site && { site: 'A site name is required.' }),
    };
    if (Object.keys(errors).length) {
      this._errors = errors;
      this.shadowRoot.querySelector(`input[name="${org ? 'site' : 'org'}"]`)?.focus();
      return;
    }
    if (org === this.org && site === this.site) {
      this.dialog?.close();
      return;
    }
    this.dispatchEvent(new CustomEvent('site-change', { detail: { org, site } }));
  }

  handleInput({ target }) {
    if (this._errors?.[target.name]) this._errors = { ...this._errors, [target.name]: undefined };
  }

  handleClose() {
    this._open = undefined;
    this._errors = undefined;
    this.dispatchEvent(new CustomEvent('site-cancel'));
  }

  renderField({ name, label, value }) {
    const error = this._errors?.[name];
    return html`
      <label class="nx-form-field ${error ? 'nx-field-error' : ''}">
        <span>${label}</span>
        <input class="nx-input" type="text" name=${name} placeholder="${label.toLowerCase()} name"
          autocomplete="off" spellcheck="false" ?autofocus=${name === 'org'}
          aria-invalid=${error ? 'true' : 'false'} .value=${value ?? ''}
          @input=${this.handleInput} />
        ${error ? html`<span class="nx-input-error-msg" role="alert">${error}</span>` : nothing}
      </label>`;
  }

  renderDialog() {
    return html`
      <nx-dialog title=${this.complete ? 'Change site' : 'Choose a site'}
        @close=${this.handleClose}>
        <form class="site-form" @submit=${this.handleSubmit}>
          ${this.renderField({ name: 'org', label: 'Organization', value: this.org })}
          ${this.renderField({ name: 'site', label: 'Site', value: this.site })}
          <button type="submit" hidden></button>
        </form>
        <button type="button" slot="actions" class="nx-form-btn-secondary"
          @click=${() => this.dialog?.close()}>Cancel</button>
        <button type="button" slot="actions" class="nx-form-btn-primary"
          @click=${() => this.handleSubmit()}>Select</button>
      </nx-dialog>`;
  }

  render() {
    return this._open ? this.renderDialog() : nothing;
  }
}

customElements.define(EL_NAME, SitePicker);
