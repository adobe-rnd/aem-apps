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
try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  sectionStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - section will render without styles

}

/**
 * Translation Settings Section Component
 * Manages translation and rollout configuration with org/site inheritance
 */
export default class TranslationSection extends BaseSectionElement {
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

      // Load all translation config keys
      const configKeys = [
        {
          key: CONFIG_KEYS.TRANSLATE_BEHAVIOR,
          label: 'Translation Behavior',
          hint: 'How to handle old content when new docs come back from translation',
          type: 'select',
          options: [
            { value: 'overwrite', label: 'Overwrite - Replace existing content' },
            { value: 'merge', label: 'Merge - Combine old and new content' },
          ],
          defaultLabel: 'Select...',
        },
        {
          key: CONFIG_KEYS.TRANSLATE_STAGING,
          label: 'Translation Staging',
          hint: 'Stage content in separate area before sending to translation',
          type: 'select',
          options: [
            { value: 'on', label: 'On - Stage before translation' },
            { value: 'off', label: 'Off - Send directly to translation' },
          ],
          defaultLabel: 'Select...',
        },
        {
          key: CONFIG_KEYS.ROLLOUT_BEHAVIOR,
          label: 'Rollout Behavior',
          hint: 'How to handle old content during rollout to locale',
          type: 'select',
          options: [
            { value: 'overwrite', label: 'Overwrite - Replace existing content' },
            { value: 'merge', label: 'Merge - Combine old and new content' },
          ],
          defaultLabel: 'Select...',
        },
      ];

      const configs = {};
      await Promise.all(
        configKeys.map(async ({
          key, label, hint, type, options, defaultLabel,
        }) => {
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
            type,
            options,
            defaultLabel,
          };
        }),
      );

      this._configs = configs;
      this._setLoading(false);

      this._trackAction('translation-config-loaded', {
        hasConfigs: Object.keys(configs).length > 0,
      });
    } catch (error) {
      this._setError(`Failed to load translation configuration: ${error.message}`);
    }
  }

  _validateValue(key, value) {
    const trimmed = value.trim();

    // Translation staging validation
    if (key === CONFIG_KEYS.TRANSLATE_STAGING && trimmed) {
      if (trimmed !== 'on' && trimmed !== 'off') {
        return { valid: false, message: 'Must be "on" or "off"' };
      }
    }

    // Translation behavior validation
    if (key === CONFIG_KEYS.TRANSLATE_BEHAVIOR && trimmed) {
      const validValues = ['overwrite', 'merge'];
      if (!validValues.includes(trimmed)) {
        return { valid: false, message: 'Must be "overwrite" or "merge"' };
      }
    }

    // Rollout behavior validation
    if (key === CONFIG_KEYS.ROLLOUT_BEHAVIOR && trimmed) {
      const validValues = ['overwrite', 'merge'];
      if (!validValues.includes(trimmed)) {
        return { valid: false, message: 'Must be "overwrite" or "merge"' };
      }
    }

    return { valid: true };
  }

  _handleEdit(key) {
    this._editingKey = key;
    this._editedValue = this._configs[key]?.value || '';
    this._saveMessage = null;
    this.requestUpdate();
    // Focus select after render
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector(`.config-select-${key.replace(/\./g, '-')}`)?.focus();
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

        this._trackAction('translation-config-updated', {
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

        this._trackAction('translation-config-reverted', {
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

  _handleSelectChange(e) {
    this._editedValue = e.target.value;
    this._saveMessage = null;
  }

  async _handleTableSave(key, value) {
    this._editedValue = value;
    return this._handleSave(key);
  }

  _prepareSettings() {
    // Transform configs into settings array for compact table
    const settingsConfig = [
      {
        key: CONFIG_KEYS.TRANSLATE_BEHAVIOR,
        required: false,
        helpUrl: 'https://docs.da.live/administrators/guides/setup-translation#behavior',
      },
      {
        key: CONFIG_KEYS.TRANSLATE_STAGING,
        required: false,
        helpUrl: 'https://docs.da.live/administrators/guides/setup-translation#staging',
      },
      {
        key: CONFIG_KEYS.ROLLOUT_BEHAVIOR,
        required: false,
        helpUrl: 'https://docs.da.live/administrators/guides/setup-translation#rollout',
      },
    ];

    return settingsConfig.map(({
      key,
      required,
      helpUrl,
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
        type: config.type || 'text',
        options: config.options,
        defaultLabel: config.defaultLabel,
        hint: config.hint,
        helpUrl,
      };
    }).filter(Boolean);
  }

  _renderExplainerCard() {
    // Check if any translation/rollout settings are configured
    const hasAnyValue = Object.values(this._configs).some((c) => c.value);
    const isConfigured = hasAnyValue;
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
        cardId="translation-integration"
        title="Translation Integration"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Use this when your site needs localized pages, translation service routing, or rollout behavior.</p>
          <p>Configure staging, translation behavior, and rollout rules. If not configured, authors can still create content, but localization workflows will use defaults or may be unavailable.</p>
          <p>Recommended next step: Choose translation behavior first, then define rollout behavior.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/administrators/guides/setup-translation"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Setup Translation</a>
          <a
            href="https://docs.da.live/administrators/guides/translation-strategy"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Translation Strategy</a>
          <a
            href="https://docs.da.live/administrators/reference/localization"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Localization Reference</a>
        </div>
      </explainer-info-card>
    `;
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
      return this._renderLoading('Loading translation settings...');
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

customElements.define('translation-section', TranslationSection);
