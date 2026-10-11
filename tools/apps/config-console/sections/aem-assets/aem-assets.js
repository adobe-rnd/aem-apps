// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  fetchInheritedConfig,
  updateSiteConfig,
  updateOrgConfig,
  deleteSiteConfigValue,
} from '../../shared/api/config-api.js';
import { CONFIG_KEYS } from '../../shared/constants.js';
import '../../components/explainer-info-card.js';
import '../../components/compact-settings-table.js';

// Get stylesheet for this section
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
    return [commonStyles, sectionStyles].filter(Boolean);
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

    // Repository ID validation
    if (key === CONFIG_KEYS.AEM_REPOSITORY_ID) {
      if (!trimmed) {
        return { valid: false, message: 'Repository ID is required' };
      }
      // Must match author-pXXXX-eYYYY or delivery-pXXXX-eYYYY format
      const repoPattern = /^(author|delivery)-p\d+-e\d+\.adobeaemcloud\.com$/;
      if (!repoPattern.test(trimmed)) {
        return { valid: false, message: 'Must be format: author-p12345-e67890.adobeaemcloud.com' };
      }
    }

    // Production origin - just domain, no protocol required
    if (key === CONFIG_KEYS.AEM_PROD_ORIGIN && trimmed) {
      // Accept domain with or without protocol
      const domainPattern = /^([a-z0-9-]+\.)*[a-z0-9-]+\.[a-z]{2,}$/i;
      const urlPattern = /^https?:\/\//;

      if (urlPattern.test(trimmed)) {
        return { valid: false, message: 'Enter domain only without protocol (e.g., production-domain.com)' };
      }
      if (!domainPattern.test(trimmed)) {
        return { valid: false, message: 'Must be a valid domain' };
      }
    }

    // DM Delivery validation
    if (key === CONFIG_KEYS.AEM_DM_DELIVERY && trimmed) {
      if (trimmed !== 'on') {
        return { valid: false, message: 'Must be "on" or empty' };
      }
    }

    // Smart Crop validation
    if (key === CONFIG_KEYS.AEM_SMARTCROP_SELECT && trimmed) {
      if (trimmed !== 'on') {
        return { valid: false, message: 'Must be "on" or empty' };
      }
    }

    // Image Type validation
    if (key === CONFIG_KEYS.AEM_IMAGE_TYPE && trimmed) {
      if (trimmed !== 'link') {
        return { valid: false, message: 'Must be "link" or empty' };
      }
    }

    // MIME Renditions validation
    if (key === CONFIG_KEYS.AEM_MIME_RENDITIONS && trimmed) {
      // Format: mimetype:renditiontype, mimetype:renditiontype
      const pairs = trimmed.split(',').map((p) => p.trim());
      const invalidPair = pairs.find((pair) => !pair.includes(':'));
      if (invalidPair) {
        return { valid: false, message: 'Format: mimetype:renditiontype (e.g., image/jpeg:avif)' };
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
      // Use appropriate API based on context (org vs site)
      const result = this.site
        ? await updateSiteConfig(this.org, this.site, key, trimmedValue, this.token)
        : await updateOrgConfig(this.org, key, trimmedValue, this.token);

      if (result.success) {
        this._configs[key].value = trimmedValue;
        this._configs[key].source = this.site ? 'site' : 'org';
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

  _prepareSettings() {
    // Transform configs into settings array for compact table
    const settingsConfig = [
      {
        key: CONFIG_KEYS.AEM_REPOSITORY_ID,
        required: true,
        placeholder: 'author-p12345-e67890.adobeaemcloud.com',
        helpUrl: 'https://docs.da.live/administrators/guides/setup-aem-assets#repository-id',
      },
      {
        key: CONFIG_KEYS.AEM_PROD_ORIGIN,
        required: false,
        placeholder: 'production-domain.com',
        helpUrl: 'https://docs.da.live/administrators/guides/setup-aem-assets#production-origin',
      },
      {
        key: CONFIG_KEYS.AEM_PROD_BASEPATH,
        required: false,
        placeholder: '/content/dam/mysite',
        helpUrl: 'https://docs.da.live/administrators/guides/setup-aem-assets#base-path',
      },
      {
        key: CONFIG_KEYS.AEM_IMAGE_TYPE,
        required: false,
        type: 'select',
        options: [
          { value: '', label: 'Default (image tag)' },
          { value: 'link', label: 'Link' },
        ],
        defaultLabel: 'Select...',
        helpUrl: 'https://docs.da.live/administrators/guides/setup-aem-assets#image-type',
      },
      {
        key: CONFIG_KEYS.AEM_DM_DELIVERY,
        required: false,
        type: 'select',
        options: [
          { value: '', label: 'Disabled' },
          { value: 'on', label: 'Enabled' },
        ],
        defaultLabel: 'Select...',
        helpUrl: 'https://docs.da.live/administrators/guides/setup-aem-assets#dynamic-media',
      },
      {
        key: CONFIG_KEYS.AEM_SMARTCROP_SELECT,
        required: false,
        type: 'select',
        options: [
          { value: '', label: 'Disabled' },
          { value: 'on', label: 'Enabled' },
        ],
        defaultLabel: 'Select...',
        helpUrl: 'https://docs.da.live/administrators/guides/setup-aem-assets#smart-crop',
      },
      {
        key: CONFIG_KEYS.AEM_MIME_RENDITIONS,
        required: false,
        placeholder: 'image/vnd.adobe.photoshop:avif, video/*:original',
        helpUrl: 'https://docs.da.live/administrators/guides/setup-aem-assets#renditions',
      },
    ];

    return settingsConfig.map(({
      key,
      required,
      placeholder,
      helpUrl,
      type,
      options,
      defaultLabel,
    }) => {
      const config = this._configs[key];
      if (!config) return null;

      return {
        key,
        label: config.label,
        value: config.value,
        source: config.source,
        inheritedValue: config.inheritedValue,
        required,
        type: type || 'text',
        options,
        defaultLabel,
        placeholder,
        hint: config.hint,
        helpUrl,
      };
    }).filter(Boolean);
  }

  _renderExplainerCard() {
    // Check if Repository ID is configured (required for AEM Assets)
    const repositoryId = this._configs[CONFIG_KEYS.AEM_REPOSITORY_ID]?.value;
    const isConfigured = !!repositoryId;
    const hasSiteConfig = Object.values(this._configs).some((c) => c.source === 'site');

    const status = isConfigured ? 'configured' : 'not-configured';
    const statusLabel = (() => {
      if (!isConfigured) return 'Not Configured';
      if (this.site && hasSiteConfig) return 'Site Scoped';
      if (this.site) return 'Inherited from Org';
      return 'Configured';
    })();

    return html`
      <explainer-info-card
        cardId="aem-assets-integration"
        title="AEM Assets Integration"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Connect this ${this.site ? 'site' : 'organization'} to AEM Assets so authors can browse, select, and deliver approved assets directly in their workflow.</p>
          <p>Required first: Repository ID and Production Origin. Optional: Dynamic Media delivery, smart crops, image types.</p>
          <p>${!isConfigured ? 'Without configuration, authors cannot access AEM Assets from the authoring environment.' : 'Asset delivery is active. Authors can browse and insert assets.'}</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/administrators/guides/setup-aem-assets"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Setup AEM Assets</a>
        </div>
      </explainer-info-card>
    `;
  }

  async _handleTableSave(key, value) {
    this._editedValue = value;
    return this._handleSave(key);
  }

  _renderSettingsCard() {
    const settings = this._prepareSettings();

    return html`
      <compact-settings-table
        .settings=${settings}
        .onSave=${(key, value) => this._handleTableSave(key, value)}
        .onRevert=${(key) => this._handleRevert(key)}
        .isSaving=${this._isSaving}
      ></compact-settings-table>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading AEM Assets settings...');
    }

    if (this._error) {
      return this._renderError(this._error);
    }

    return html`
      <div class="section-container">
        ${this._renderExplainerCard()}

        ${this._saveMessage ? html`
          <div class="message ${this._saveMessage.type}">
            ${this._saveMessage.text}
          </div>
        ` : ''}

        ${this._renderSettingsCard()}
      </div>
    `;
  }
}

customElements.define('aem-assets-section', AemAssetsSection);
