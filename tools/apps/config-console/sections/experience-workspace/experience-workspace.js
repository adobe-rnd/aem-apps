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
 * Experience Workspace Section Component
 * Manages Experience Workspace configuration with org/site inheritance
 */
export default class ExperienceWorkspaceSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _configs: { state: true },
    _isSaving: { state: true },
    _saveMessage: { state: true },
  };

  constructor() {
    super();
    this._configs = {};
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

      // Load all EW config keys
      const configKeys = [
        {
          key: CONFIG_KEYS.EW_ENABLED,
          label: 'Experience Workspace',
          hint: 'Enable Experience Workspace authoring interface',
          type: 'select',
          options: [
            { value: '', label: 'Disabled' },
            { value: 'on', label: 'Enabled' },
          ],
          defaultLabel: 'Select...',
        },
        {
          key: CONFIG_KEYS.EW_CHAT,
          label: 'AI Chat',
          hint: 'Enable AI assistant in Experience Workspace',
          type: 'select',
          options: [
            { value: '', label: 'Disabled' },
            { value: 'on', label: 'Enabled' },
          ],
          defaultLabel: 'Select...',
        },
        {
          key: CONFIG_KEYS.EW_CANVAS_DEFAULT,
          label: 'Default Canvas Mode',
          hint: 'Default canvas view when opening EW',
          type: 'select',
          options: [
            { value: '', label: 'Standard' },
            { value: 'split', label: 'Split View' },
          ],
          defaultLabel: 'Select...',
        },
        {
          key: CONFIG_KEYS.EW_PANEL_DEFAULT,
          label: 'Default Panel',
          hint: 'Default panel shown when opening EW',
          type: 'select',
          options: [
            { value: '', label: 'None' },
            { value: 'chat', label: 'AI Chat' },
            { value: 'properties', label: 'Properties' },
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

      this._trackAction('experience-workspace-config-loaded', {
        hasConfigs: Object.keys(configs).length > 0,
      });
    } catch (error) {
      this._setError(`Failed to load Experience Workspace configuration: ${error.message}`);
    }
  }

  async _handleSave(key, value) {
    if (this._isSaving) return;

    const trimmedValue = value.trim();
    const currentValue = this._configs[key]?.value || '';

    if (trimmedValue === currentValue) {
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
        this._saveMessage = { type: 'success', text: `${this._configs[key].label} updated successfully` };

        this._trackAction('experience-workspace-config-updated', {
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
        this._saveMessage = { type: 'success', text: `${this._configs[key].label} reverted to organization default` };

        this._trackAction('experience-workspace-config-reverted', {
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

  _prepareSettings() {
    // Transform configs into settings array for compact table
    const settingsConfig = [
      {
        key: CONFIG_KEYS.EW_ENABLED,
        required: false,
        helpUrl: 'https://docs.da.live/about/early-access/experience-workspace#setup',
      },
      {
        key: CONFIG_KEYS.EW_CHAT,
        required: false,
        helpUrl: 'https://docs.da.live/about/early-access/experience-workspace#ai-chat',
      },
      {
        key: CONFIG_KEYS.EW_CANVAS_DEFAULT,
        required: false,
        helpUrl: 'https://docs.da.live/about/early-access/experience-workspace#canvas',
      },
      {
        key: CONFIG_KEYS.EW_PANEL_DEFAULT,
        required: false,
        helpUrl: 'https://docs.da.live/about/early-access/experience-workspace#panels',
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
    // Check if EW is enabled
    const isEnabled = this._configs[CONFIG_KEYS.EW_ENABLED]?.value === 'on';
    const hasSiteConfig = Object.values(this._configs).some((c) => c.source === 'site');

    const status = isEnabled ? 'configured' : 'not-configured';
    const statusLabel = (() => {
      if (!isEnabled) return 'Not Enabled';
      if (this.site && hasSiteConfig) return 'Site Scoped';
      if (this.site) return 'Inherited from Org';
      return 'Enabled';
    })();

    return html`
      <explainer-info-card
        cardId="experience-workspace-integration"
        title="Experience Workspace"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Experience Workspace is an intelligent authoring surface where humans and AI agents collaborate to build, edit, and optimize digital experiences.</p>
          <p>Configure flags to control authoring behavior, enable AI features, and customize the default experience. ${!isEnabled ? 'Enable Experience Workspace to activate these features.' : 'Authors can now use Experience Workspace for content creation.'}</p>
          <p>For advanced setup and configuration, use the dedicated Experience Workspace Setup tool.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/about/early-access/experience-workspace"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Documentation</a>
          <button
            class="btn-small btn-primary"
            @click=${this._openSetupTool}
          >Open Setup Tool</button>
        </div>
      </explainer-info-card>
    `;
  }

  _openSetupTool() {
    const setupUrl = this.site
      ? `https://da.live/app/${this.org}/${this.site}/tools/ew-setup/ew-setup`
      : `https://da.live/app/${this.org}/tools/ew-setup/ew-setup`;

    this._trackAction('experience-workspace-setup-opened', {
      org: this.org,
      site: this.site,
    });

    window.open(setupUrl, '_blank', 'noopener,noreferrer');
  }

  _renderSettingsCard() {
    const settings = this._prepareSettings();

    return html`
      <compact-settings-table
        .settings=${settings}
        .onSave=${(key, value) => this._handleSave(key, value)}
        .onRevert=${(key) => this._handleRevert(key)}
        .isSaving=${this._isSaving}
      ></compact-settings-table>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading Experience Workspace settings...');
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

customElements.define('experience-workspace-section', ExperienceWorkspaceSection);
