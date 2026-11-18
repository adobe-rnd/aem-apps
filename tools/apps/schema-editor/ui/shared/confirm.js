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
import { buttons, shared, loadStyle } from './styles.js';
import '../fields/input.js';

await import('https://da.live/nx2/blocks/shared/dialog/dialog.js');

const style = await loadStyle(import.meta.url);

/** Confirmation on nx2 `nx-dialog`; create it through `confirmDialog()`. */
class SeConfirm extends LitElement {
  static properties = {
    heading: { type: String },
    message: { attribute: false },
    confirmLabel: { type: String },
    destructive: { type: Boolean },
    requireText: { type: String },
    _typed: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
  }

  get _canConfirm() {
    return !this.requireText || this._typed === this.requireText;
  }

  resolve(value) {
    if (this._resolved) return;
    this._resolved = true;
    this.onResolve?.(value);
    this.shadowRoot.querySelector('nx-dialog')?.close();
    this.remove();
  }

  _submit(event) {
    event.preventDefault();
    if (this._canConfirm) this.resolve(true);
  }

  render() {
    return html`
      <nx-dialog title=${this.heading ?? ''} @close=${() => this.resolve(false)}>
        <form id="confirm" @submit=${this._submit}>
          ${this.message ? html`<p class="message">${this.message}</p>` : nothing}
          ${this.requireText ? html`
            <se-input autofocus
              label=${`Type "${this.requireText}" to confirm`}
              @input=${(e) => { this._typed = e.target.value; }}></se-input>
          ` : nothing}
        </form>
        <button type="button" slot="actions" class="nx-action-btn"
          @click=${() => this.resolve(false)}>Cancel</button>
        <button type="submit" form="confirm" slot="actions" ?autofocus=${!this.requireText}
          class="nx-btn-accent ${this.destructive ? 'is-destructive' : ''}"
          ?disabled=${!this._canConfirm}
          @click=${this._submit}>${this.confirmLabel ?? 'OK'}</button>
      </nx-dialog>
    `;
  }
}

if (!customElements.get('se-confirm')) customElements.define('se-confirm', SeConfirm);

/** Resolves whether the user confirmed; with `requireText`, they must type it first. */
export function confirmDialog({
  title, message, confirmLabel, destructive = false, requireText,
}) {
  return new Promise((resolve) => {
    const el = document.createElement('se-confirm');
    Object.assign(el, {
      heading: title, message, confirmLabel, destructive, requireText, onResolve: resolve,
    });
    document.body.append(el);
  });
}
