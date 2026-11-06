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
import {
  CONFIG_KEYS,
  DEFAULT_LIBRARY_BASE_PATH,
} from '../../shared/constants.js';

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
 * Library Settings Section Component
 * Manages the library base path configuration with org/site inheritance
 */
export default class LibrarySection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _libraryPath: { state: true },
    _source: { state: true },
    _inheritedValue: { state: true },
    _editedPath: { state: true },
    _isEditing: { state: true },
    _isSaving: { state: true },
    _saveMessage: { state: true },
  };

  constructor() {
    super();
    this._libraryPath = null;
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
        CONFIG_KEYS.LIBRARY_BASE_PATH,
        this.token,
      );

      this._libraryPath = config.value || DEFAULT_LIBRARY_BASE_PATH;
      this._source = config.source;
      this._inheritedValue = config.inheritedValue;
      this._editedPath = this._libraryPath;
      this._setLoading(false);

      this._trackAction('library-config-loaded', {
        hasValue: !!config.value,
        source: config.source,
      });
    } catch (error) {
      this._setError(`Failed to load library configuration: ${error.message}`);
    }
  }

  _validatePath(path) {
    const trimmed = path.trim();
    if (!trimmed) {
      return { valid: false, message: 'Library path cannot be empty' };
    }
    if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
      return { valid: false, message: 'Library path should not start or end with a slash' };
    }
    if (!/^[a-zA-Z0-9-_/]+$/.test(trimmed)) {
      return { valid: false, message: 'Library path can only contain alphanumeric characters, hyphens, underscores, and forward slashes' };
    }
    return { valid: true };
  }

  _handleEdit() {
    this._isEditing = true;
    this._editedPath = this._libraryPath;
    this._saveMessage = null;
    this.requestUpdate();
    // Focus input after render
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('.library-path-input')?.focus();
    });
  }

  _handleCancel() {
    this._isEditing = false;
    this._editedPath = this._libraryPath;
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
    if (trimmedPath === this._libraryPath) {
      this._isEditing = false;
      return;
    }

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const result = await updateSiteConfig(
        this.org,
        this.site,
        CONFIG_KEYS.LIBRARY_BASE_PATH,
        trimmedPath,
        this.token,
      );

      if (result.success) {
        this._libraryPath = trimmedPath;
        this._source = 'site';
        this._editedPath = trimmedPath;
        this._isEditing = false;
        this._saveMessage = { type: 'success', text: 'Library path updated successfully' };

        this._trackAction('library-path-updated', {
          newPath: trimmedPath,
        });

        // Clear success message after 3 seconds
        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to save library path' };
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
        CONFIG_KEYS.LIBRARY_BASE_PATH,
        this.token,
      );

      if (result.success) {
        this._libraryPath = this._inheritedValue || DEFAULT_LIBRARY_BASE_PATH;
        this._source = this._inheritedValue ? 'org' : null;
        this._editedPath = this._libraryPath;
        this._isEditing = false;
        this._saveMessage = { type: 'success', text: 'Reverted to organization default' };

        this._trackAction('library-path-reverted', {
          revertedTo: this._libraryPath,
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

  _renderInheritanceInfo() {
    if (!this.site || !this._inheritedValue || this._source !== 'org') {
      return '';
    }

    return html`
      <div class="inheritance-notice">
        Inherited from organization (${this._inheritedValue})
      </div>
    `;
  }

  _renderConfigField() {
    const isInherited = this.site && this._source === 'org';
    const canRevert = this.site && this._source === 'site' && this._inheritedValue;

    if (this._isEditing) {
      return html`
        <div class="config-field is-editing">
          <label class="config-label" for="library-path">Library Base Path</label>
          <div class="config-edit-controls">
            <input
              type="text"
              id="library-path"
              class="library-path-input"
              .value=${this._editedPath}
              @input=${this._handleInputChange}
              @keydown=${this._handleKeyDown}
              ?disabled=${this._isSaving}
              placeholder="e.g., library"
            />
            <div class="config-actions">
              <button
                class="config-btn config-btn-primary"
                @click=${this._handleSave}
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
          <p class="config-hint">
            Specify the base path for library content (blocks, templates, icons).
            Do not include leading or trailing slashes.
          </p>
        </div>
      `;
    }

    return html`
      <div class="config-field ${isInherited ? 'is-inherited' : ''}">
        <label class="config-label">Library Base Path</label>
        <div class="config-value-row">
          <div class="config-value-display">
            <span class="config-value">${this._libraryPath}</span>
            ${isInherited ? html`
              <span class="config-badge">Inherited</span>
            ` : ''}
          </div>
          <div class="config-actions">
            ${this.site ? html`
              <button
                class="config-btn config-btn-secondary"
                @click=${this._handleEdit}
              >
                ${isInherited ? 'Override' : 'Edit'}
              </button>
              ${canRevert ? html`
                <button
                  class="config-btn config-btn-tertiary"
                  @click=${this._handleRevert}
                  ?disabled=${this._isSaving}
                  title="Revert to organization default"
                >
                  Revert to Default
                </button>
              ` : ''}
            ` : ''}
          </div>
        </div>
        ${this._renderInheritanceInfo()}
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading library settings...');
    }

    if (this._error) {
      return this._renderError(this._error);
    }

    return html`
      <div class="section-library">
        <div class="section-header">
          <h2 class="section-title">Library Settings</h2>
          <p class="section-description">
            Configure the base path for library content (blocks, templates, icons).
            ${this.site
    ? 'Site-level settings override organization defaults.'
    : 'This setting will be inherited by all sites.'}
          </p>
        </div>

        ${this._saveMessage ? html`
          <div class="message ${this._saveMessage.type}">
            ${this._saveMessage.text}
          </div>
        ` : ''}

        <div class="section-content">
          ${this._renderConfigField()}
        </div>
      </div>
    `;
  }
}

customElements.define('library-section', LibrarySection);
