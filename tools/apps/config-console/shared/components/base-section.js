// External import from importmap - unresolved at lint time
/* eslint-disable import/no-unresolved */
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable no-underscore-dangle, class-methods-use-this */
import { LitElement, html } from 'da-lit';

// Load global stylesheets that all sections need
const NX = 'https://da.live/nx2';
let nexter = null;
let sl = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  [nexter, sl] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
  ]);
} catch {
  // Global styles failed to load - sections will render without base styles
}

/**
 * Base class for all configuration console sections
 * Provides common functionality: loading states, error handling, RUM tracking
 */
// Base class exported as named export for clarity
// eslint-disable-next-line import/prefer-default-export
export class BaseSectionElement extends LitElement {
  static properties = {
    org: { type: String },
    site: { type: String },
    token: { type: String },
    context: { type: Object },
    _loading: { state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this.org = '';
    this.site = '';
    this.token = '';
    this.context = null;
    this._loading = false;
    this._error = null;
  }

  connectedCallback() {
    super.connectedCallback();
    // Combine global styles (nexter, sl) with section-specific styles
    const sectionStyles = this._getStylesheets();
    const allStyles = [nexter, sl, ...sectionStyles].filter(Boolean);
    if (allStyles.length > 0) {
      this.shadowRoot.adoptedStyleSheets = allStyles;
    }
    // Load data when component connects
    this.loadData();
  }

  /**
   * Override: Return array of CSSStyleSheet objects for this section
   * @returns {CSSStyleSheet[]}
   */
  _getStylesheets() {
    return [];
  }

  /**
   * Override: Load section-specific data
   * Subclasses MUST implement this method
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line class-methods-use-this -- Base class method to be overridden
  async loadData() {
    // Subclasses implement
  }

  /**
   * Helper: Show loading state
   * @param {string} message - Optional loading message
   * @returns {TemplateResult}
   */
  _renderLoading(message = 'Loading...') {
    return html`
      <div class="loading-container">
        <div class="spectrum-loading-indicator"></div>
        <p class="loading-label">${message}</p>
      </div>
    `;
  }

  /**
   * Helper: Show error state
   * @param {string} message - Error message
   * @param {Function} onRetry - Optional retry callback
   * @returns {TemplateResult}
   */
  _renderError(message, onRetry = null) {
    const errorMessage = message || this._error;
    return html`
      <div class="error-container">
        <div class="message error">
          ${errorMessage}
        </div>
        ${onRetry ? html`
          <button class="retry-button" @click=${onRetry}>
            Retry
          </button>
        ` : ''}
      </div>
    `;
  }

  /**
   * Helper: Show empty state
   * @param {string} title - Empty state title
   * @param {string} description - Empty state description
   * @returns {TemplateResult}
   */
  _renderEmpty(title, description) {
    return html`
      <div class="empty-state">
        <h3>${title}</h3>
        <p>${description}</p>
      </div>
    `;
  }

  /**
   * Helper: Show success message
   * @param {string} message - Success message
   * @returns {TemplateResult}
   */
  _renderSuccess(message) {
    return html`
      <div class="message success">
        ${message}
      </div>
    `;
  }

  /**
   * Helper: Track section action with RUM
   * @param {string} action - Action name (e.g., 'config-update', 'block-create')
   * @param {Object} data - Additional data to track
   */
  _trackAction(action, data = {}) {
    try {
      window.hlx?.rum?.sampleRUM?.(action, {
        section: this.constructor.name.replace('Section', '').toLowerCase(),
        org: this.org,
        site: this.site,
        ...data,
      });
    } catch {
      // RUM tracking should never break the app - fail silently
    }
  }

  /**
   * Helper: Set loading state
   * @param {boolean} isLoading
   */
  _setLoading(isLoading) {
    this._loading = isLoading;
    if (isLoading) {
      this._error = null; // Clear errors when loading
    }
  }

  /**
   * Helper: Set error state
   * @param {string|Error} error
   */
  _setError(error) {
    this._error = error instanceof Error ? error.message : error;
    this._loading = false;
  }

  /**
   * Helper: Clear error state
   */
  _clearError() {
    this._error = null;
  }

  /**
   * Helper: Handle async operations with automatic loading/error states
   * @param {Function} operation - Async operation to perform
   * @param {string} errorMessage - Error message prefix
   * @returns {Promise<any>}
   */
  async _withLoadingState(operation, errorMessage = 'Operation failed') {
    this._setLoading(true);
    try {
      const result = await operation();
      this._setLoading(false);
      return result;
    } catch (error) {
      this._setError(`${errorMessage}: ${error.message}`);
      throw error;
    }
  }
}
