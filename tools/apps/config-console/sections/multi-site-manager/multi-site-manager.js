// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import { fetchMSMConfig, updateMSMConfig } from '../../shared/api/config-api.js';
import '../../components/explainer-info-card.js';
import '../../shared/components/site-picker.js';

// Get stylesheet for this section
const NX = 'https://da.live/nx2';
let commonStyles = null;
let sectionStyles = null;
let sl = null;
try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  await Promise.all([
    import(`${NX}/public/sl/components.js`),
  ]);

  // Load common styles using absolute path from window.location
  const commonStylesUrl = new URL('/tools/apps/config-console/shared/styles/common-section-styles.css', window.location.origin).href;
  [commonStyles, sectionStyles, sl] = await Promise.all([
    getStyle(commonStylesUrl),
    getStyle(import.meta.url),
    getStyle(`${NX}/public/sl/styles.css`),
  ]);
} catch {
  // Styles failed to load - section will render without styles
}

/**
 * Multi-Site Manager Section Component
 * Manages multi-level site hierarchies with base/satellite relationships
 */
export default class MultiSiteManagerSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _sites: { state: true },
    _showAddForm: { state: true },
    _editingIndex: { state: true },
    _form: { state: true },
    _message: { state: true },
    _searchQuery: { state: true },
    _showSitePicker: { state: true },
    _pickingField: { state: true },
  };

  constructor() {
    super();
    this._sites = [];
    this._showAddForm = false;
    this._editingIndex = -1;
    this._form = { base: '', satellite: '', title: '' };
    this._message = null;
    this._searchQuery = '';
    this._showSitePicker = false;
    this._pickingField = null; // 'base' or 'satellite'
  }

  _getStylesheets() {
    return [commonStyles, sectionStyles, sl].filter(Boolean);
  }

  async loadData() {
    if (!this.org) {
      this._setLoading(false);
      return;
    }

    try {
      this._setLoading(true);
      const msmData = await fetchMSMConfig(this.org, this.token);
      this._sites = msmData || [];
      this._setLoading(false);
    } catch (error) {
      this._setError(`Failed to load MSM config: ${error.message}`);
    }
  }

  _toggleAddForm() {
    this._showAddForm = !this._showAddForm;
    if (this._showAddForm) {
      this._form = { base: '', satellite: '', title: '' };
      this._editingIndex = -1;
    }
    this._message = null;
  }

  _handleFormChange(field, value) {
    this._form = { ...this._form, [field]: value };
  }

  _isFormValid() {
    return this._form.base.trim().length > 0 && this._form.title.trim().length > 0;
  }

  async _handleAdd() {
    if (!this._isFormValid()) return;

    try {
      const newEntry = {
        base: this._form.base.trim(),
        satellite: this._form.satellite.trim() || '',
        title: this._form.title.trim(),
      };

      let updatedSites;
      if (this._editingIndex >= 0) {
        // Update existing entry
        updatedSites = [...this._sites];
        updatedSites[this._editingIndex] = newEntry;
      } else {
        // Add new entry
        updatedSites = [...this._sites, newEntry];
      }

      const result = await updateMSMConfig(this.org, updatedSites, this.token);
      if (result.success) {
        this._sites = updatedSites;
        this._showAddForm = false;
        this._form = { base: '', satellite: '', title: '' };
        this._editingIndex = -1;
        this._message = {
          type: 'success',
          text: this._editingIndex >= 0 ? 'Site relationship updated' : 'Site relationship added',
        };
        // Clear message after 3 seconds
        setTimeout(() => { this._message = null; }, 3000);
      } else {
        this._message = {
          type: 'error',
          text: result.error || 'Failed to save',
        };
      }
    } catch (error) {
      this._message = {
        type: 'error',
        text: `Failed to save: ${error.message}`,
      };
    }
  }

  _handleEdit(index) {
    const site = this._sites[index];
    this._form = {
      base: site.base || '',
      satellite: site.satellite || '',
      title: site.title || '',
    };
    this._editingIndex = index;
    this._showAddForm = true;
    this._message = null;
  }

  _handleCancelEdit() {
    this._showAddForm = false;
    this._form = { base: '', satellite: '', title: '' };
    this._editingIndex = -1;
    this._message = null;
  }

  async _handleRemove(index) {
    // eslint-disable-next-line no-restricted-globals, no-alert
    if (!confirm('Remove this site relationship?')) return;

    try {
      const updatedSites = this._sites.filter((_, i) => i !== index);
      const result = await updateMSMConfig(this.org, updatedSites, this.token);

      if (result.success) {
        this._sites = updatedSites;
        this._message = {
          type: 'success',
          text: 'Site relationship removed',
        };
        setTimeout(() => { this._message = null; }, 3000);
      } else {
        this._message = {
          type: 'error',
          text: result.error || 'Failed to remove',
        };
      }
    } catch (error) {
      this._message = {
        type: 'error',
        text: `Failed to remove: ${error.message}`,
      };
    }
  }

  _handleSearch(e) {
    this._searchQuery = e.target.value.toLowerCase();
  }

  _openSitePicker(field) {
    this._pickingField = field;
    this._showSitePicker = true;
    // Force a re-render
    this.requestUpdate();
  }

  _handleSiteSelected(e) {
    const { site } = e.detail;
    if (this._pickingField) {
      this._form = { ...this._form, [this._pickingField]: site };
    }
    this._showSitePicker = false;
    this._pickingField = null;
  }

  _handleSitePickerClose() {
    this._showSitePicker = false;
    this._pickingField = null;
  }

  _getFilteredSites() {
    if (!this._searchQuery) return this._sites;

    return this._sites.filter((site) => {
      const base = (site.base || '').toLowerCase();
      const satellite = (site.satellite || '').toLowerCase();
      const title = (site.title || '').toLowerCase();
      return base.includes(this._searchQuery)
        || satellite.includes(this._searchQuery)
        || title.includes(this._searchQuery);
    });
  }

  _renderExplainerCard() {
    const hasSites = this._sites && this._sites.length > 0;
    const status = hasSites ? 'configured' : 'not-configured';
    const statusLabel = hasSites ? 'Configured' : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="multi-site-manager-integration"
        title="Multi-Site Manager"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Multi-Site Manager enables content inheritance between sites. Define base sites (blueprints) and satellites (live copies) to share content while allowing selective overrides.</p>
          <p>${!hasSites ? 'No site relationships configured. Each site operates independently.' : 'Site relationships configured. Satellites inherit content from their base sites.'}</p>
          <p><strong>Multi-level hierarchies supported:</strong> A site can be both a satellite and a base (e.g., regional-site inherits from global-brand and serves as the base for country-specific sites). The system supports inheritance chains up to 6 ancestors deep.</p>
          <p><strong>Important:</strong> Each base site entry (where satellite is empty) should be defined first, followed by its satellite entries.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/about/early-access/multi-site-manager"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >MSM Documentation</a>
        </div>
      </explainer-info-card>
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

  _renderSitesTable() {
    const filteredSites = this._getFilteredSites();

    return html`
      <div class="msm-table-card">
        <div class="table-header">
          <h3 class="table-title">Site Relationships</h3>
          <sl-input
            type="search"
            size="small"
            placeholder="Search sites..."
            .value=${this._searchQuery}
            @sl-input=${this._handleSearch}
            clearable
          ></sl-input>
        </div>

        ${filteredSites.length === 0 ? html`
          <div class="empty-state">
            ${this._sites.length === 0 ? html`
              <p class="empty-state-text">No site relationships configured</p>
              <p>Add your first base site to enable multi-site management.</p>
            ` : html`
              <p>No sites found matching your search</p>
            `}
          </div>
        ` : html`
          <div class="msm-table">
            <div class="msm-table-header">
              <div class="msm-col msm-col-base">Base Site</div>
              <div class="msm-col msm-col-satellite">Satellite Site</div>
              <div class="msm-col msm-col-title">Title</div>
              <div class="msm-col msm-col-actions">Actions</div>
            </div>
            <div class="msm-table-body">
              ${filteredSites.map((site) => {
    const globalIndex = this._sites.indexOf(site);
    const isBase = !site.satellite || site.satellite === '';
    return html`
                  <div class="msm-row ${isBase ? 'is-base' : ''}">
                    <div class="msm-col msm-col-base">${site.base}</div>
                    <div class="msm-col msm-col-satellite">
                      ${site.satellite || html`<span class="empty-value">—</span>`}
                    </div>
                    <div class="msm-col msm-col-title">${site.title}</div>
                    <div class="msm-col msm-col-actions">
                      <button
                        class="action-btn"
                        @click=${() => this._handleEdit(globalIndex)}
                        title="Edit"
                      >Edit</button>
                      <button
                        class="action-btn remove"
                        @click=${() => this._handleRemove(globalIndex)}
                        title="Remove"
                      >Remove</button>
                    </div>
                  </div>
                `;
  })}
            </div>
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
            + Add site relationship
          </button>
        </div>
      `;
    }

    return html`
      <div class="add-msm-card">
        <div class="add-msm-header">
          <h3 class="add-msm-title">${isEditing ? 'Edit Site Relationship' : 'Add Site Relationship'}</h3>
          <button class="btn-icon" @click=${this._toggleAddForm} title="Close">×</button>
        </div>
        <p class="add-msm-description">
          ${isEditing ? 'Update the site relationship details below.' : 'Define a base site and optionally a satellite. Leave satellite empty to define a new base site.'}
        </p>
        <div class="add-msm-form">
          <div class="form-field">
            <label class="form-label">Base Site <span class="required">*</span></label>
            <div class="form-field-with-button">
              <sl-input
                type="text"
                size="medium"
                placeholder="e.g., global-site or demo"
                .value=${this._form.base}
                @input=${(e) => this._handleFormChange('base', e.target.value)}
                @sl-input=${(e) => this._handleFormChange('base', e.target.value)}
              ></sl-input>
              <sl-button
                size="medium"
                @click=${() => this._openSitePicker('base')}
              >Browse Sites</sl-button>
            </div>
            <span class="form-hint">The repository name of the base (blueprint) site</span>
          </div>
          <div class="form-field">
            <label class="form-label">Satellite Site</label>
            <div class="form-field-with-button">
              <sl-input
                type="text"
                size="medium"
                placeholder="e.g., regional-site or demo-us (optional)"
                .value=${this._form.satellite}
                @input=${(e) => this._handleFormChange('satellite', e.target.value)}
                @sl-input=${(e) => this._handleFormChange('satellite', e.target.value)}
              ></sl-input>
              <sl-button
                size="medium"
                @click=${() => this._openSitePicker('satellite')}
              >Browse Sites</sl-button>
            </div>
            <span class="form-hint">The repository name of the satellite (live copy) site. Leave empty for base definition.</span>
          </div>
          <div class="form-field">
            <label class="form-label">Title <span class="required">*</span></label>
            <sl-input
              type="text"
              size="medium"
              placeholder="e.g., Global Site or US Region"
              .value=${this._form.title}
              @input=${(e) => this._handleFormChange('title', e.target.value)}
              @sl-input=${(e) => this._handleFormChange('title', e.target.value)}
            ></sl-input>
            <span class="form-hint">A human-readable label for this relationship</span>
          </div>
          <div class="form-actions">
            <sl-button
              variant="primary"
              size="small"
              @click=${this._handleAdd}
              ?disabled=${!this._isFormValid()}
            >${isEditing ? 'Update Relationship' : 'Add Relationship'}</sl-button>
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

  render() {
    if (this._loading) {
      return this._renderLoading('Loading Multi-Site Manager...');
    }

    if (this._error) {
      return this._renderError(this._error);
    }

    return html`
      <div class="section-container">
        ${this._renderExplainerCard()}
        ${this._renderMessage()}
        ${this._renderSitesTable()}
        ${this._renderAddCard()}
        <site-picker
          .open=${this._showSitePicker}
          .org=${this.org}
          .currentValue=${this._pickingField === 'base' ? this._form.base : this._form.satellite}
          title="Select ${this._pickingField === 'base' ? 'Base' : 'Satellite'} Site"
          @site-selected=${this._handleSiteSelected}
          @close=${this._handleSitePickerClose}
        ></site-picker>
      </div>
    `;
  }
}

customElements.define('multi-site-manager-section', MultiSiteManagerSection);
