// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  updateTemplates,
  removeLibraryItem,
} from '../../shared/api/library-api.js';
import { MessageHandlerMixin, MessageHandlerProperties } from '../../shared/mixins/message-handler.js';
import { FormHandlerMixin, FormHandlerProperties } from '../../shared/mixins/form-handler.js';
import { LibrarySetupHandlerMixin, LibrarySetupHandlerProperties } from '../../shared/mixins/library-setup-handler.js';
import { LibraryItemsCRUDMixin, LibraryItemsCRUDProperties } from '../../shared/mixins/library-items-crud.js';
import '../../shared/components/library-items-list.js';
import '../../shared/components/library-setup-modal.js';
import '../../shared/components/page-picker.js';
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
 * Templates section component
 */
class TemplatesSection extends LibraryItemsCRUDMixin(
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
    _showPagePicker: { state: true },
    _selectedPages: { state: true },
  };

  constructor() {
    super();
    // _items and _searchQuery now provided by LibraryItemsCRUDMixin
    this._showPagePicker = false;
    this._selectedPages = [];
  }

  _getLibraryType() {
    return 'Templates';
  }

  _getDefaultFormState() {
    return { name: '', path: '' };
  }

  _isFormValid() {
    return this._form?.name?.trim()?.length > 0 && this._form?.path?.trim()?.length > 0;
  }

  _getUpdateFunction() {
    return updateTemplates;
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
      path: item.value,
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
        'templates',
        item.key,
        this.token,
      );

      if (result.success) {
        this._trackAction('template-remove', {
          org: this.org,
          site: this.site,
          name: item.key,
        });
        await this.loadData();
        this._showMessage('success', 'Template removed successfully');
      } else {
        throw new Error(result.error || 'Failed to remove template');
      }
    } catch (error) {
      this._setError(`Failed to remove template: ${error.message}`);
    }
  }

  _openPagePicker() {
    this._showPagePicker = true;
  }

  _handlePageSelected(e) {
    // Set the path field with the selected page
    this._form = {
      ...this._form,
      path: `/${e.detail.path}`,
    };
  }

  _handlePagePickerClose() {
    this._showPagePicker = false;
  }

  // Hook called after library setup is complete
  async _onLibrarySetupComplete() {
    // If user was trying to add a template, proceed with that now
    if (this._form.name && this._form.path) {
      const newTemplate = {
        name: this._form.name.trim(),
        path: this._form.path.trim(),
      };

      const addResult = await updateTemplates(
        this.org,
        this.site,
        [newTemplate],
        this.token,
      );

      if (addResult.success) {
        const action = addResult.stats?.updated > 0 ? 'template-update' : 'template-add';
        const message = addResult.stats?.updated > 0
          ? 'Template updated successfully'
          : 'Template added successfully';

        this._trackAction(action, {
          org: this.org,
          site: this.site,
          name: newTemplate.name,
        });
        this._form = this._getDefaultFormState();
        this._editingIndex = -1;
        this._showAddForm = false;
        await this.loadData();
        this._showMessage('success', message);
      } else {
        throw new Error(addResult.error || 'Failed to add template');
      }
    }
  }

  _renderForm() {
    const isEditing = this._editingIndex >= 0;
    return html`
      <div class="add-new-section">
        <h3>${isEditing ? 'Edit Template' : 'Add New Template'}</h3>
        <div class="library-item-form">
          <div class="input-group">
            <label for="template-name">Template Name</label>
            <input
              type="text"
              id="template-name"
              .value=${this._form.name}
              @input=${(e) => this._handleFormChange('name', e.target.value)}
              placeholder="Enter template name"
            />
          </div>
          <div class="input-group">
            <label for="template-path">Example Page</label>
            <input
              type="text"
              id="template-path"
              .value=${this._form.path}
              @input=${(e) => this._handleFormChange('path', e.target.value)}
              placeholder="/index or /page-path"
            />
          </div>
          <button
            class="btn-secondary"
            @click=${this._openPagePicker}
          >Select Page</button>
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

  _renderExplainerCard() {
    const hasTemplates = this._items && this._items.length > 0;
    const status = hasTemplates ? 'configured' : 'not-configured';
    const statusLabel = hasTemplates ? 'Configured' : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="templates-library-setup"
        title="Templates"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Templates are reusable page starting points that appear in the authoring library. Authors use them to create consistent pages with predefined structure.</p>
          <p>${!hasTemplates ? 'Without templates, authors start from blank pages.' : 'Authors can now create pages from these templates.'} Add templates by selecting example pages that will be copied into your library.</p>
          <p>Each template needs a name and an example page. The example page is copied to your library and shown in the author's template picker.</p>
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
          <h3 class="collection-title">Templates</h3>
          <sl-input
            type="search"
            size="small"
            placeholder="Search templates..."
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
              <div class="empty-state-icon">📄</div>
              <p class="empty-state-text">No templates yet</p>
              <p>Add a named template to make it available to authors.</p>
            ` : html`
              <p>No templates found</p>
            `}
          </div>
        ` : html`
          <div class="template-list">
            ${filteredItems.map((template) => html`
              <div class="template-item">
                <div class="template-info">
                  <div class="template-name">${template.key}</div>
                  <div class="template-path">${template.value}</div>
                </div>
                <div class="template-actions">
                  <button
                    class="template-action-btn"
                    @click=${() => this._handleEdit(template)}
                  >Edit</button>
                  <button
                    class="template-action-btn remove"
                    @click=${() => this._handleRemove(template)}
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
            + Add template
          </button>
        </div>
      `;
    }

    return html`
      <div class="add-template-card">
        <div class="add-template-header">
          <h3 class="add-template-title">${isEditing ? 'Edit Template' : 'Add New Template'}</h3>
          <button class="btn-icon" @click=${this._toggleAddForm} title="Close">×</button>
        </div>
        <p class="add-template-description">Template name and example page are captured in a guided form. The example page will be copied to your library templates folder.</p>
        <div class="add-template-form">
          <div class="form-field">
            <label class="form-label">Template name</label>
            <sl-input
              type="text"
              size="medium"
              placeholder="Enter template name"
              .value=${this._form.name}
              @input=${(e) => this._handleFormChange('name', e.target.value)}
              @sl-input=${(e) => this._handleFormChange('name', e.target.value)}
            ></sl-input>
          </div>
          <div class="form-field">
            <label class="form-label">Example Page</label>
            <div class="form-field-with-button">
              <sl-input
                type="text"
                size="medium"
                placeholder="/index or /page-path"
                .value=${this._form.path}
                @input=${(e) => this._handleFormChange('path', e.target.value)}
                @sl-input=${(e) => this._handleFormChange('path', e.target.value)}
              ></sl-input>
              <sl-button
                size="medium"
                @click=${this._openPagePicker}
              >Browse Pages</sl-button>
            </div>
          </div>
          <div class="form-actions">
            <sl-button
              variant="primary"
              size="small"
              @click=${this._handleAdd}
              ?disabled=${!this._isFormValid()}
            >${isEditing ? 'Update' : 'Add Template'}</sl-button>
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

  _renderPagePicker() {
    return html`
      <page-picker
        .open=${this._showPagePicker}
        .org=${this.org}
        .site=${this.site}
        title="Select Page"
        @page-selected=${this._handlePageSelected}
        @close=${this._handlePagePickerClose}
      ></page-picker>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading templates...');
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
        ${this._renderPagePicker()}
      </div>
      <library-setup-modal
        .open=${this._showLibrarySetup}
        .libraryType=${'Templates'}
        .options=${this._librarySetupOptions}
        .selectedPath=${this._selectedLibraryPath}
        .customPath=${this._customLibraryPathInput}
        @confirm=${this._handleLibrarySetupConfirm}
        @cancel=${this._handleLibrarySetupCancel}
      ></library-setup-modal>
    `;
  }
}

customElements.define('templates-section', TemplatesSection);
export default TemplatesSection;
