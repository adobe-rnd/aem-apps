// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  updateIcons,
  removeLibraryItem,
} from '../../shared/api/library-api.js';
import { MessageHandlerMixin, MessageHandlerProperties } from '../../shared/mixins/message-handler.js';
import { FormHandlerMixin, FormHandlerProperties } from '../../shared/mixins/form-handler.js';
import { LibrarySetupHandlerMixin, LibrarySetupHandlerProperties } from '../../shared/mixins/library-setup-handler.js';
import { LibraryItemsCRUDMixin, LibraryItemsCRUDProperties } from '../../shared/mixins/library-items-crud.js';
import '../../shared/components/library-items-list.js';
import '../../shared/components/library-setup-modal.js';
import '../../components/explainer-info-card.js';

const NX = 'https://da.live/nx2';
let sectionStyles = null;
let commonStyles = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  // Load common styles using absolute path from window.location
  const commonStylesUrl = new URL('/tools/apps/config-console/shared/styles/common-section-styles.css', window.location.origin).href;
  commonStyles = await getStyle(commonStylesUrl);
  sectionStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - section will render without styles
}

/**
 * Icons section component
 */
class IconsSection extends LibraryItemsCRUDMixin(
  LibrarySetupHandlerMixin(
    FormHandlerMixin(MessageHandlerMixin(BaseSectionElement)),
  ),
) {
  static properties = {
    ...BaseSectionElement.properties,
    ...MessageHandlerProperties,
    ...FormHandlerProperties,
    ...LibrarySetupHandlerProperties,
    ...LibraryItemsCRUDProperties,
    _showIconPicker: { state: true },
    _iconPickerFiles: { state: true },
    _iconPickerLoading: { state: true },
    _iconPickerSearch: { state: true },
  };

  constructor() {
    super();
    // _items and _searchQuery now provided by LibraryItemsCRUDMixin
    this._showIconPicker = false;
    this._iconPickerFiles = [];
    this._iconPickerLoading = false;
    this._iconPickerSearch = '';
  }

  _getLibraryType() {
    return 'Icons';
  }

  _getDefaultFormState() {
    return { name: '', path: '' };
  }

  _isFormValid() {
    return this._form.name.trim().length > 0 && this._form.path.trim().length > 0;
  }

  _getUpdateFunction() {
    return updateIcons;
  }

  _getItemFromForm() {
    return {
      name: this._form.name.trim(),
      path: this._form.path.trim(),
    };
  }

  _populateFormFromItem(item) {
    this._form = {
      name: item.key,
      path: item.icon,
    };
  }

  _getStylesheets() {
    return [commonStyles, sectionStyles].filter(Boolean);
  }

  async _handleRemove(item) {
    this._message = null;

    try {
      const result = await removeLibraryItem(
        this.org,
        this.site,
        'icons',
        item.key,
        this.token,
      );

      if (result.success) {
        this._trackAction('icon-remove', {
          org: this.org,
          site: this.site,
          name: item.key,
        });
        await this.loadData();
        this._showMessage('success', 'Icon removed successfully');
      } else {
        throw new Error(result.error || 'Failed to remove icon');
      }
    } catch (error) {
      this._setError(`Failed to remove icon: ${error.message}`);
    }
  }

  async _openIconPicker() {
    this._showIconPicker = true;
    this._iconPickerSearch = '';
    await this._loadIconFiles();
  }

  async _loadIconFiles() {
    this._iconPickerLoading = true;

    try {
      const listUrl = `https://admin.da.live/list/${this.org}/${this.site}/icons`;
      const response = await fetch(listUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (response.ok) {
        const files = await response.json();
        // Filter for SVG files only and load their content
        const svgFiles = files.filter((file) => file.ext === 'svg');

        // Load SVG content for preview
        const filesWithContent = await Promise.all(
          svgFiles.map(async (file) => {
            try {
              const svgUrl = `https://admin.da.live/source/${this.org}/${this.site}/icons/${file.name}.${file.ext}`;
              const svgResponse = await fetch(svgUrl, {
                headers: {
                  Authorization: `Bearer ${this.token}`,
                },
              });

              if (svgResponse.ok) {
                const svgContent = await svgResponse.text();
                return { ...file, svgContent };
              }
              return { ...file, svgContent: null };
            } catch (err) {
              return { ...file, svgContent: null };
            }
          }),
        );

        this._iconPickerFiles = filesWithContent;
      } else {
        this._iconPickerFiles = [];
        this._setError('Failed to load icon files');
      }

      this._iconPickerLoading = false;
    } catch (error) {
      this._setError(`Failed to load icons: ${error.message}`);
      this._iconPickerLoading = false;
      this._iconPickerFiles = [];
    }
  }

  _handleIconPickerSearch(e) {
    this._iconPickerSearch = e.target.value.toLowerCase();
  }

  _handleIconPickerSelect(file) {
    // Set both the path and name fields with the selected icon
    this._form = {
      ...this._form,
      name: this._form.name || file.name, // Auto-populate name if empty
      path: `/icons/${file.name}.${file.ext}`,
    };
    this._showIconPicker = false;
  }

  _handleIconPickerClose() {
    this._showIconPicker = false;
    this._iconPickerFiles = [];
    this._iconPickerSearch = '';
  }

  _getSvgDataUrl(svgContent) {
    if (!svgContent) return null;
    // Convert SVG to data URL
    const encoded = encodeURIComponent(svgContent);
    return `data:image/svg+xml,${encoded}`;
  }

  _renderForm() {
    const isEditing = this._editingIndex >= 0;
    return html`
      <div class="add-new-section">
        <h3>${isEditing ? 'Edit Icon' : 'Add New Icon'}</h3>
        <div class="library-item-form">
          <div class="input-group">
            <label for="icon-name">Icon Name</label>
            <input
              type="text"
              id="icon-name"
              .value=${this._form.name}
              @input=${(e) => this._handleFormChange('name', e.target.value)}
              placeholder="Enter icon name"
            />
          </div>
          <div class="input-group">
            <label for="icon-path">Icon Path (SVG)</label>
            <input
              type="text"
              id="icon-path"
              .value=${this._form.path}
              @input=${(e) => this._handleFormChange('path', e.target.value)}
              placeholder="/path/to/icon.svg"
            />
          </div>
          <button
            class="btn-secondary"
            @click=${this._openPagePicker}
          >Select Icon</button>
          <button
            class="btn-primary"
            @click=${this._handleAdd}
            ?disabled=${!this._isFormValid()}
          >${isEditing ? 'Update' : 'Add'}</button>
          ${isEditing ? html`
            <button
              class="btn-secondary"
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

  _renderExplainerCard() {
    const hasIcons = this._items && this._items.length > 0;
    const status = hasIcons ? 'configured' : 'not-configured';
    const statusLabel = hasIcons ? 'Configured' : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="icons-library-setup"
        title="Icons"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Icons are SVG graphics that appear in the authoring library. Authors insert them as inline visuals without uploading files.</p>
          <p>${!hasIcons ? 'Without icons, authors must upload SVG files manually for each use.' : 'Authors can now insert these icons from the library picker.'} Add icons by providing a name and SVG file path.</p>
          <p>Each icon needs a unique name and path. Icons show in the author's library picker for quick insertion.</p>
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

  _renderCollectionCard() {
    const filteredItems = this._getFilteredItems();

    return html`
      <div class="collection-card">
        <div class="collection-header">
          <h3 class="collection-title">Icon registry</h3>
          <sl-input
            type="search"
            size="small"
            placeholder="Search icons..."
            .value=${this._searchQuery}
            @sl-input=${this._handleSearch}
            @sl-change=${this._handleSearch}
            @input=${this._handleSearch}
            @keyup=${this._handleSearch}
            clearable
          ></sl-input>
        </div>
        ${filteredItems.length === 0 ? html`
          <div class="empty-state">
            ${this._items.length === 0 ? html`
              <div class="empty-state-icon">
                <img src="./icons/icons-image.svg" alt="Icons" width="48" height="48" />
              </div>
              <p class="empty-state-text">No icons yet</p>
              <p>Add a named SVG icon to make it available to authors.</p>
            ` : html`
              <p>No icons found</p>
            `}
          </div>
        ` : html`
          <div class="icon-list">
            ${filteredItems.map((icon) => html`
              <div class="icon-item">
                <div class="icon-info">
                  <div class="icon-name">${icon.key}</div>
                  <div class="icon-path">${icon.icon}</div>
                </div>
                <div class="icon-actions">
                  <button
                    class="icon-action-btn"
                    @click=${() => this._handleEdit(icon)}
                  >Edit</button>
                  <button
                    class="icon-action-btn remove"
                    @click=${() => this._handleRemove(icon)}
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
            + Add icon
          </button>
        </div>
      `;
    }

    return html`
      <div class="add-icon-card">
        <div class="add-icon-header">
          <h3 class="add-icon-title">${isEditing ? 'Edit Icon' : 'Add New Icon'}</h3>
          <button class="btn-icon" @click=${this._toggleAddForm} title="Close">×</button>
        </div>
        <p class="add-icon-description">Icon name and SVG path are captured in a guided form.</p>
        <div class="add-icon-form">
          <div class="form-field">
            <label class="form-label">Icon name</label>
            <sl-input
              type="text"
              size="medium"
              placeholder="Enter icon name"
              .value=${this._form.name}
              @sl-input=${(e) => this._handleFormChange('name', e.target.value)}
            ></sl-input>
          </div>
          <div class="form-field">
            <label class="form-label">Icon path (SVG)</label>
            <div class="form-field-with-button">
              <sl-input
                type="text"
                size="medium"
                placeholder="/icons/icon-name.svg"
                .value=${this._form.path}
                @sl-input=${(e) => this._handleFormChange('path', e.target.value)}
              ></sl-input>
              <sl-button
                size="medium"
                @click=${this._openIconPicker}
              >Browse Icons</sl-button>
            </div>
          </div>
          <div class="form-actions">
            <sl-button
              variant="primary"
              size="small"
              @click=${this._handleAdd}
              ?disabled=${!this._isFormValid()}
            >${isEditing ? 'Update' : 'Add Icon'}</sl-button>
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

  _renderIconPicker() {
    if (!this._showIconPicker) {
      return nothing;
    }

    const filteredFiles = this._iconPickerSearch
      ? this._iconPickerFiles.filter((file) => {
        const fileName = file.name.toLowerCase();
        return fileName.includes(this._iconPickerSearch);
      })
      : this._iconPickerFiles;

    return html`
      <div class="icon-picker-overlay" @click=${this._handleIconPickerClose}>
        <div class="icon-picker-modal" @click=${(e) => e.stopPropagation()}>
          <div class="icon-picker-header">
            <h3>Select Icon (${this._iconPickerFiles.length} SVG files)</h3>
            <button class="icon-picker-close" @click=${this._handleIconPickerClose} aria-label="Close">×</button>
          </div>

          <div class="icon-picker-search">
            <sl-input
              type="text"
              placeholder="Search icons..."
              .value=${this._iconPickerSearch}
              @sl-input=${this._handleIconPickerSearch}
              clearable
            ></sl-input>
          </div>

          <div class="icon-picker-content">
            ${this._iconPickerLoading ? html`
              <div class="icon-picker-loading">Loading icons...</div>
            ` : html`
              ${filteredFiles.length === 0 ? html`
                <div class="icon-picker-empty">
                  ${this._iconPickerSearch ? 'No icons match your search' : 'No SVG files found in /icons folder'}
                </div>
              ` : html`
                <div class="icon-picker-list">
                  ${filteredFiles.map((file) => {
    const dataUrl = this._getSvgDataUrl(file.svgContent);
    return html`
                    <button
                      class="icon-picker-item"
                      @click=${() => this._handleIconPickerSelect(file)}
                    >
                      <span class="icon-picker-item-preview">
                        ${dataUrl ? html`<img src="${dataUrl}" alt="${file.name}" class="icon-preview-img" />` : html`<img src="./icons/icons-image.svg" alt="Icon" class="icon-placeholder" width="16" height="16" />`}
                      </span>
                      <span class="icon-picker-item-name">${file.name}</span>
                    </button>
                  `;
  })}
                </div>
              `}
            `}
          </div>

          <div class="icon-picker-footer">
            <sl-button @click=${this._handleIconPickerClose}>Cancel</sl-button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading icons...');
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
        ${this._renderIconPicker()}
      </div>
      <library-setup-modal
        .open=${this._showLibrarySetup}
        .libraryType=${'Icons'}
        .options=${this._librarySetupOptions}
        .selectedPath=${this._selectedLibraryPath}
        .customPath=${this._customLibraryPathInput}
        @confirm=${this._handleLibrarySetupConfirm}
        @cancel=${this._handleLibrarySetupCancel}
      ></library-setup-modal>
    `;
  }
}

customElements.define('icons-section', IconsSection);
export default IconsSection;
