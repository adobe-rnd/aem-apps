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
/* eslint-disable import/no-unresolved */
import { LitElement, html } from 'da-lit';
import { parseSite } from '../data/site-input.js';

export default function defineSitePicker({ styles, setupGuide }) {
  class MsmNextSitePicker extends LitElement {
    static properties = {
      value: { state: true },
      invalid: { state: true },
    };

    constructor() {
      super();
      this.value = '';
      this.invalid = false;
    }

    connectedCallback() {
      super.connectedCallback();
      if (styles) this.shadowRoot.adoptedStyleSheets = [styles];
    }

    submit(event) {
      event.preventDefault();
      const picked = parseSite(this.value);
      this.invalid = !picked;
      if (picked) this.dispatchEvent(new CustomEvent('pick', { detail: picked }));
    }

    render() {
      return html`
        <header class="app-header">
          <div class="title-group">
            <h1>Multi-site Management</h1>
            <p class="app-context">No site selected</p>
          </div>
        </header>
        <form class="site-picker" @submit=${(event) => this.submit(event)}>
          <h2>Choose a site</h2>
          <p>Enter the organization and site you want to manage.</p>
          <div class="site-picker-row">
            <label class="search">
              <span class="visually-hidden">Organization and site</span>
              <input type="text" placeholder="/org/site" autocomplete="off" .value=${this.value}
                aria-invalid=${String(this.invalid)} aria-describedby="site-error"
                @input=${(event) => { this.value = event.target.value; this.invalid = false; }}>
            </label>
            <button type="submit" class="btn accent">Open</button>
          </div>
          <p id="site-error" class="error-text" role="alert">${this.invalid ? 'Enter an organization and a site, for example /acme/website.' : ''}</p>
          <p class="site-picker-help">Your site needs a <strong>locations</strong> sheet.
            <a href=${setupGuide} target="_blank" rel="noopener noreferrer">See the setup guide</a>.</p>
        </form>`;
    }
  }

  if (!customElements.get('msm-next-site-picker')) {
    customElements.define('msm-next-site-picker', MsmNextSitePicker);
  }
}
