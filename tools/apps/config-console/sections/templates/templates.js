// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  fetchLibraryJSON,
  getSheetDataArray,
  updateTemplates,
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
 * Templates section component
 */
class TemplatesSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _templates: { state: true },
    _searchQuery: { state: true },
    _form: { state: true },
    _editingIndex: { state: true },
    _message: { state: true },
  };

  constructor() {
    super();
    this._templates = [];
    this._searchQuery = '';
    this._form = { name: '', path: '' };
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
    this._trackAction('templates-load', { org: this.org, site: this.site });

    try {
      const json = await fetchLibraryJSON(this.org, this.site, 'templates', this.token);
      this._templates = getSheetDataArray(json);
      this._setLoading(false);
    } catch (error) {
      this._setError(`Failed to load templates: ${error.message}`);
    }
  }

  _handleSearch(e) {
    this._searchQuery = e.target.value;
  }

  _handleFormChange(field, value) {
    this._form = { ...this._form, [field]: value };
  }

  _isFormValid() {
    return this._form.name.trim().length > 0 && this._form.path.trim().length > 0;
  }

  async _handleAdd() {
    if (!this._isFormValid()) return;

    this._setLoading(true);
    this._message = null;

    try {
      const newTemplate = {
        name: this._form.name.trim(),
        path: this._form.path.trim(),
      };

      const result = await updateTemplates(
        this.org,
        this.site,
        [newTemplate],
        this.token,
      );

      if (result.success) {
        this._trackAction('template-add', {
          org: this.org,
          site: this.site,
          name: newTemplate.name,
        });
        this._form = { name: '', path: '' };
        this._editingIndex = -1;
        await this.loadData();
        this._message = { type: 'success', text: 'Template added successfully' };
      } else {
        throw new Error(result.error || 'Failed to add template');
      }
    } catch (error) {
      this._setError(`Failed to add template: ${error.message}`);
    }
  }

  _handleEdit(item) {
    const index = this._templates.indexOf(item);
    this._editingIndex = index;
    this._form = {
      name: item.key,
      path: item.value,
    };
    this._message = null;
  }

  _handleCancelEdit() {
    this._editingIndex = -1;
    this._form = { name: '', path: '' };
    this._message = null;
  }

  async _handleRemove(item) {
    this._setLoading(true);
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
        this._message = { type: 'success', text: 'Template removed successfully' };
      } else {
        throw new Error(result.error || 'Failed to remove template');
      }
    } catch (error) {
      this._setError(`Failed to remove template: ${error.message}`);
    }
  }

  _openPagePicker() {
    // TODO: Integrate with page picker when available
    this._message = { type: 'info', text: 'Page picker coming soon. Enter path manually for now.' };
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
            <label for="template-path">Template Path</label>
            <input
              type="text"
              id="template-path"
              .value=${this._form.path}
              @input=${(e) => this._handleFormChange('path', e.target.value)}
              placeholder="/path/to/template"
            />
          </div>
          <button
            class="action secondary"
            @click=${this._openPagePicker}
          >Select Page</button>
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
      return this._renderLoading('Loading templates...');
    }

    if (this._error) {
      return this._renderError(this._error, () => this.loadData());
    }

    return html`
      <div class="section-container">
        <div class="section-header">
          <div>
            <h2>Templates</h2>
            <p class="section-description">Manage page templates for your site</p>
          </div>
          <div class="search-container">
            <input
              type="search"
              class="library-search"
              placeholder="Search templates..."
              .value=${this._searchQuery}
              @input=${this._handleSearch}
            />
          </div>
        </div>

        ${this._renderMessage()}

        <div class="existing-items-list">
          <h3>Existing Templates (${this._templates.length})</h3>
          <library-items-list
            .items=${this._templates}
            itemType="template"
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

customElements.define('templates-section', TemplatesSection);
export default TemplatesSection;
