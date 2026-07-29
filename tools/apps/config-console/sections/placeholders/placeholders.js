// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  fetchLibraryJSON,
  getSheetDataArray,
  updatePlaceholders,
  removeLibraryItem,
} from '../../shared/api/library-api.js';
import '../../shared/components/library-items-list.js';

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
 * Placeholders section component
 */
class PlaceholdersSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _placeholders: { state: true },
    _searchQuery: { state: true },
    _form: { state: true },
    _editingIndex: { state: true },
    _message: { state: true },
  };

  constructor() {
    super();
    this._placeholders = [];
    this._searchQuery = '';
    this._form = { key: '', value: '' };
    this._editingIndex = -1;
    this._message = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);
  }

  // eslint-disable-next-line class-methods-use-this
  _getStylesheets() {
    return [nexter, sl, styles].filter(Boolean);
  }

  async loadData() {
    this._setLoading(true);
    this._trackAction('placeholders-load', { org: this.org, site: this.site });

    try {
      const json = await fetchLibraryJSON(this.org, this.site, 'placeholders', this.token);
      this._placeholders = getSheetDataArray(json);
      this._setLoading(false);
    } catch (error) {
      this._setError(`Failed to load placeholders: ${error.message}`);
    }
  }

  _handleSearch(e) {
    this._searchQuery = e.target.value;
  }

  _handleFormChange(field, value) {
    this._form = { ...this._form, [field]: value };
  }

  _isFormValid() {
    return this._form.key.trim().length > 0 && this._form.value.trim().length > 0;
  }

  async _handleAdd() {
    if (!this._isFormValid()) return;

    this._setLoading(true);
    this._message = null;

    try {
      const newPlaceholder = {
        key: this._form.key.trim(),
        value: this._form.value.trim(),
      };

      const result = await updatePlaceholders(
        this.org,
        this.site,
        [newPlaceholder],
        this.token,
      );

      if (result.success) {
        this._trackAction('placeholder-add', {
          org: this.org,
          site: this.site,
          key: newPlaceholder.key,
        });
        this._form = { key: '', value: '' };
        this._editingIndex = -1;
        await this.loadData();
        this._message = { type: 'success', text: 'Placeholder added successfully' };
      } else {
        throw new Error(result.error || 'Failed to add placeholder');
      }
    } catch (error) {
      this._setError(`Failed to add placeholder: ${error.message}`);
    }
  }

  _handleEdit(item) {
    const index = this._placeholders.indexOf(item);
    this._editingIndex = index;
    // Note: placeholders have inverted key/value in storage
    this._form = {
      key: item.key,
      value: item.value,
    };
    this._message = null;
  }

  _handleCancelEdit() {
    this._editingIndex = -1;
    this._form = { key: '', value: '' };
    this._message = null;
  }

  async _handleRemove(item) {
    this._setLoading(true);
    this._message = null;

    try {
      // Use the 'value' field as the key for removal (placeholders are stored inverted)
      const result = await removeLibraryItem(
        this.org,
        this.site,
        'placeholders',
        item.value,
        this.token,
      );

      if (result.success) {
        this._trackAction('placeholder-remove', {
          org: this.org,
          site: this.site,
          key: item.value,
        });
        await this.loadData();
        this._message = { type: 'success', text: 'Placeholder removed successfully' };
      } else {
        throw new Error(result.error || 'Failed to remove placeholder');
      }
    } catch (error) {
      this._setError(`Failed to remove placeholder: ${error.message}`);
    }
  }

  _renderForm() {
    const isEditing = this._editingIndex >= 0;
    return html`
      <div class="add-new-section">
        <h3>${isEditing ? 'Edit Placeholder' : 'Add New Placeholder'}</h3>
        <div class="library-item-form placeholders-form">
          <div class="input-group">
            <label for="placeholder-key">Placeholder Key</label>
            <input
              type="text"
              id="placeholder-key"
              .value=${this._form.key}
              @input=${(e) => this._handleFormChange('key', e.target.value)}
              placeholder="{{placeholder-key}}"
            />
          </div>
          <div class="input-group">
            <label for="placeholder-value">Placeholder Value</label>
            <input
              type="text"
              id="placeholder-value"
              .value=${this._form.value}
              @input=${(e) => this._handleFormChange('value', e.target.value)}
              placeholder="Replacement text"
            />
          </div>
          <button
            class="action primary"
            @click=${this._handleAdd}
            ?disabled=${!this._isFormValid()}
          >${isEditing ? 'Update' : 'Add'}</button>
          ${isEditing ? html`
            <button
              class="action secondary"
              @click=${this._handleCancelEdit}
            >Cancel</button>
          ` : nothing}
        </div>
      </div>
    `;
  }

  _renderMessage() {
    if (!this._message) return nothing;
    return html`
      <div class="message ${this._message.type}">
        ${this._message.text}
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading placeholders...');
    }

    if (this._error) {
      return this._renderError(this._error, () => this.loadData());
    }

    return html`
      <div class="section-container">
        <div class="section-header">
          <div>
            <h2>Placeholders</h2>
            <p class="section-description">Manage text placeholders for your site</p>
          </div>
          <div class="search-container">
            <input
              type="search"
              class="library-search"
              placeholder="Search placeholders..."
              .value=${this._searchQuery}
              @input=${this._handleSearch}
            />
          </div>
        </div>

        ${this._renderMessage()}

        <div class="existing-items-list">
          <h3>Existing Placeholders (${this._placeholders.length})</h3>
          <library-items-list
            .items=${this._placeholders}
            itemType="placeholder"
            .searchQuery=${this._searchQuery}
            .onEdit=${(item) => this._handleEdit(item)}
            .onRemove=${(item) => this._handleRemove(item)}
          ></library-items-list>
        </div>

        ${this._renderForm()}
      </div>
    `;
  }
}

customElements.define('placeholders-section', PlaceholdersSection);
export default PlaceholdersSection;
