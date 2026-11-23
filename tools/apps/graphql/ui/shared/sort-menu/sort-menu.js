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
import { icon } from '../../utils/icons.js';
import { isSameSort } from '../../utils/list.js';
import 'https://da.live/nx2/blocks/shared/popover/popover.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-sort-menu';

// As on da.live browse: a Sort button whose popover lists every order, the current one checked.
// `options` are [{ key, direction, label }]; picking one emits `sort-change` with that sort.
class SortMenu extends LitElement {
  static properties = {
    options: { attribute: false },
    sort: { attribute: false },
    _open: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, style];
  }

  get popover() {
    return this.shadowRoot.querySelector('nx-popover');
  }

  async toggle({ currentTarget }) {
    if (this._open) {
      this.popover.close();
      return;
    }
    this._open = true;
    this.popover.show({ anchor: currentTarget, placement: 'auto' });
    // nx-popover stays hidden until its positioning frame, so focus after it.
    await this.popover.updateComplete;
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
    this.popover.querySelector('[aria-pressed="true"]')?.focus();
  }

  close() {
    this.popover?.close();
    this.shadowRoot.querySelector('.sort-btn')?.focus();
  }

  pick({ key, direction }) {
    this.dispatchEvent(new CustomEvent('sort-change', { detail: { key, direction } }));
    this.close();
  }

  handleKeydown(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    this.close();
  }

  renderOption(option) {
    const selected = isSameSort(option, this.sort);
    return html`
      <button type="button" class="nx-action-btn-quiet sort-option"
        aria-pressed=${selected ? 'true' : 'false'} @click=${() => this.pick(option)}>
        ${icon({ name: 'checkmark', className: selected ? 'check' : 'check unchecked' })}
        <span>${option.label}</span>
      </button>`;
  }

  render() {
    const current = this.options.find((option) => isSameSort(option, this.sort))?.label ?? '';
    return html`
      <button type="button" class="nx-action-btn-quiet sort-btn" title="Sorted by ${current}"
        aria-label="Sort: ${current}" aria-haspopup="dialog"
        aria-expanded=${this._open ? 'true' : 'false'} @click=${this.toggle}>
        ${icon({ name: 'sort' })}<span class="label">Sort</span>
      </button>
      <nx-popover class="sort-popover" role="dialog" aria-label="Sort"
        @close=${() => { this._open = false; }} @keydown=${this.handleKeydown}>
        ${this.options.map((option) => this.renderOption(option))}
      </nx-popover>`;
  }
}

customElements.define(EL_NAME, SortMenu);
