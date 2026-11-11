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
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { fieldMessages, fieldStyles } from './field.js';

const style = await loadStyle(import.meta.url);

class SeCheckbox extends LitElement {
  static properties = {
    checked: { type: Boolean, reflect: true },
    description: { type: String },
    error: { type: String },
    disabled: { type: Boolean, reflect: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [fieldStyles, style];
  }

  handleChange(event) {
    this.checked = event.target.checked;
    // `change` does not cross the shadow boundary; re-dispatch from the host.
    this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <label class="form-switch${this.error ? ' has-error' : ''}">
        <input
          class="form-switch-input"
          type="checkbox"
          role="switch"
          ?checked=${this.checked}
          ?disabled=${this.disabled}
          @change=${this.handleChange}
        />
        <span class="form-switch-track" aria-hidden="true">
          <span class="form-switch-handle"></span>
        </span>
        <span class="form-switch-label"><slot></slot></span>
      </label>
      ${fieldMessages(this)}
    `;
  }
}

if (!customElements.get('se-checkbox')) customElements.define('se-checkbox', SeCheckbox);
