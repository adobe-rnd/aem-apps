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

const PRESET_APPS = [
  {
    name: 'DA Permissions',
    title: 'DA Permissions',
    description: 'Manage DA Permissions',
    path: 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/da-permissions/da-permissions',
  },
  {
    name: 'Media Library',
    title: 'Media Library',
    description: 'Browse and manage media assets',
    path: 'https://da.live/apps/media-library#/{org}/{site}',
  },
  {
    name: 'MSM Actions',
    title: 'MSM Actions',
    description: 'Multi-Site Management tool for managing content links across sites',
    path: 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/msm/msm',
  },
  {
    name: 'Publish Request Review',
    title: 'Publish Request Review',
    description: 'Review, approve, or reject content publish requests',
    path: 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox',
  },
  {
    name: 'Snapshots',
    title: 'Snapshots',
    description: 'Manage content snapshots and versions',
    path: 'https://da.live/apps/snapshots#/{org}/{site}',
  },
];

export default class AppsSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _apps: { state: true },
    _showAddForm: { state: true },
    _editingIndex: { state: true },
    _form: { state: true },
    _message: { state: true },
    _searchQuery: { state: true },
  };

  constructor() {
    super();
    this._apps = [];
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
      description: '',
      image: '',
      path: '',
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

      this._apps = config?.apps?.data || [];

      this._setLoading(false);
      this._trackAction('apps-loaded', { count: this._apps.length });
    } catch (error) {
      this._setError(`Failed to load apps: ${error.message}`);
    }
  }

  async _saveApps(apps) {
    try {
      const config = await fetchSiteConfig(this.org, this.site);
      if (!config) {
        throw new Error('Site configuration not found');
      }

      config.apps = config.apps || {};
      config.apps.data = apps;
      config.apps.total = apps.length;
      config.apps.limit = apps.length;

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
        description: '',
        image: '',
        path: '',
        ref: '',
      };
      return;
    }

    const preset = PRESET_APPS.find((p) => p.name === value);
    if (preset) {
      // Replace {org} and {site} placeholders with actual values
      let path = preset.path || '';
      if (path.includes('{org}') || path.includes('{site}')) {
        path = path.replace('{org}', this.org || '').replace('{site}', this.site || '');
      }

      this._form = {
        selectedPreset: value,
        title: preset.title || '',
        description: preset.description || '',
        image: preset.image || '',
        path,
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
    return this._form.title.trim().length > 0 && this._form.path.trim().length > 0;
  }

  async _handleAdd() {
    if (!this._isFormValid()) return;

    this._message = null;

    const isDuplicate = this._apps.some(
      (p, idx) => p.title === this._form.title.trim() && idx !== this._editingIndex,
    );

    if (isDuplicate) {
      this._message = {
        type: 'error',
        text: 'An app with this title already exists',
      };
      return;
    }

    try {
      const cleanApp = {
        title: this._form.title.trim(),
        path: this._form.path.trim(),
      };
      if (this._form.description?.trim()) cleanApp.description = this._form.description.trim();
      if (this._form.image?.trim()) cleanApp.image = this._form.image.trim();
      if (this._form.ref?.trim()) cleanApp.ref = this._form.ref.trim();

      let updatedApps;
      if (this._editingIndex >= 0) {
        updatedApps = this._apps.map((p, idx) => (
          idx === this._editingIndex ? cleanApp : p
        ));
      } else {
        updatedApps = [...this._apps, cleanApp];
      }

      const result = await this._saveApps(updatedApps);

      if (result.success) {
        const action = this._editingIndex >= 0 ? 'updated' : 'added';
        this._trackAction(`app-${action}`, {
          org: this.org,
          site: this.site,
          title: cleanApp.title,
        });

        await this.loadData();
        this._message = {
          type: 'success',
          text: `App ${action} successfully`,
        };
        this._form = this._getDefaultFormState();
        this._editingIndex = -1;
        this._showAddForm = false;
      } else {
        throw new Error(result.error || `Failed to ${this._editingIndex >= 0 ? 'update' : 'add'} app`);
      }
    } catch (error) {
      this._message = {
        type: 'error',
        text: error.message,
      };
    }
  }

  _handleEdit(app, index) {
    this._editingIndex = index;
    this._form = {
      title: app.title,
      description: app.description || '',
      image: app.image || '',
      path: app.path,
      ref: app.ref || '',
    };
    this._showAddForm = true;
    this._message = null;
  }

  _handleCancelEdit() {
    this._form = this._getDefaultFormState();
    this._editingIndex = -1;
    this._showAddForm = false;
  }

  async _handleRemove(app, index) {
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm(`Remove app "${app.title}"?`)) return;

    this._message = null;

    try {
      const updatedApps = this._apps.filter((_, idx) => idx !== index);
      const result = await this._saveApps(updatedApps);

      if (result.success) {
        this._trackAction('app-remove', {
          org: this.org,
          site: this.site,
          title: app.title,
        });
        await this.loadData();
        this._message = {
          type: 'success',
          text: 'App removed successfully',
        };
      } else {
        throw new Error(result.error || 'Failed to remove app');
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

  _getFilteredApps() {
    if (!this._searchQuery) return this._apps;

    return this._apps.filter((app) => app.title.toLowerCase().includes(this._searchQuery)
      || app.description?.toLowerCase().includes(this._searchQuery)
      || app.path.toLowerCase().includes(this._searchQuery));
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
    const hasApps = this._apps && this._apps.length > 0;
    const status = hasApps ? 'configured' : 'not-configured';
    const statusLabel = hasApps ? 'Configured' : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="apps-setup"
        title="Apps"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Apps extend the authoring experience with custom tools and utilities. Add apps from preset options or create custom entries.</p>
          <p>${!hasApps ? 'No apps configured yet.' : 'Authors can now access these apps from the apps panel.'} Apps provide additional functionality for content management.</p>
          <p>Each app needs a title and a path URL. Optional fields include description, image URL, and ref (branch name).</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/administrators/guides/setup-apps"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Setup Apps Docs</a>
        </div>
      </explainer-info-card>
    `;
  }

  _renderCollectionCard() {
    const filteredApps = this._getFilteredApps();

    return html`
      <div class="collection-card">
        <div class="collection-header">
          <h3 class="collection-title">Apps</h3>
          <sl-input
            type="search"
            size="small"
            placeholder="Search apps..."
            .value=${this._searchQuery}
            @sl-input=${this._handleSearch}
            @sl-change=${this._handleSearch}
            @input=${this._handleSearch}
            @keyup=${this._handleSearch}
            clearable
          ></sl-input>
        </div>
        ${filteredApps.length === 0 ? html`
          <div class="empty-state">
            ${this._apps.length === 0 ? html`
              <div class="empty-state-icon">🛠️</div>
              <p class="empty-state-text">No apps yet</p>
              <p>Add an app from presets or create a custom one.</p>
            ` : html`
              <p>No apps found</p>
            `}
          </div>
        ` : html`
          <div class="app-list">
            ${filteredApps.map((app, index) => html`
              <div class="app-item">
                <div class="app-info">
                  <div class="app-name">${app.title}</div>
                  ${app.description ? html`
                    <div class="app-description">${app.description}</div>
                  ` : nothing}
                  <div class="app-path">${app.path}</div>
                  ${app.ref ? html`
                    <div class="app-meta">Ref: ${app.ref}</div>
                  ` : nothing}
                </div>
                <div class="app-actions">
                  <button
                    class="app-action-btn"
                    @click=${() => this._handleEdit(app, index)}
                  >Edit</button>
                  <button
                    class="app-action-btn remove"
                    @click=${() => this._handleRemove(app, index)}
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
            + Add app
          </button>
        </div>
      `;
    }

    return html`
      <div class="add-app-card">
        <div class="add-app-header">
          <h3 class="add-app-title">${isEditing ? 'Edit App' : 'Add App'}</h3>
          <button class="btn-icon" @click=${this._toggleAddForm} title="Close">×</button>
        </div>
        <p class="add-app-description">Select a preset app or configure a custom app. You can modify any preset values before adding.</p>
        <div class="add-app-form">
          ${!isEditing ? html`
            <div class="form-field">
              <label class="form-label">Start with</label>
              <select
                class="form-input"
                .value=${this._form.selectedPreset}
                @change=${(e) => this._handleFormChange('selectedPreset', e.target.value)}
              >
                <option value="">Custom App</option>
                ${PRESET_APPS.map((preset) => html`
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
              placeholder="e.g., My Custom App"
              .value=${this._form.title}
              @input=${(e) => this._handleFormChange('title', e.target.value)}
            />
          </div>
          <div class="form-field">
            <label class="form-label">Description</label>
            <input
              type="text"
              class="form-input"
              placeholder="Brief description of the app"
              .value=${this._form.description}
              @input=${(e) => this._handleFormChange('description', e.target.value)}
            />
          </div>
          <div class="form-field">
            <label class="form-label">Path URL *</label>
            <input
              type="url"
              class="form-input"
              placeholder="https://example.com/app"
              .value=${this._form.path}
              @input=${(e) => this._handleFormChange('path', e.target.value)}
            />
          </div>
          <div class="form-field">
            <label class="form-label">Image URL</label>
            <input
              type="url"
              class="form-input"
              placeholder="https://example.com/image.jpg"
              .value=${this._form.image}
              @input=${(e) => this._handleFormChange('image', e.target.value)}
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
            <small class="form-hint">Optional GitHub branch name for the app</small>
          </div>
          <div class="form-actions">
            <button
              class="btn-primary"
              @click=${this._handleAdd}
              ?disabled=${!this._isFormValid()}
            >${isEditing ? 'Update' : 'Add App'}</button>
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
      return this._renderLoading('Loading apps...');
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

customElements.define('apps-section', AppsSection);
