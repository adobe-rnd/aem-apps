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

// Preset plugins available in this repository and external sources
const PRESET_PLUGINS = [
  {
    name: 'Anchor Links',
    title: 'Anchor Links',
    path: 'https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/anchor-links/anchor-links.html',
    experience: 'dialog',
  },
  {
    name: 'Fragment Picker',
    title: 'Fragment Picker',
    path: 'https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/fragments/fragments.html',
    icon: 'https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/fragments/img/Smock_DocumentFragment_18_N.svg',
    experience: 'fullsize-dialog',
  },
  {
    name: 'Media Library',
    title: 'Media Library',
    path: 'https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/media-library/media-library.html',
    icon: 'https://da.live/blocks/edit/img/Smock_Images_18_N.svg',
    experience: 'fullsize-dialog',
  },
  {
    name: 'MSM (Multi-site Manager)',
    title: 'MSM',
    path: 'https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/msm/msm.html',
    experience: 'fullsize-dialog',
  },
  {
    name: 'Request Publish',
    title: 'Request Publish',
    path: 'https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/request-for-publish/request-for-publish.html',
    icon: 'https://main--aem-apps--adobe-rnd.aem.live/tools/plugins/request-for-publish/request-for-publish.svg',
    experience: 'fullsize-dialog',
  },
  {
    name: 'Rollout',
    title: 'Rollout',
    path: 'https://da.live/nx/public/plugins/rollout.html',
    icon: 'https://da.live/nx/public/plugins/rollout/media_195da69764de2782d555abed3042d8434a040e31c.png',
  },
];

const EXPERIENCE_TYPES = [
  { value: 'fullsize-dialog', label: 'Fullsize Dialog' },
  { value: 'dialog', label: 'Dialog' },
  { value: 'window', label: 'Window' },
  { value: '', label: 'None' },
];

// Standard library items that are not plugins
const STANDARD_LIBRARY_ITEMS = ['Blocks', 'Templates', 'Icons', 'Placeholders'];

/**
 * Plugins section component
 * Manages custom plugins in the library configuration (stored in config.json)
 */
export default class PluginsSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _plugins: { state: true },
    _showAddForm: { state: true },
    _editingIndex: { state: true },
    _form: { state: true },
    _message: { state: true },
    _searchQuery: { state: true },
  };

  constructor() {
    super();
    this._plugins = [];
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
      experience: 'fullsize-dialog',
      format: '',
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

      const libraryData = config?.library?.data || [];
      this._plugins = libraryData.filter(
        (item) => !STANDARD_LIBRARY_ITEMS.includes(item.title),
      );

      this._setLoading(false);
      this._trackAction('plugins-loaded', { count: this._plugins.length });
    } catch (error) {
      this._setError(`Failed to load plugins: ${error.message}`);
    }
  }

  async _savePlugins(plugins) {
    try {
      const config = await fetchSiteConfig(this.org, this.site);
      if (!config) {
        throw new Error('Site configuration not found');
      }

      const libraryData = config?.library?.data || [];

      const standardItems = libraryData.filter(
        (item) => STANDARD_LIBRARY_ITEMS.includes(item.title),
      );
      const updatedLibraryData = [...standardItems, ...plugins];

      config.library = config.library || {};
      config.library.data = updatedLibraryData;
      config.library.total = updatedLibraryData.length;
      config.library.limit = updatedLibraryData.length;

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
        experience: '',
        format: '',
        ref: '',
      };
      return;
    }

    const preset = PRESET_PLUGINS.find((p) => p.name === value);
    if (preset) {
      this._form = {
        selectedPreset: value,
        title: preset.title || '',
        path: preset.path || '',
        icon: preset.icon || '',
        experience: preset.experience || '',
        format: preset.format || '',
        ref: preset.ref || '',
      };
    }
  }

  _handleFormChange(field, value) {
    // If changing preset dropdown
    if (field === 'selectedPreset') {
      this._handlePresetSelect(value);
      return;
    }

    // Otherwise just update the field
    this._form = {
      ...this._form,
      [field]: value,
    };
  }

  _isFormValid() {
    return this._form.title.trim().length > 0 && this._form.path.trim().length > 0;
  }

  async _handleAdd() {
    if (!this._isFormValid()) return;

    this._message = null;

    const isDuplicate = this._plugins.some(
      (p, idx) => p.title === this._form.title.trim() && idx !== this._editingIndex,
    );

    if (isDuplicate) {
      this._message = {
        type: 'error',
        text: 'A plugin with this title already exists',
      };
      return;
    }

    try {
      const cleanPlugin = {
        title: this._form.title.trim(),
        path: this._form.path.trim(),
      };
      if (this._form.icon?.trim()) cleanPlugin.icon = this._form.icon.trim();
      if (this._form.experience?.trim()) cleanPlugin.experience = this._form.experience.trim();
      if (this._form.format?.trim()) cleanPlugin.format = this._form.format.trim();
      if (this._form.ref?.trim()) cleanPlugin.ref = this._form.ref.trim();

      let updatedPlugins;
      if (this._editingIndex >= 0) {
        updatedPlugins = this._plugins.map((p, idx) => (
          idx === this._editingIndex ? cleanPlugin : p
        ));
      } else {
        updatedPlugins = [...this._plugins, cleanPlugin];
      }

      const result = await this._savePlugins(updatedPlugins);

      if (result.success) {
        const action = this._editingIndex >= 0 ? 'updated' : 'added';
        this._trackAction(`plugin-${action}`, {
          org: this.org,
          site: this.site,
          title: cleanPlugin.title,
        });

        await this.loadData();
        this._message = {
          type: 'success',
          text: `Plugin ${action} successfully`,
        };
        this._form = this._getDefaultFormState();
        this._editingIndex = -1;
        this._showAddForm = false;
      } else {
        throw new Error(result.error || `Failed to ${this._editingIndex >= 0 ? 'update' : 'add'} plugin`);
      }
    } catch (error) {
      this._message = {
        type: 'error',
        text: error.message,
      };
    }
  }

  _handleEdit(plugin, index) {
    this._editingIndex = index;
    this._form = {
      title: plugin.title,
      path: plugin.path,
      icon: plugin.icon || '',
      experience: plugin.experience || '',
      format: plugin.format || '',
      ref: plugin.ref || '',
    };
    this._showAddForm = true;
    this._showPresetPicker = false;
    this._message = null;
  }

  _handleCancelEdit() {
    this._form = this._getDefaultFormState();
    this._editingIndex = -1;
    this._showAddForm = false;
  }

  async _handleRemove(plugin, index) {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm(`Remove plugin "${plugin.title}"?`)) return;

    this._message = null;

    try {
      const updatedPlugins = this._plugins.filter((_, idx) => idx !== index);
      const result = await this._savePlugins(updatedPlugins);

      if (result.success) {
        this._trackAction('plugin-remove', {
          org: this.org,
          site: this.site,
          title: plugin.title,
        });
        await this.loadData();
        this._message = {
          type: 'success',
          text: 'Plugin removed successfully',
        };
      } else {
        throw new Error(result.error || 'Failed to remove plugin');
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

  _getFilteredPlugins() {
    if (!this._searchQuery) return this._plugins;
    return this._plugins.filter((plugin) => plugin.title.toLowerCase().includes(this._searchQuery));
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
    const hasPlugins = this._plugins && this._plugins.length > 0;
    const status = hasPlugins ? 'configured' : 'not-configured';
    const statusLabel = hasPlugins ? 'Configured' : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="plugins-library-setup"
        title="Plugins"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Plugins extend the authoring library with custom tools and integrations. Add plugins from preset options or create custom entries.</p>
          <p>${!hasPlugins ? 'No plugins configured yet.' : 'Authors can now access these plugins from the library panel.'} Plugins can open in dialogs, fullsize dialogs, or new windows.</p>
          <p>Each plugin needs a title and a path URL. Optional fields include icon URL, experience type, format template, and ref (branch name).</p>
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
    const filteredPlugins = this._getFilteredPlugins();

    return html`
      <div class="collection-card">
        <div class="collection-header">
          <h3 class="collection-title">Plugins</h3>
          <sl-input
            type="search"
            size="small"
            placeholder="Search plugins..."
            .value=${this._searchQuery}
            @sl-input=${this._handleSearch}
            @sl-change=${this._handleSearch}
            @input=${this._handleSearch}
            @keyup=${this._handleSearch}
            clearable
          ></sl-input>
        </div>
        ${filteredPlugins.length === 0 ? html`
          <div class="empty-state">
            ${this._plugins.length === 0 ? html`
              <div class="empty-state-icon">🧩</div>
              <p class="empty-state-text">No plugins yet</p>
              <p>Add a plugin from presets or create a custom one.</p>
            ` : html`
              <p>No plugins found</p>
            `}
          </div>
        ` : html`
          <div class="plugin-list">
            ${filteredPlugins.map((plugin, index) => html`
              <div class="plugin-item">
                <div class="plugin-info">
                  <div class="plugin-name">${plugin.title}</div>
                  <div class="plugin-path">${plugin.path}</div>
                  ${plugin.experience ? html`
                    <div class="plugin-meta">Experience: ${plugin.experience}</div>
                  ` : nothing}
                  ${plugin.ref ? html`
                    <div class="plugin-meta">Ref: ${plugin.ref}</div>
                  ` : nothing}
                </div>
                <div class="plugin-actions">
                  <button
                    class="plugin-action-btn"
                    @click=${() => this._handleEdit(plugin, index)}
                  >Edit</button>
                  <button
                    class="plugin-action-btn remove"
                    @click=${() => this._handleRemove(plugin, index)}
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
            + Add plugin
          </button>
        </div>
      `;
    }

    return html`
      <div class="add-plugin-card">
        <div class="add-plugin-header">
          <h3 class="add-plugin-title">${isEditing ? 'Edit Plugin' : 'Add Plugin'}</h3>
          <button class="btn-icon" @click=${this._toggleAddForm} title="Close">×</button>
        </div>
        <p class="add-plugin-description">Select a preset plugin or configure a custom plugin. You can modify any preset values before adding.</p>
        <div class="add-plugin-form">
          ${!isEditing ? html`
            <div class="form-field">
              <label class="form-label">Start with</label>
              <select
                class="form-input"
                .value=${this._form.selectedPreset}
                @change=${(e) => this._handleFormChange('selectedPreset', e.target.value)}
              >
                <option value="">Custom Plugin</option>
                ${PRESET_PLUGINS.map((preset) => html`
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
              placeholder="e.g., My Custom Plugin"
              .value=${this._form.title}
              @input=${(e) => this._handleFormChange('title', e.target.value)}
            />
          </div>
          <div class="form-field">
            <label class="form-label">Path URL *</label>
            <input
              type="url"
              class="form-input"
              placeholder="https://example.com/plugin.html"
              .value=${this._form.path}
              @input=${(e) => this._handleFormChange('path', e.target.value)}
            />
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
            <label class="form-label">Experience Type</label>
            <select
              class="form-input"
              .value=${this._form.experience}
              @change=${(e) => this._handleFormChange('experience', e.target.value)}
            >
              ${EXPERIENCE_TYPES.map((type) => html`
                <option value="${type.value}" ?selected=${this._form.experience === type.value}>${type.label}</option>
              `)}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">Format</label>
            <input
              type="text"
              class="form-input"
              placeholder="e.g., :<content>: or {{<content>}}"
              .value=${this._form.format}
              @input=${(e) => this._handleFormChange('format', e.target.value)}
            />
            <small class="form-hint">Optional format template for content insertion</small>
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
            <small class="form-hint">Optional GitHub branch name for the plugin</small>
          </div>
          <div class="form-actions">
            <button
              class="btn-primary"
              @click=${this._handleAdd}
              ?disabled=${!this._isFormValid()}
            >${isEditing ? 'Update' : 'Add Plugin'}</button>
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
      return this._renderLoading('Loading plugins...');
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

customElements.define('plugins-section', PluginsSection);
