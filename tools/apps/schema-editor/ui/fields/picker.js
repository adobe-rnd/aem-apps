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
import { html, nothing } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { icon } from '../shared/icons.js';
import { SeField } from './field.js';

const style = await loadStyle(import.meta.url);

/**
 * `<se-picker>`: a select over `.options` (`{ value, label }[]`) that always shows `.value`. A
 * pick is only reported (`change`, `detail.value`); changing `.syncKey` reverts a rejected pick.
 */
class SePicker extends SeField {
  static properties = {
    options: { attribute: false },
    syncKey: { attribute: false },
    placeholder: { type: String },
  };

  static stylesheet = style;

  constructor() {
    super();
    this.options = [];
  }

  get _select() { return this.shadowRoot.querySelector('select'); }

  updated() {
    if (this._select) this._select.value = this.value ?? '';
  }

  handleChange(event) {
    event.stopPropagation();
    const { value } = event.target;
    this.dispatchEvent(new CustomEvent('change', { detail: { value } }));
  }

  render() {
    return this.renderField(html`
      <div class="form-control-wrap">
        <select id="control" class="form-control" ?disabled=${this.disabled}
          @change=${this.handleChange}>
          ${this.placeholder ? html`<option value="" disabled hidden>${this.placeholder}</option>` : nothing}
          ${this.options.map((o) => html`<option value=${o.value}>${o.label}</option>`)}
        </select>
        ${this.renderAlert()}
        ${icon('chevronDown', 'form-picker-chevron')}
      </div>
    `);
  }
}

if (!customElements.get('se-picker')) customElements.define('se-picker', SePicker);
