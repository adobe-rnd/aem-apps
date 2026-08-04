// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import '../../components/explainer-info-card.js';

// Get stylesheet for this section
const NX = 'https://da.live/nx2';
let sectionStyles = null;
try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  sectionStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - section will render without styles
}

/**
 * Multi-Site Manager Section Component
 * Early access feature for managing multiple sites
 */
export default class MultiSiteManagerSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
  };

  _getStylesheets() {
    return sectionStyles ? [sectionStyles] : [];
  }

  async loadData() {
    // Multi-Site Manager is in early access
    // Configuration will be loaded here when available
    this._setLoading(false);
  }

  _renderExplainerCard() {
    return html`
      <explainer-info-card
        cardId="multi-site-manager-integration"
        title="Multi-Site Manager"
        status="not-configured"
        statusLabel="Early Access"
      >
        <div slot="content">
          <p>Manage relationships between multiple sites, share content and configuration, and control inheritance rules from one place.</p>
          <p>This feature is in early access. Configuration options will be available when it exits early access. Without it, each site operates independently without shared workflows.</p>
          <p>Check the documentation for updates on availability and features.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/about/early-access/multi-site-manager"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Multi-Site Manager Docs</a>
        </div>
      </explainer-info-card>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading Multi-Site Manager...');
    }

    if (this._error) {
      return this._renderError(this._error);
    }

    return html`
      <div class="section-container">
        ${this._renderExplainerCard()}

        <div class="settings-card">
          <h3 class="settings-card-title">Configuration</h3>
          <div class="empty-state">
            <p class="empty-state-title">Configuration Coming Soon</p>
            <p class="empty-state-description">
              Multi-Site Manager configuration options will be available when this feature exits early access.
              Check the documentation for the latest updates.
            </p>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('multi-site-manager-section', MultiSiteManagerSection);
