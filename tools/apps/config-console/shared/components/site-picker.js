/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import { fetchSiteList } from '../api/config-api.js';

// Styles are included in the parent section's CSS file (multi-site-manager.css)
// This follows the same pattern as page-picker in templates/blocks sections

/**
 * Site Picker Component
 * Reusable component for selecting sites from a DA organization
 *
 * Events:
 *  - site-selected: Fired when a site is selected { detail: { site } }
 *  - close: Fired when the picker is closed
 *
 * Properties:
 *  - open: Boolean - Whether the picker is visible
 *  - org: String - Organization name
 *  - title: String - Modal title
 *  - currentValue: String - Currently selected site (to exclude from list)
 */
class SitePicker extends LitElement {
  static properties = {
    open: { type: Boolean },
    org: { type: String },
    title: { type: String },
    currentValue: { type: String },
    _sites: { state: true },
    _loading: { state: true },
    _searchQuery: { state: true },
  };

  constructor() {
    super();
    this.open = false;
    this.org = '';
    this.title = 'Select Site';
    this.currentValue = '';
    this._sites = [];
    this._loading = false;
    this._searchQuery = '';
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Styles are loaded via the section's CSS file (multi-site-manager.css)
    // No need to inject CSS here - follows same pattern as page-picker
  }

  updated(changedProperties) {
    if (changedProperties.has('open') && this.open) {
      this._loadSites();
    }
  }

  async _loadSites() {
    if (!this.org) {
      return;
    }

    this._loading = true;
    this._searchQuery = '';

    try {
      const sites = await fetchSiteList(this.org);
      this._sites = sites || [];
    } catch (error) {
      this._sites = [];
    } finally {
      this._loading = false;
    }
  }

  _handleSearch(e) {
    this._searchQuery = e.target.value.toLowerCase();
  }

  _getFilteredSites() {
    if (!this._searchQuery) return this._sites;

    return this._sites.filter((site) => site.toLowerCase().includes(this._searchQuery));
  }

  _handleSiteClick(site) {
    this.dispatchEvent(new CustomEvent('site-selected', {
      detail: { site },
      bubbles: true,
      composed: true,
    }));
    this._close();
  }

  _handleOverlayClick(e) {
    if (e.target.classList.contains('site-picker-overlay')) {
      this._close();
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('close', {
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    if (!this.open) return nothing;

    const filteredSites = this._getFilteredSites();

    return html`
      <div class="site-picker-overlay" @click=${this._handleOverlayClick}>
        <div class="site-picker-modal">
          <div class="site-picker-header">
            <h2 class="site-picker-title">${this.title}</h2>
            <button class="site-picker-close" @click=${this._close} aria-label="Close">×</button>
          </div>

          <div class="site-picker-search">
            <input
              type="search"
              class="site-picker-search-input"
              placeholder="Search sites..."
              .value=${this._searchQuery}
              @input=${this._handleSearch}
            />
          </div>

          ${this._loading ? html`
            <div class="site-picker-loading">
              <div class="loading-spinner"></div>
              <p>Loading sites...</p>
            </div>
          ` : html`
            <div class="site-picker-list">
              ${filteredSites.length === 0 ? html`
                <div class="site-picker-empty">
                  <p>${this._searchQuery ? 'No sites found matching your search' : 'No sites available'}</p>
                </div>
              ` : html`
                ${filteredSites.map((site) => html`
                  <button
                    class="site-picker-item ${site === this.currentValue ? 'is-current' : ''}"
                    @click=${() => this._handleSiteClick(site)}
                    ?disabled=${site === this.currentValue}
                  >
                    <span class="site-name">${site}</span>
                    ${site === this.currentValue ? html`
                      <span class="current-badge">Current</span>
                    ` : nothing}
                  </button>
                `)}
              `}
            </div>
          `}

          <div class="site-picker-footer">
            <button class="site-picker-cancel" @click=${this._close}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('site-picker', SitePicker);
export default SitePicker;
