// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { LitElement, html } from 'da-lit';

const NX = 'https://da.live/nx2';
let nexter = null;
let sl = null;
let styles = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  [nexter, sl, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch {
  // Styles failed to load - section will render without styles

}

/**
 * Reusable library items list component
 * Used by templates, icons, and placeholders sections
 */
// Component exported as named export for Web Components registration
// eslint-disable-next-line import/prefer-default-export
export class LibraryItemsList extends LitElement {
  static properties = {
    items: { type: Array },
    itemType: { type: String },
    searchQuery: { type: String },
    onEdit: { type: Function },
    onRemove: { type: Function },
    _confirmRemove: { state: true },
  };

  constructor() {
    super();
    this.items = [];
    this.itemType = 'item';
    this.searchQuery = '';
    this.onEdit = null;
    this.onRemove = null;
    this._confirmRemove = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);
  }

  /**
   * Get field configuration based on item type
   */
  get _fieldConfig() {
    const configs = {
      template: {
        nameField: 'key',
        valueField: 'value',
        nameLabel: 'Template Name',
        valueLabel: 'Template Path',
      },
      icon: {
        nameField: 'key',
        valueField: 'icon',
        nameLabel: 'Icon Name',
        valueLabel: 'Icon Path',
      },
      placeholder: {
        nameField: 'value',
        valueField: 'key',
        nameLabel: 'Placeholder Key',
        valueLabel: 'Placeholder Value',
      },
    };
    return configs[this.itemType] || configs.template;
  }

  /**
   * Filter items based on search query
   */
  get _filteredItems() {
    if (!this.searchQuery) return this.items;
    const query = this.searchQuery.toLowerCase();
    const { nameField, valueField } = this._fieldConfig;
    return this.items.filter((item) => {
      const name = (item[nameField] || '').toLowerCase();
      const value = (item[valueField] || '').toLowerCase();
      return name.includes(query) || value.includes(query);
    });
  }

  _handleConfirmRemove(item) {
    this._confirmRemove = item;
  }

  _handleCancelRemove() {
    this._confirmRemove = null;
  }

  _handleDoRemove(item) {
    this._confirmRemove = null;
    if (this.onRemove) {
      this.onRemove(item);
    }
  }

  _renderItem(item) {
    const { nameField, valueField } = this._fieldConfig;
    const name = item[nameField];
    const value = item[valueField];
    const isConfirming = this._confirmRemove === item;

    return html`
      <div class="library-item">
        <div class="item-content">
          <div class="item-name">${name}</div>
          <div class="item-value">${value}</div>
        </div>
        <div class="item-actions">
          ${isConfirming ? html`
            <span class="confirm-label">Remove?</span>
            <button
              class="confirm-btn confirm-yes"
              @click=${() => this._handleDoRemove(item)}
              aria-label="Confirm remove ${name}"
            >Yes</button>
            <button
              class="confirm-btn confirm-no"
              @click=${this._handleCancelRemove}
              aria-label="Cancel"
            >No</button>
          ` : html`
            <button
              class="edit-item-btn"
              @click=${() => this.onEdit?.(item)}
              aria-label="Edit ${name}"
            >Edit</button>
            <button
              class="remove-item-btn"
              @click=${() => this._handleConfirmRemove(item)}
              aria-label="Remove ${name}"
            >Remove</button>
          `}
        </div>
      </div>
    `;
  }

  render() {
    const filtered = this._filteredItems;

    if (this.items.length === 0) {
      return html`
        <div class="empty-state">
          <p>No ${this.itemType}s found.</p>
        </div>
      `;
    }

    if (filtered.length === 0) {
      return html`
        <div class="no-results">
          <p>No ${this.itemType}s match your search.</p>
        </div>
      `;
    }

    return html`
      <div class="items-list">
        ${filtered.map((item) => this._renderItem(item))}
      </div>
    `;
  }
}

customElements.define('library-items-list', LibraryItemsList);
