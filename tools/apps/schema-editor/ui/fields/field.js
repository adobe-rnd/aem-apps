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
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { icon } from '../shared/icons.js';

export const fieldStyles = await loadStyle(import.meta.url);

/** A field's help text or, while it is invalid, its error in its place (Spectrum). */
export function fieldMessages({ error, description }) {
  if (error) return html`<p class="form-field-error">${error}</p>`;
  return description ? html`<p class="form-field-description">${description}</p>` : nothing;
}

/**
 * Base of the labelled fields. A field may set `static stylesheet` (adopted after the shared
 * one) and renders its control through `renderField`, with `id="control"` so the label names it.
 */
export class SeField extends LitElement {
  static properties = {
    value: { type: String },
    label: { type: String },
    description: { type: String },
    error: { type: String },
    required: { type: Boolean },
    disabled: { type: Boolean, reflect: true },
    /** Optional `(text) => text` applied as the user types, keeping the caret in place. */
    normalize: { attribute: false },
  };

  connectedCallback() {
    super.connectedCallback();
    const own = this.constructor.stylesheet;
    this.shadowRoot.adoptedStyleSheets = own ? [fieldStyles, own] : [fieldStyles];
  }

  focus() {
    this.shadowRoot.querySelector('#control')?.focus();
  }

  /** Focuses the control with its text selected, so typing replaces it. */
  async focusAndSelect() {
    await this.updateComplete;
    this.focus();
    this.shadowRoot.querySelector('#control')?.select?.();
  }

  /** Copies the control's value and re-dispatches its event; `change` isn't composed. */
  relay(event) {
    const control = event.target;
    if (this.normalize && !event.isComposing) {
      const { value, selectionEnd } = control;
      const next = this.normalize(value);
      if (next !== value) {
        const caret = this.normalize(value.slice(0, selectionEnd ?? value.length)).length;
        control.value = next;
        control.setSelectionRange(caret, caret);
      }
    }
    this.value = control.value;
    this.dispatchEvent(new event.constructor(event.type, event));
  }

  renderAlert() {
    return this.error ? icon('alert', 'form-field-icon') : nothing;
  }

  renderField(control) {
    const required = this.required ? html`<span class="form-required">*</span>` : nothing;
    return html`
      <div class="form-field${this.error ? ' has-error' : ''}">
        ${this.label ? html`<label for="control">${this.label}${required}</label>` : nothing}
        ${control}
        ${fieldMessages(this)}
      </div>
    `;
  }
}
