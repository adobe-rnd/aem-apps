// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  fetchInheritedConfig,
  updateSiteConfig,
  deleteSiteConfigValue,
} from '../../shared/api/config-api.js';
import { CONFIG_KEYS } from '../../shared/constants.js';

// Get stylesheet for this section
const NX = 'https://da.live/nx2';
let sectionStyles = null;
try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  sectionStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - section will render without styles

}

/**
 * AEM Assets Integration Section Component
 * Manages AEM Assets configuration with org/site inheritance
 */
export default class AemAssetsSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _configs: { state: true },
    _editingKey: { state: true },
    _editedValue: { state: true },
    _isSaving: { state: true },
    _saveMessage: { state: true },
  };

  constructor() {
    super();
    this._configs = {};
    this._editingKey = null;
    this._editedValue = '';
    this._isSaving = false;
    this._saveMessage = null;
  }

  _getStylesheets() {
    return sectionStyles ? [sectionStyles] : [];
  }

  async loadData() {
    if (!this.org) {
      this._setError('Organization is required');
      return;
    }

    try {
      this._setLoading(true);

      // Load all AEM Assets config keys
      const configKeys = [
        { key: CONFIG_KEYS.AEM_REPOSITORY_ID, label: 'Repository ID', hint: 'AEM Assets repository ID' },
        { key: CONFIG_KEYS.AEM_PROD_ORIGIN, label: 'Production Origin', hint: 'Production origin URL (e.g., https://author-p123-e456.adobeaemcloud.com)' },
        { key: CONFIG_KEYS.AEM_PROD_BASEPATH, label: 'Production Base Path', hint: 'Base path for assets (e.g., /content/dam/mysite)' },
        { key: CONFIG_KEYS.AEM_IMAGE_TYPE, label: 'Image Type', hint: 'Image type (e.g., webp, png)' },
        { key: CONFIG_KEYS.AEM_DM_DELIVERY, label: 'Dynamic Media Delivery', hint: 'Enable Dynamic Media delivery (true/false)' },
        { key: CONFIG_KEYS.AEM_SMARTCROP_SELECT, label: 'Smart Crop Selector', hint: 'Smart crop selector name' },
        { key: CONFIG_KEYS.AEM_MIME_RENDITIONS, label: 'MIME Renditions', hint: 'MIME type renditions mapping' },
      ];

      const configs = {};
      await Promise.all(
        configKeys.map(async ({ key, label, hint }) => {
          const config = await fetchInheritedConfig(
            this.org,
            this.site,
            key,
            this.token,
          );
          configs[key] = {
            ...config,
            label,
            hint,
          };
        }),
      );

      this._configs = configs;
      this._setLoading(false);

      this._trackAction('aem-assets-config-loaded', {
        hasConfigs: Object.keys(configs).length > 0,
      });
    } catch (error) {
      this._setError(`Failed to load AEM Assets configuration: ${error.message}`);
    }
  }

  _validateValue(key, value) {
    const trimmed = value.trim();

    // Repository ID is required
    if (key === CONFIG_KEYS.AEM_REPOSITORY_ID && !trimmed) {
      return { valid: false, message: 'Repository ID is required' };
    }

    // URLs should be valid
    if (key === CONFIG_KEYS.AEM_PROD_ORIGIN && trimmed) {
      try {
        const url = new URL(trimmed);
        if (!url.protocol) {
          return { valid: false, message: 'Must be a valid URL' };
        }
      } catch {
        return { valid: false, message: 'Must be a valid URL' };
      }
    }

    // Boolean values
    if (key === CONFIG_KEYS.AEM_DM_DELIVERY && trimmed) {
      if (trimmed !== 'true' && trimmed !== 'false') {
        return { valid: false, message: 'Must be "true" or "false"' };
      }
    }

    return { valid: true };
  }

  _handleEdit(key) {
    this._editingKey = key;
    this._editedValue = this._configs[key]?.value || '';
    this._saveMessage = null;
    this.requestUpdate();
    // Focus input after render
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector(`.config-input-${key.replace(/\./g, '-')}`)?.focus();
    });
  }

  _handleCancel() {
    this._editingKey = null;
    this._editedValue = '';
    this._saveMessage = null;
  }

  async _handleSave(key) {
    if (this._isSaving) return;

    const validation = this._validateValue(key, this._editedValue);
    if (!validation.valid) {
      this._saveMessage = { type: 'error', text: validation.message };
      return;
    }

    const trimmedValue = this._editedValue.trim();
    const currentValue = this._configs[key]?.value || '';

    if (trimmedValue === currentValue) {
      this._editingKey = null;
      return;
    }

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const result = await updateSiteConfig(
        this.org,
        this.site,
        key,
        trimmedValue,
        this.token,
      );

      if (result.success) {
        this._configs[key].value = trimmedValue;
        this._configs[key].source = 'site';
        this._editingKey = null;
        this._editedValue = '';
        this._saveMessage = { type: 'success', text: `${this._configs[key].label} updated successfully` };

        this._trackAction('aem-assets-config-updated', {
          key,
        });

        // Clear success message after 3 seconds
        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to save configuration' };
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error saving: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  async _handleRevert(key) {
    if (this._isSaving) return;

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const result = await deleteSiteConfigValue(
        this.org,
        this.site,
        key,
        this.token,
      );

      if (result.success) {
        this._configs[key].value = this._configs[key].inheritedValue || null;
        this._configs[key].source = this._configs[key].inheritedValue ? 'org' : null;
        this._editingKey = null;
        this._editedValue = '';
        this._saveMessage = { type: 'success', text: `${this._configs[key].label} reverted to organization default` };

        this._trackAction('aem-assets-config-reverted', {
          key,
        });

        // Clear success message after 3 seconds
        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to revert to default' };
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error reverting: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  _handleInputChange(e) {
    this._editedValue = e.target.value;
    this._saveMessage = null;
  }

  _handleKeyDown(e, key) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._handleSave(key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._handleCancel();
    }
  }

  _renderConfigField(key) {
    const config = this._configs[key];
    if (!config) return '';

    const isEditing = this._editingKey === key;
    const isInherited = this.site && config.source === 'org';
    const canRevert = this.site && config.source === 'site' && config.inheritedValue;
    const inputClass = `config-input-${key.replace(/\./g, '-')}`;

    if (isEditing) {
      return html`
        <div class="config-field is-editing">
          <label class="config-label" for="${key}">${config.label}</label>
          <div class="config-edit-controls">
            <input
              type="text"
              id="${key}"
              class="${inputClass}"
              .value=${this._editedValue}
              @input=${this._handleInputChange}
              @keydown=${(e) => this._handleKeyDown(e, key)}
              ?disabled=${this._isSaving}
              placeholder="${isInherited && config.inheritedValue ? config.inheritedValue : config.hint}"
            />
            <div class="config-actions">
              <button
                class="config-btn config-btn-primary"
                @click=${() => this._handleSave(key)}
                ?disabled=${this._isSaving}
              >
                ${this._isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                class="config-btn config-btn-secondary"
                @click=${this._handleCancel}
                ?disabled=${this._isSaving}
              >
                Cancel
              </button>
            </div>
          </div>
          <p class="config-hint">${config.hint}</p>
        </div>
      `;
    }

    return html`
      <div class="config-field ${isInherited ? 'is-inherited' : ''}">
        <label class="config-label">${config.label}</label>
        <div class="config-value-row">
          <div class="config-value-display">
            <span class="config-value">${config.value || html`<span class="config-empty">Not set</span>`}</span>
            ${isInherited ? html`
              <span class="config-badge">Inherited</span>
            ` : ''}
          </div>
          <div class="config-actions">
            ${this.site ? html`
              <button
                class="config-btn config-btn-secondary"
                @click=${() => this._handleEdit(key)}
              >
                ${isInherited ? 'Override' : 'Edit'}
              </button>
              ${canRevert ? html`
                <button
                  class="config-btn config-btn-tertiary"
                  @click=${() => this._handleRevert(key)}
                  ?disabled=${this._isSaving}
                  title="Revert to organization default"
                >
                  Revert to Default
                </button>
              ` : ''}
            ` : ''}
          </div>
        </div>
        ${isInherited && config.inheritedValue ? html`
          <div class="inheritance-notice">
            Inherited from organization: ${config.inheritedValue}
          </div>
        ` : ''}
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading AEM Assets settings...');
    }

    if (this._error) {
      return this._renderError(this._error, () => this.loadData());
    }

    return html`
      <div class="section-aem-assets">
        <div class="section-header">
          <h2 class="section-title">AEM Assets Integration</h2>
          <p class="section-description">
            Configure AEM Assets integration for asset delivery.
            ${this.site
    ? 'Site-level settings override organization defaults.'
    : 'These settings will be inherited by all sites.'}
          </p>
        </div>

        ${this._saveMessage ? html`
          <div class="message ${this._saveMessage.type}">
            ${this._saveMessage.text}
          </div>
        ` : ''}

        <div class="section-content">
          ${Object.keys(this._configs).map((key) => this._renderConfigField(key))}
        </div>
      </div>
    `;
  }
}

customElements.define('aem-assets-section', AemAssetsSection);
