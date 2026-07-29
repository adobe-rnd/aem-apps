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
          hint: 'Translation behavior setting (e.g., auto, manual)',
          type: 'select',
          options: [
            { value: '', label: 'Not set' },
            { value: 'auto', label: 'Auto' },
            { value: 'manual', label: 'Manual' },
            { value: 'disabled', label: 'Disabled' },
          ],
        },
        {
          key: CONFIG_KEYS.TRANSLATE_STAGING,
          label: 'Translation Staging',
          hint: 'Enable translation staging environment (true/false)',
          type: 'select',
          options: [
            { value: '', label: 'Not set' },
            { value: 'true', label: 'Enabled' },
            { value: 'false', label: 'Disabled' },
          ],
        },
        {
          key: CONFIG_KEYS.ROLLOUT_BEHAVIOR,
          label: 'Rollout Behavior',
          hint: 'Content rollout behavior (e.g., sync, async, disabled)',
          type: 'select',
          options: [
            { value: '', label: 'Not set' },
            { value: 'sync', label: 'Synchronous' },
            { value: 'async', label: 'Asynchronous' },
            { value: 'disabled', label: 'Disabled' },
          ],
        },
      ];

      const configs = {};
      await Promise.all(
        configKeys.map(async ({
          key, label, hint, type, options,
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

    // Boolean values
    if (key === CONFIG_KEYS.TRANSLATE_STAGING && trimmed) {
      if (trimmed !== 'true' && trimmed !== 'false' && trimmed !== '') {
        return { valid: false, message: 'Must be "true", "false", or empty' };
      }
    }

    // Enum values
    if (key === CONFIG_KEYS.TRANSLATE_BEHAVIOR && trimmed) {
      const validValues = ['auto', 'manual', 'disabled', ''];
      if (!validValues.includes(trimmed)) {
        return { valid: false, message: 'Must be "auto", "manual", "disabled", or empty' };
      }
    }

    if (key === CONFIG_KEYS.ROLLOUT_BEHAVIOR && trimmed) {
      const validValues = ['sync', 'async', 'disabled', ''];
      if (!validValues.includes(trimmed)) {
        return { valid: false, message: 'Must be "sync", "async", "disabled", or empty' };
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

  _getDisplayValue(config) {
    if (!config.value) return html`<span class="config-empty">Not set</span>`;

    // Find the label for the value
    if (config.options) {
      const option = config.options.find((opt) => opt.value === config.value);
      return option?.label || config.value;
    }

    return config.value;
  }

  _renderConfigField(key) {
    const config = this._configs[key];
    if (!config) return '';

    const isEditing = this._editingKey === key;
    const isInherited = this.site && config.source === 'org';
    const canRevert = this.site && config.source === 'site' && config.inheritedValue;
    const selectClass = `config-select-${key.replace(/\./g, '-')}`;

    if (isEditing) {
      return html`
        <div class="config-field is-editing">
          <label class="config-label" for="${key}">${config.label}</label>
          <div class="config-edit-controls">
            ${config.type === 'select' ? html`
              <select
                id="${key}"
                class="${selectClass}"
                .value=${this._editedValue}
                @change=${this._handleSelectChange}
                ?disabled=${this._isSaving}
              >
                ${config.options.map((option) => html`
                  <option value="${option.value}" ?selected=${this._editedValue === option.value}>
                    ${option.label}
                  </option>
                `)}
              </select>
            ` : ''}
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
            <span class="config-value">${this._getDisplayValue(config)}</span>
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
            Inherited from organization: ${this._getDisplayValue({ ...config, value: config.inheritedValue })}
          </div>
        ` : ''}
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading translation settings...');
    }

    if (this._error) {
      return this._renderError(this._error, () => this.loadData());
    }

    return html`
      <div class="section-translation">
        <div class="section-header">
          <h2 class="section-title">Translation & Rollout</h2>
          <p class="section-description">
            Configure translation and content rollout settings.
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

customElements.define('translation-section', TranslationSection);
