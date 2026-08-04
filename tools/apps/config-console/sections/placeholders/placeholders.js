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
import { getLibraryPath } from '../../shared/api/config-api.js';
import { MessageHandlerMixin, MessageHandlerProperties } from '../../shared/mixins/message-handler.js';
import { FormHandlerMixin, FormHandlerProperties } from '../../shared/mixins/form-handler.js';
import { LibrarySetupHandlerMixin, LibrarySetupHandlerProperties } from '../../shared/mixins/library-setup-handler.js';
import '../../shared/components/library-items-list.js';
import '../../shared/components/library-setup-modal.js';
import '../../components/explainer-info-card.js';

const NX = 'https://da.live/nx2';
let sectionStyles = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  sectionStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - section will render without styles
}

/**
 * Placeholders section component
 */
class PlaceholdersSection extends LibrarySetupHandlerMixin(
  FormHandlerMixin(MessageHandlerMixin(BaseSectionElement)),
) {
  static properties = {
    ...BaseSectionElement.properties,
    ...MessageHandlerProperties,
    ...FormHandlerProperties,
    ...LibrarySetupHandlerProperties,
    _placeholders: { state: true },
    _searchQuery: { state: true },
  };

  constructor() {
    super();
    this._placeholders = [];
    this._searchQuery = '';
  }

  _getLibraryType() {
    return 'Placeholders';
  }

  _getDefaultFormState() {
    return { key: '', value: '' };
  }

  _isFormValid() {
    return this._form.key.trim().length > 0 && this._form.value.trim().length > 0;
  }

  _getStylesheets() {
    return sectionStyles ? [sectionStyles] : [];
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

  async _handleAdd() {
    if (!this._isFormValid()) return;

    // Check if library is configured first
    const libraryPath = await getLibraryPath(this.org, this.site, 'placeholders', this.token);
    if (!libraryPath) {
      // Library not configured - show setup modal
      await this._showLibrarySetupModal();
      return;
    }

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
        const action = result.stats?.updated > 0 ? 'placeholder-update' : 'placeholder-add';
        const message = result.stats?.updated > 0
          ? 'Placeholder updated successfully'
          : 'Placeholder added successfully';

        this._trackAction(action, {
          org: this.org,
          site: this.site,
          key: newPlaceholder.key,
        });
        this._form = { key: '', value: '' };
        this._editingIndex = -1;
        this._showAddForm = false;
        await this.loadData();
        this._showMessage('success', message);
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
    this._showAddForm = true;
    this._clearMessage();
  }

  async _handleRemove(item) {
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
        this._showMessage('success', 'Placeholder removed successfully');
      } else {
        throw new Error(result.error || 'Failed to remove placeholder');
      }
    } catch (error) {
      this._setError(`Failed to remove placeholder: ${error.message}`);
    }
  }

  _renderExplainerCard() {
    const hasPlaceholders = this._placeholders && this._placeholders.length > 0;
    const status = hasPlaceholders ? 'configured' : 'not-configured';
    const statusLabel = hasPlaceholders ? 'Configured' : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="placeholders-library-setup"
        title="Placeholders"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Placeholders are text substitutions that keep repeated content consistent. Use them for product names, legal copy, version numbers, or any text used across pages.</p>
          <p>${!hasPlaceholders ? 'Without placeholders, authors must copy-paste or retype repeated text.' : 'Authors can now insert these placeholders from the library picker.'} When the placeholder value changes, it updates everywhere.</p>
          <p>Each placeholder needs a key and value. Placeholders show in the author's library picker for quick insertion.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/administrators/guides/setup-library"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Setup Library Docs</a>
        </div>
      </explainer-info-card>
    `;
  }

  _getFilteredPlaceholders() {
    if (!this._searchQuery) return this._placeholders;
    const query = this._searchQuery.toLowerCase();
    return this._placeholders.filter((p) => p.key.toLowerCase().includes(query)
      || p.value.toLowerCase().includes(query));
  }

  _renderCollectionCard() {
    const filteredPlaceholders = this._getFilteredPlaceholders();

    return html`
      <div class="collection-card">
        <div class="collection-header">
          <h3 class="collection-title">Placeholders</h3>
          <sl-input
            type="search"
            size="small"
            placeholder="Search placeholders..."
            .value=${this._searchQuery}
            @sl-input=${this._handleSearch}
            @sl-change=${this._handleSearch}
            @input=${this._handleSearch}
            @keyup=${this._handleSearch}
            clearable
          ></sl-input>
        </div>
        ${filteredPlaceholders.length === 0 ? html`
          <div class="empty-state">
            ${this._placeholders.length === 0 ? html`
              <div class="empty-state-icon">
                <img src="./icons/placeholders-variable.svg" alt="Placeholders" width="48" height="48" />
              </div>
              <p class="empty-state-text">No placeholders yet</p>
              <p>Add a text placeholder to make it available to authors.</p>
            ` : html`
              <p>No placeholders found</p>
            `}
          </div>
        ` : html`
          <div class="placeholder-list">
            ${filteredPlaceholders.map((placeholder) => html`
              <div class="placeholder-item">
                <div class="placeholder-info">
                  <div class="placeholder-key">${placeholder.key}</div>
                  <div class="placeholder-value">${placeholder.value}</div>
                </div>
                <div class="placeholder-actions">
                  <button
                    class="placeholder-action-btn"
                    @click=${() => this._handleEdit(placeholder)}
                  >Edit</button>
                  <button
                    class="placeholder-action-btn remove"
                    @click=${() => this._handleRemove(placeholder)}
                  >Remove</button>
                </div>
              </div>
            `)}
          </div>
        `}
      </div>
    `;
  }

  _renderAddCard() {
    const isEditing = this._editingIndex >= 0;

    if (!this._showAddForm) {
      return html`
        <div class="add-button-container">
          <button class="add-scope-btn" @click=${this._toggleAddForm}>
            + Add placeholder
          </button>
        </div>
      `;
    }

    return html`
      <div class="add-placeholder-card">
        <div class="add-placeholder-header">
          <h3 class="add-placeholder-title">${isEditing ? 'Edit Placeholder' : 'Add New Placeholder'}</h3>
          <button class="btn-icon" @click=${this._toggleAddForm} title="Close">×</button>
        </div>
        <p class="add-placeholder-description">Placeholder key and value are captured in a guided form.</p>
        <div class="add-placeholder-form">
          <div class="form-field">
            <label class="form-label">Placeholder key</label>
            <sl-input
              type="text"
              size="medium"
              placeholder="{{placeholder-key}}"
              .value=${this._form.key}
              @input=${(e) => this._handleFormChange('key', e.target.value)}
              @sl-input=${(e) => this._handleFormChange('key', e.target.value)}
            ></sl-input>
          </div>
          <div class="form-field">
            <label class="form-label">Placeholder value</label>
            <sl-input
              type="text"
              size="medium"
              placeholder="Replacement text"
              .value=${this._form.value}
              @input=${(e) => this._handleFormChange('value', e.target.value)}
              @sl-input=${(e) => this._handleFormChange('value', e.target.value)}
            ></sl-input>
          </div>
          <div class="form-actions">
            <sl-button
              variant="primary"
              size="small"
              @click=${this._handleAdd}
              ?disabled=${!this._isFormValid()}
            >${isEditing ? 'Update' : 'Add Placeholder'}</sl-button>
            ${isEditing ? html`
              <sl-button
                size="small"
                @click=${this._handleCancelEdit}
              >Cancel</sl-button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  _renderMessage() {
    return html`
      <div class="message-container">
        ${this._message ? html`
          <div class="message ${this._message.type}">
            ${this._message.text}
          </div>
        ` : nothing}
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading placeholders...');
    }

    if (this._error) {
      return this._renderError(this._error);
    }

    return html`
      <div class="section-container">
        ${this._renderExplainerCard()}
        ${this._renderMessage()}
        ${this._renderCollectionCard()}
        ${this._renderAddCard()}
        <library-setup-modal
          .open=${this._showLibrarySetup}
          .libraryType=${'Placeholders'}
          .options=${this._librarySetupOptions}
          .selectedPath=${this._selectedLibraryPath}
          .customPath=${this._customLibraryPathInput}
          @confirm=${this._handleLibrarySetupConfirm}
          @cancel=${this._handleLibrarySetupCancel}
        ></library-setup-modal>
      </div>
    `;
  }
}

customElements.define('placeholders-section', PlaceholdersSection);
export default PlaceholdersSection;
