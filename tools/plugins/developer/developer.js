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
/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { fetchBranches } from './api.js';
import { icon } from './icons.js';

const REF_PARAM = 'ref';
const PRODUCTION_LABEL = 'Production (no ref)';

const ERROR_MESSAGES = {
  unauthorized: 'You are not authorized to view branches for this site.',
  'not-found': 'No branches found — check that the organization and site are correct.',
  network: 'Could not reach the admin API. Check your connection and try again.',
};

// NX style pipeline matches other da.live shell apps (e.g. DA Permissions):
// nx.js loadStyle + getStyle for Spectrum/Super Lite (sl-*) styling.
const NX = 'https://da.live/nx2';
let nexter = null;
let sl = null;
let styles = null;
try {
  const [{ default: getStyle }, { loadStyle, getColorScheme }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);
  document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
  await Promise.all([
    loadStyle(`${NX}/styles/styles.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);
  await import(`${NX}/public/sl/components.js`);
  [nexter, sl, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

class DeveloperApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    actions: { attribute: false },
    // 'loading' | 'ready' | 'error'
    _state: { state: true },
    _message: { state: true },
    _branches: { state: true },
    _selected: { state: true },
    _dropdownOpen: { state: true },
    _searchQuery: { state: true },
    _activeIndex: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);

    this._state = 'loading';
    this._message = null;
    this._branches = [];
    this._selected = '';
    this._dropdownOpen = false;
    this._searchQuery = '';
    this._activeIndex = -1;

    this._handleDocMousedown = (e) => {
      if (!this._dropdownOpen) return;
      const field = this.shadowRoot?.querySelector('.branch-field');
      if (field && !e.composedPath().includes(field)) {
        this._dropdownOpen = false;
        this._searchQuery = '';
      }
    };
    document.addEventListener('mousedown', this._handleDocMousedown);

    this.init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('mousedown', this._handleDocMousedown);
  }

  async init() {
    const { org, repo } = this.context;
    const { branches, error } = await fetchBranches(org, repo, this.token);

    if (error) {
      this._message = { text: ERROR_MESSAGES[error] || `Failed to load branches: ${error}` };
      this._state = 'error';
      return;
    }

    if (branches.length === 0) {
      this._message = { text: 'No branches found.' };
      this._state = 'error';
      return;
    }

    this._branches = branches;

    // context.ref reflects the current ?ref= on the top-level page (as
    // parsed by the DA shell), so it doubles as the currently-selected
    // branch — no need to track it ourselves.
    const { ref } = this.context;
    this._selected = branches.includes(ref) ? ref : '';
    this._state = 'ready';
  }

  // ---- Options / filtering ----

  get options() {
    return [{ value: '', label: PRODUCTION_LABEL }, ...this._branches.map((b) => ({ value: b, label: b }))];
  }

  get filteredOptions() {
    const q = this._searchQuery.toLowerCase();
    return q ? this.options.filter((o) => o.label.toLowerCase().includes(q)) : this.options;
  }

  get selectedLabel() {
    if (this._selected === '') return PRODUCTION_LABEL;
    return this._selected;
  }

  // ---- Navigation ----

  selectBranch(branch) {
    this._selected = branch;
    this._dropdownOpen = false;
    this._searchQuery = '';
    this._activeIndex = -1;

    // We can't read the top-level page's query params from inside this
    // iframe (cross-origin), so the target URL is rebuilt from scratch
    // using the DA SDK context instead of mutating the existing one. An
    // empty selection means "no ref" — the param is omitted entirely.
    const {
      org, repo, path, view,
    } = this.context;
    const query = branch ? `?${REF_PARAM}=${branch}` : '';
    const topUrl = `/${view}${query}#/${org}/${repo}${path}`;

    this.actions.setHref(topUrl);
  }

  // ---- Combobox handlers ----

  handleInputFocus() {
    this._dropdownOpen = true;
    this._searchQuery = '';
    this._activeIndex = -1;
  }

  handleInputTyped(e) {
    this._searchQuery = e.target.value;
    this._dropdownOpen = true;
    this._activeIndex = -1;
  }

  handleInputKey(e) {
    const { filteredOptions } = this;
    if (e.key === 'Escape') {
      this._dropdownOpen = false;
      this._searchQuery = '';
      this._activeIndex = -1;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._dropdownOpen = true;
      this._activeIndex = Math.min(this._activeIndex + 1, filteredOptions.length - 1);
      this.scrollActiveItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, -1);
      this.scrollActiveItem();
    } else if (e.key === 'Enter' && this._dropdownOpen && this._activeIndex >= 0) {
      e.preventDefault();
      this.selectBranch(filteredOptions[this._activeIndex].value);
    }
  }

  scrollActiveItem() {
    requestAnimationFrame(() => {
      this.shadowRoot?.querySelector('.branch-dropdown-item.is-active')
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  handleInputBlur() {
    // rAF lets any @click on dropdown items fire before the dropdown closes
    requestAnimationFrame(() => {
      this._dropdownOpen = false;
      this._searchQuery = '';
      this._activeIndex = -1;
    });
  }

  // ---- Render ----

  renderCombobox() {
    const inputVal = this._dropdownOpen ? this._searchQuery : this.selectedLabel;
    return html`
      <div class="branch-field">
        <label for="branch-input" class="branch-label">Branch</label>
        <div class="branch-combobox">
          <sl-input
            type="text"
            id="branch-input"
            autocomplete="off"
            aria-label="Branch"
            aria-expanded=${this._dropdownOpen}
            aria-haspopup="listbox"
            .value=${inputVal}
            @focus=${this.handleInputFocus}
            @input=${this.handleInputTyped}
            @keydown=${this.handleInputKey}
            @sl-blur=${this.handleInputBlur}
          ></sl-input>
          <span class="branch-chevron ${this._dropdownOpen ? 'is-open' : ''}" aria-hidden="true">
            ${icon('Smock_ChevronDown_18_N', 18, 18, '0 0 18 18')}
          </span>
          ${this._dropdownOpen ? html`
            <div class="branch-dropdown" role="listbox">
              ${this.filteredOptions.map((option, i) => html`
                <button
                  class="branch-dropdown-item ${this._selected === option.value ? 'is-selected' : ''} ${this._activeIndex === i ? 'is-active' : ''}"
                  role="option"
                  @click=${() => this.selectBranch(option.value)}
                >${option.label}</button>
              `)}
              ${this.filteredOptions.length === 0 ? html`
                <p class="branch-dropdown-empty">No branches match</p>
              ` : nothing}
            </div>
          ` : nothing}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <p class="branch-description">Use a developer branch for the preview in the layout mode by selecting one from the list below. Select nothing to use the production branch.</p>
      ${this._state === 'loading' ? html`
        <div class="status-message loading" role="status" aria-live="polite">Loading branches…</div>
      ` : nothing}
      ${this._state === 'error' ? html`
        <div class="status-message error" role="status" aria-live="polite">${this._message?.text}</div>
      ` : nothing}
      ${this._state === 'ready' ? this.renderCombobox() : nothing}
    `;
  }
}

customElements.define('developer-app', DeveloperApp);

(async function init() {
  const {
    context, token, actions,
  } = await DA_SDK;
  const cmp = document.createElement('developer-app');
  cmp.context = context;
  cmp.token = token;
  cmp.actions = actions;
  document.body.append(cmp);
}());
