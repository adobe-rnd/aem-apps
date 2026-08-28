/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import { fetchSiteConfig, updateSiteConfig } from '../../shared/utils/da-api.js';
import '../../components/explainer-info-card.js';

const NX = 'https://da.live/nx2';
let sectionStyles = null;
let commonStyles = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  const commonStylesUrl = new URL('/tools/apps/config-console/shared/styles/common-section-styles.css', window.location.origin).href;
  commonStyles = await getStyle(commonStylesUrl);
  sectionStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load
}

// Preset prepare menu items
const PRESET_PREPARE_ITEMS = [
  {
    name: 'Multi-site Manager',
    title: 'Multi-site Manager',
    path: 'https://main--aem-apps--adobe-rnd.aem.page/tools/plugins/msm/msm.html',
    icon: 'https://da.live/blocks/edit/img/S2_Icon_GlobeGrid_20_N.svg#S2_Icon_GlobeGrid',
  },
  {
    name: 'Schedule Publish',
    title: 'Schedule Publish',
    path: '',
  },
  {
    name: 'Send to Adobe Target',
    title: 'Send to Adobe Target',
    path: '',
  },
];

/**
 * Prepare menu section component
 * Manages prepare menu items in the configuration (stored in config.json)
 */
export default class PrepareSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _prepareItems: { state: true },
    _showAddForm: { state: true },
    _editingIndex: { state: true },
    _form: { state: true },
    _message: { state: true },
    _searchQuery: { state: true },
  };

  constructor() {
    super();
    this._prepareItems = [];
    this._showAddForm = false;
    this._editingIndex = -1;
    this._form = this._getDefaultFormState();
    this._message = null;
    this._searchQuery = '';
  }

  _getStylesheets() {
    return [commonStyles, sectionStyles].filter(Boolean);
  }

  _getDefaultFormState() {
    return {
      selectedPreset: '',
      title: '',
      path: '',
      icon: '',
      ref: '',
    };
  }

  async loadData() {
    if (!this.org || !this.site) {
      this._setError('Organization and site are required');
      return;
    }

    try {
      this._setLoading(true);
      const config = await fetchSiteConfig(this.org, this.site);

      this._prepareItems = config?.prepare?.data || [];

      this._setLoading(false);
      this._trackAction('prepare-loaded', { count: this._prepareItems.length });
    } catch (error) {
      this._setError(`Failed to load prepare menu items: ${error.message}`);
    }
  }

  async _savePrepareItems(items) {
    try {
      const config = await fetchSiteConfig(this.org, this.site);
      if (!config) {
        throw new Error('Site configuration not found');
      }

      config.prepare = config.prepare || {};
      config.prepare.data = items;
      config.prepare.total = items.length;
      config.prepare.limit = items.length;

      const result = await updateSiteConfig(this.org, this.site, config);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  _toggleAddForm() {
    this._showAddForm = !this._showAddForm;
    if (!this._showAddForm) {
      this._form = this._getDefaultFormState();
      this._editingIndex = -1;
    }
    this._message = null;
  }

  _handlePresetSelect(value) {
    if (!value) {
      this._form = {
        selectedPreset: '',
        title: '',
        path: '',
        icon: '',
        ref: '',
      };
      return;
    }

    const preset = PRESET_PREPARE_ITEMS.find((p) => p.name === value);
    if (preset) {
      // Replace {org} and {site} placeholders with actual values
      let path = preset.path || '';
      if (path.includes('{org}') || path.includes('{site}')) {
        path = path.replace('{org}', this.org || '').replace('{site}', this.site || '');
      }

      this._form = {
        selectedPreset: value,
        title: preset.title || '',
        path,
        icon: preset.icon || '',
        ref: preset.ref || '',
      };
    }
  }

  _handleFormChange(field, value) {
    if (field === 'selectedPreset') {
      this._handlePresetSelect(value);
      return;
    }

    this._form = {
      ...this._form,
      [field]: value,
    };
  }

  _isFormValid() {
    // Title is required, path is optional for feature-flag plugins
    return this._form.title.trim().length > 0;
  }

  async _handleAdd() {
    if (!this._isFormValid()) return;

    this._message = null;

    const isDuplicate = this._prepareItems.some(
      (p, idx) => p.title === this._form.title.trim() && idx !== this._editingIndex,
    );

    if (isDuplicate) {
      this._message = {
        type: 'error',
        text: 'A prepare menu item with this title already exists',
      };
      return;
    }

    try {
      const cleanItem = {
        title: this._form.title.trim(),
      };
      if (this._form.path?.trim()) cleanItem.path = this._form.path.trim();
      if (this._form.icon?.trim()) cleanItem.icon = this._form.icon.trim();
      if (this._form.ref?.trim()) cleanItem.ref = this._form.ref.trim();

      let updatedItems;
      if (this._editingIndex >= 0) {
        updatedItems = this._prepareItems.map((p, idx) => (
          idx === this._editingIndex ? cleanItem : p
        ));
      } else {
        updatedItems = [...this._prepareItems, cleanItem];
      }

      const result = await this._savePrepareItems(updatedItems);

      if (result.success) {
        const action = this._editingIndex >= 0 ? 'updated' : 'added';
        this._trackAction(`prepare-${action}`, {
          org: this.org,
          site: this.site,
          title: cleanItem.title,
        });

        await this.loadData();
        this._message = {
          type: 'success',
          text: `Prepare menu item ${action} successfully`,
        };
        this._form = this._getDefaultFormState();
        this._editingIndex = -1;
        this._showAddForm = false;
      } else {
        throw new Error(result.error || `Failed to ${this._editingIndex >= 0 ? 'update' : 'add'} prepare menu item`);
      }
    } catch (error) {
      this._message = {
        type: 'error',
        text: error.message,
      };
    }
  }

  _handleEdit(item, index) {
    this._editingIndex = index;
    this._form = {
      title: item.title,
      path: item.path || '',
      icon: item.icon || '',
      ref: item.ref || '',
    };
    this._showAddForm = true;
    this._message = null;
  }

  _handleCancelEdit() {
    this._form = this._getDefaultFormState();
    this._editingIndex = -1;
    this._showAddForm = false;
  }

  async _handleRemove(item, index) {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm(`Remove prepare menu item "${item.title}"?`)) return;

    this._message = null;

    try {
      const updatedItems = this._prepareItems.filter((_, idx) => idx !== index);
      const result = await this._savePrepareItems(updatedItems);

      if (result.success) {
        this._trackAction('prepare-remove', {
          org: this.org,
          site: this.site,
          title: item.title,
        });
        await this.loadData();
        this._message = {
          type: 'success',
          text: 'Prepare menu item removed successfully',
        };
      } else {
        throw new Error(result.error || 'Failed to remove prepare menu item');
      }
    } catch (error) {
      this._message = {
        type: 'error',
        text: error.message,
      };
    }
  }

  _handleSearch(e) {
    this._searchQuery = e.target.value.toLowerCase();
  }

  _getFilteredItems() {
    if (!this._searchQuery) return this._prepareItems;

    return this._prepareItems.filter((item) => item.title.toLowerCase().includes(this._searchQuery)
      || item.path?.toLowerCase().includes(this._searchQuery));
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
    const hasItems = this._prepareItems && this._prepareItems.length > 0;
    const status = hasItems ? 'configured' : 'not-configured';
    const statusLabel = hasItems ? 'Configured' : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="prepare-setup"
        title="Prepare Menu"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>The Prepare menu allows authors to take action on content before previewing or publishing.</p>
          <p>${!hasItems ? 'No prepare menu items configured yet.' : 'Authors can access these actions from the prepare menu.'} Items include preflight checks, scheduling, and workflow integrations.</p>
          <p>Each item needs a title. Path is optional for feature-flag plugins like Schedule Publish or Send to Adobe Target.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/administrators/guides/prepare-menu"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Prepare Menu Docs</a>
        </div>
      </explainer-info-card>
    `;
  }

  _renderCollectionCard() {
    const filteredItems = this._getFilteredItems();

    return html`
      <div class="collection-card">
        <div class="collection-header">
          <h3 class="collection-title">Prepare Menu Items</h3>
          <sl-input
            type="search"
            size="small"
            placeholder="Search prepare menu items..."
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
            ${this._prepareItems.length === 0 ? html`
              <div class="empty-state-icon">📋</div>
              <p class="empty-state-text">No prepare menu items yet</p>
              <p>Add an item from presets or create a custom one.</p>
            ` : html`
              <p>No items found</p>
            `}
          </div>
        ` : html`
          <div class="prepare-list">
            ${filteredItems.map((item, index) => html`
              <div class="prepare-item">
                <div class="prepare-info">
                  <div class="prepare-name">${item.title}</div>
                  ${item.path ? html`
                    <div class="prepare-path">${item.path}</div>
                  ` : html`
                    <div class="prepare-meta">Feature flag (no path required)</div>
                  `}
                  ${item.ref ? html`
                    <div class="prepare-meta">Ref: ${item.ref}</div>
                  ` : nothing}
                </div>
                <div class="prepare-actions">
                  <button
                    class="prepare-action-btn"
                    @click=${() => this._handleEdit(item, index)}
                  >Edit</button>
                  <button
                    class="prepare-action-btn remove"
                    @click=${() => this._handleRemove(item, index)}
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
            + Add prepare menu item
          </button>
        </div>
      `;
    }

    return html`
      <div class="add-prepare-card">
        <div class="add-prepare-header">
          <h3 class="add-prepare-title">${isEditing ? 'Edit Prepare Menu Item' : 'Add Prepare Menu Item'}</h3>
          <button class="btn-icon" @click=${this._toggleAddForm} title="Close">×</button>
        </div>
        <p class="add-prepare-description">Select a preset item or configure a custom one. Feature-flag plugins (like Schedule Publish) don't require a path.</p>
        <div class="add-prepare-form">
          ${!isEditing ? html`
            <div class="form-field">
              <label class="form-label">Start with</label>
              <select
                class="form-input"
                .value=${this._form.selectedPreset}
                @change=${(e) => this._handleFormChange('selectedPreset', e.target.value)}
              >
                <option value="">Custom Item</option>
                ${PRESET_PREPARE_ITEMS.map((preset) => html`
                  <option value="${preset.name}" ?selected=${this._form.selectedPreset === preset.name}>${preset.name}</option>
                `)}
              </select>
            </div>
          ` : ''}
          <div class="form-field">
            <label class="form-label">Title *</label>
            <input
              type="text"
              class="form-input"
              placeholder="e.g., Schedule Publish"
              .value=${this._form.title}
              @input=${(e) => this._handleFormChange('title', e.target.value)}
            />
          </div>
          <div class="form-field">
            <label class="form-label">Path URL</label>
            <input
              type="url"
              class="form-input"
              placeholder="https://example.com/plugin (optional for feature flags)"
              .value=${this._form.path}
              @input=${(e) => this._handleFormChange('path', e.target.value)}
            />
            <small class="form-hint">Optional for feature-flag plugins</small>
          </div>
          <div class="form-field">
            <label class="form-label">Icon URL</label>
            <input
              type="url"
              class="form-input"
              placeholder="https://example.com/icon.svg"
              .value=${this._form.icon}
              @input=${(e) => this._handleFormChange('icon', e.target.value)}
            />
          </div>
          <div class="form-field">
            <label class="form-label">Ref (Branch Name)</label>
            <input
              type="text"
              class="form-input"
              placeholder="e.g., main, develop"
              .value=${this._form.ref}
              @input=${(e) => this._handleFormChange('ref', e.target.value)}
            />
            <small class="form-hint">Optional: restrict visibility during development</small>
          </div>
          <div class="form-actions">
            <button
              class="btn-primary"
              @click=${this._handleAdd}
              ?disabled=${!this._isFormValid()}
            >${isEditing ? 'Update' : 'Add Item'}</button>
            ${isEditing ? html`
              <button
                class="btn-secondary"
                @click=${this._handleCancelEdit}
              >Cancel</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading prepare menu items...');
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
      </div>
    `;
  }
}

customElements.define('prepare-section', PrepareSection);
