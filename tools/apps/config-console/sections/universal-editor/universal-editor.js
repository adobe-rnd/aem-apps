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
 * Universal Editor Integration Section Component
 * Manages Universal Editor configuration with org/site inheritance
 */
export default class UniversalEditorSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _editorPath: { state: true },
    _source: { state: true },
    _inheritedValue: { state: true },
    _editedPath: { state: true },
    _isEditing: { state: true },
    _isSaving: { state: true },
    _saveMessage: { state: true },
  };

  constructor() {
    super();
    this._editorPath = null;
    this._source = null;
    this._inheritedValue = null;
    this._editedPath = '';
    this._isEditing = false;
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
      const config = await fetchInheritedConfig(
        this.org,
        this.site,
        CONFIG_KEYS.EDITOR_PATH,
        this.token,
      );

      this._editorPath = config.value || null;
      this._source = config.source;
      this._inheritedValue = config.inheritedValue;
      this._editedPath = this._editorPath || '';
      this._setLoading(false);

      this._trackAction('universal-editor-config-loaded', {
        hasValue: !!config.value,
        source: config.source,
      });
    } catch (error) {
      this._setError(`Failed to load Universal Editor configuration: ${error.message}`);
    }
  }

  _validatePath(path) {
    const trimmed = path.trim();
    if (!trimmed) {
      // Empty is valid (means not using Universal Editor)
      return { valid: true };
    }

    // Should be a valid URL or path
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const url = new URL(trimmed);
        if (!url.protocol) {
          return { valid: false, message: 'Must be a valid URL' };
        }
      } catch {
        return { valid: false, message: 'Must be a valid URL' };
      }
    } else if (!trimmed.startsWith('/')) {
      return { valid: false, message: 'Path must start with a forward slash or be a complete URL' };
    }

    return { valid: true };
  }

  _handleEdit() {
    this._isEditing = true;
    this._editedPath = this._editorPath || '';
    this._saveMessage = null;
    this.requestUpdate();
    // Focus input after render
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('.editor-path-input')?.focus();
    });
  }

  _handleCancel() {
    this._isEditing = false;
    this._editedPath = this._editorPath || '';
    this._saveMessage = null;
  }

  async _handleSave() {
    if (this._isSaving) return;

    const validation = this._validatePath(this._editedPath);
    if (!validation.valid) {
      this._saveMessage = { type: 'error', text: validation.message };
      return;
    }

    const trimmedPath = this._editedPath.trim();
    if (trimmedPath === (this._editorPath || '')) {
      this._isEditing = false;
      return;
    }

    this._isSaving = true;
    this._saveMessage = null;

    try {
      // If empty, delete the config (revert to org default or unset)
      if (!trimmedPath) {
        const result = await deleteSiteConfigValue(
          this.org,
          this.site,
          CONFIG_KEYS.EDITOR_PATH,
          this.token,
        );

        if (result.success) {
          this._editorPath = this._inheritedValue || null;
          this._source = this._inheritedValue ? 'org' : null;
          this._editedPath = this._editorPath || '';
          this._isEditing = false;
          this._saveMessage = { type: 'success', text: 'Universal Editor path cleared' };

          this._trackAction('universal-editor-path-cleared');

          // Clear success message after 3 seconds
          setTimeout(() => {
            this._saveMessage = null;
            this.requestUpdate();
          }, 3000);
        } else {
          this._saveMessage = { type: 'error', text: result.error || 'Failed to clear editor path' };
        }
      } else {
        const result = await updateSiteConfig(
          this.org,
          this.site,
          CONFIG_KEYS.EDITOR_PATH,
          trimmedPath,
          this.token,
        );

        if (result.success) {
          this._editorPath = trimmedPath;
          this._source = 'site';
          this._editedPath = trimmedPath;
          this._isEditing = false;
          this._saveMessage = { type: 'success', text: 'Universal Editor path updated successfully' };

          this._trackAction('universal-editor-path-updated', {
            newPath: trimmedPath,
          });

          // Clear success message after 3 seconds
          setTimeout(() => {
            this._saveMessage = null;
            this.requestUpdate();
          }, 3000);
        } else {
          this._saveMessage = { type: 'error', text: result.error || 'Failed to save editor path' };
        }
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error saving: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  async _handleRevert() {
    if (this._isSaving) return;

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const result = await deleteSiteConfigValue(
        this.org,
        this.site,
        CONFIG_KEYS.EDITOR_PATH,
        this.token,
      );

      if (result.success) {
        this._editorPath = this._inheritedValue || null;
        this._source = this._inheritedValue ? 'org' : null;
        this._editedPath = this._editorPath || '';
        this._isEditing = false;
        this._saveMessage = { type: 'success', text: 'Reverted to organization default' };

        this._trackAction('universal-editor-path-reverted', {
          revertedTo: this._editorPath || 'unset',
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
    this._editedPath = e.target.value;
    this._saveMessage = null;
  }

  _handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this._handleCancel();
    }
  }

  async _handleTableSave(key, value) {
    this._editedPath = value;
    return this._handleSave();
  }

  _prepareSettings() {
    // Transform single editor path into settings array for compact table
    return [{
      key: CONFIG_KEYS.EDITOR_PATH,
      label: 'Universal Editor Path',
      value: this._editorPath,
      source: this._source,
      inheritedValue: this._inheritedValue,
      required: false,
      type: 'text',
      placeholder: 'https://experience.adobe.com/editor or /universal-editor',
      hint: 'Specify the Universal Editor path or URL to enable inline content editing',
      helpUrl: 'https://docs.da.live/about/early-access/experience-workspace',
    }];
  }

  _renderExplainerCard() {
    const isConfigured = !!this._editorPath;
    const hasSiteConfig = this.site && this._source === 'site';

    const status = isConfigured ? 'configured' : 'not-configured';
    const statusLabel = (() => {
      if (!isConfigured) return 'Not Configured';
      if (this.site && hasSiteConfig) return 'Site Scoped';
      if (this.site) return 'Inherited from Org';
      return 'Configured';
    })();

    return html`
      <explainer-info-card
        cardId="experience-workspace-integration"
        title="Experience Workspace"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Enable visual editing where authors can edit, preview, and publish without switching tools. Combines inline editing with real-time preview.</p>
          <p>If not enabled, authors use the standard document-based authoring flow. Once enabled, authors get a unified workspace with Quick Edit and visual page editing.</p>
          <p>This feature is in early access. Configuration opens the Experience Workspace enablement flow.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/about/early-access/experience-workspace"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Experience Workspace Docs</a>
          <a
            href="https://docs.da.live/about/early-access/quick-edit"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Quick Edit</a>
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
        .onRevert=${() => this._handleRevert()}
        .isSaving=${this._isSaving}
      ></compact-settings-table>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading Universal Editor settings...');
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

customElements.define('universal-editor-section', UniversalEditorSection);
