// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle */
import { LitElement, html } from 'da-lit';

// Get stylesheet for this component
const NX = 'https://da.live/nx2';
let componentStyles = null;
try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  componentStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - component will render without styles
}

/**
 * Reusable explainer info card component matching Permissions pattern
 * - Closable with X button
 * - Blue accent border
 * - Remembers dismissed state in localStorage
 * - Shows restore button when dismissed
 */
class ExplainerInfoCard extends LitElement {
  static properties = {
    cardId: { type: String }, // Unique ID for localStorage
    title: { type: String },
    status: { type: String }, // "not-configured", "configured", "inherited"
    statusLabel: { type: String },
    _dismissed: { state: true },
  };

  constructor() {
    super();
    this.cardId = '';
    this.title = '';
    this.status = '';
    this.statusLabel = '';
    this._dismissed = false;
  }

  connectedCallback() {
    super.connectedCallback();
    if (componentStyles) {
      this.shadowRoot.adoptedStyleSheets = [componentStyles];
    }
    this._loadDismissedState();
  }

  _loadDismissedState() {
    if (!this.cardId) return;
    try {
      const dismissed = localStorage.getItem(`explainer-card-${this.cardId}-dismissed`);
      this._dismissed = dismissed === 'true';
    } catch {
      this._dismissed = false;
    }
  }

  _saveDismissedState() {
    if (!this.cardId) return;
    try {
      localStorage.setItem(`explainer-card-${this.cardId}-dismissed`, String(this._dismissed));
    } catch {
      // localStorage failed
    }
  }

  _handleDismiss() {
    this._dismissed = true;
    this._saveDismissedState();
  }

  _handleRestore() {
    this._dismissed = false;
    this._saveDismissedState();
  }

  render() {
    if (this._dismissed) {
      return html`
        <button class="show-info-button" @click=${this._handleRestore}>
          <span class="show-info-icon">
            <img src="./icons/info-circle.svg" alt="Info" width="16" height="16" />
          </span>
          <span>Show ${this.title} info</span>
        </button>
      `;
    }

    return html`
      <div class="info-card">
        <div class="info-card-header">
          <div class="info-card-title-row">
            <h3 class="info-card-title">${this.title}</h3>
            ${this.status && this.statusLabel ? html`
              <span class="status-pill ${this.status}">${this.statusLabel}</span>
            ` : ''}
          </div>
          <button
            class="close-button"
            @click=${this._handleDismiss}
            title="Dismiss this info card"
            aria-label="Dismiss this info card"
          >×</button>
        </div>
        <div class="info-card-content">
          <slot name="content"></slot>
        </div>
        <div class="info-card-actions">
          <slot name="actions"></slot>
        </div>
      </div>
    `;
  }
}

customElements.define('explainer-info-card', ExplainerInfoCard);
export default ExplainerInfoCard;
