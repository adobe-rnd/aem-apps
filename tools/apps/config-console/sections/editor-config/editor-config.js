// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  fetchAllEditorPaths,
  addEditorPath,
  updateEditorPath,
  deleteEditorPath,
} from '../../shared/api/config-api.js';
import { EDITOR_TYPES } from '../../shared/constants.js';
import '../../shared/components/folder-picker.js';
import '../../components/explainer-info-card.js';

// Get stylesheet for this section
const NX = 'https://da.live/nx2';
let sectionStyles = null;
let commonStyles = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  const commonStylesUrl = new URL('/tools/apps/config-console/shared/styles/common-section-styles.css', window.location.origin).href;
  commonStyles = await getStyle(commonStylesUrl);
  sectionStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - section will render without styles
}

/**
 * Editor Configuration Section Component
 * Manages path-to-editor mappings with org/site inheritance
 */
export default class EditorConfigSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _editorPaths: { state: true },
    _isAdding: { state: true },
    _editingPath: { state: true },
    _editingSource: { state: true },
    _newPath: { state: true },
    _newEditorType: { state: true },
    _editPath: { state: true },
    _editEditorType: { state: true },
    _originalEditPath: { state: true },
    _isSaving: { state: true },
    _saveMessage: { state: true },
    _folderPickerOpen: { state: true },
    _folderPickerMode: { state: true },
  };

  constructor() {
    super();
    this._editorPaths = [];
    this._isAdding = false;
    this._editingPath = null;
    this._editingSource = null;
    this._newPath = '';
    this._newEditorType = 'experience-workspace';
    this._editPath = '';
    this._editEditorType = 'experience-workspace';
    this._originalEditPath = '';
    this._isSaving = false;
    this._saveMessage = null;
    this._folderPickerOpen = false;
    this._folderPickerMode = null;
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

      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out after 30 seconds')), 30000);
      });

      const paths = await Promise.race([
        fetchAllEditorPaths(this.org, this.site, this.token),
        timeoutPromise,
      ]);

      this._editorPaths = paths;
      this._setLoading(false);

      this._trackAction('editor-config-loaded', {
        pathCount: paths.length,
      });
    } catch (error) {
      this._setError(`Failed to load editor configuration: ${error.message}`);
    }
  }

  _getEditorTypeLabel(url) {
    const entry = Object.entries(EDITOR_TYPES).find(([, config]) => url === config.url);
    return entry ? entry[1].label : 'Custom Editor';
  }

  _getEditorTypeKey(url) {
    const entry = Object.entries(EDITOR_TYPES).find(([, config]) => url === config.url);
    return entry ? entry[0] : null;
  }

  _handleAdd() {
    this._isAdding = true;
    this._newPath = '';
    this._newEditorType = 'experience-workspace';
    this._saveMessage = null;
  }

  _handleOverride(path, editorUrl) {
    // Pre-populate add form to create site-level override
    this._isAdding = true;
    this._newPath = path;
    const editorKey = this._getEditorTypeKey(editorUrl);
    this._newEditorType = editorKey || 'experience-workspace';
    this._saveMessage = null;
  }

  _isPathRelevantToCurrentSite(path) {
    // Check if an org-level path is relevant to the current site
    if (!this.site || !path) return true;

    // If path starts with /{org}/{site}/, check if it matches current site
    const pathMatch = path.match(/^\/([^/]+)\/([^/]+)\//);
    if (pathMatch) {
      const [, pathOrg, pathSite] = pathMatch;
      // Path is site-specific - only relevant if it matches current org/site
      return pathOrg === this.org && pathSite === this.site;
    }

    // Path doesn't specify a site, so it's relevant to all sites
    return true;
  }

  _renderSiteLevelActions(item) {
    const isRelevant = item.source === 'site' || this._isPathRelevantToCurrentSite(item.path);
    if (!isRelevant) {
      return '';
    }

    return html`
      <button
        class="btn-small btn-secondary"
        @click=${() => {
    if (item.source === 'org') {
      this._handleOverride(item.path, item.editorUrl);
    } else {
      this._handleEdit(item.path, item.editorUrl, item.source);
    }
  }}
        ?disabled=${this._isAdding || this._editingPath}
      >
        Edit
      </button>
      ${item.source === 'site' ? html`
        <button
          class="btn-small btn-danger"
          @click=${() => this._handleDelete(item.path, item.source)}
          ?disabled=${this._isAdding || this._editingPath || this._isSaving}
        >
          Delete
        </button>
      ` : ''}
    `;
  }

  _renderOrgLevelActions(item) {
    if (item.source !== 'org') {
      return html`<span class="inherited-note">Inherited from org</span>`;
    }

    return html`
      <button
        class="btn-small btn-secondary"
        @click=${() => this._handleEdit(item.path, item.editorUrl, item.source)}
        ?disabled=${this._isAdding || this._editingPath}
      >
        Edit
      </button>
      <button
        class="btn-small btn-danger"
        @click=${() => this._handleDelete(item.path, item.source)}
        ?disabled=${this._isAdding || this._editingPath || this._isSaving}
      >
        Delete
      </button>
    `;
  }

  _handleCancelAdd() {
    this._isAdding = false;
    this._newPath = '';
    this._saveMessage = null;
  }

  _handleEdit(path, editorUrl, source) {
    this._editingPath = path;
    this._editingSource = source;
    this._originalEditPath = path;
    this._editPath = path;
    const editorKey = this._getEditorTypeKey(editorUrl);
    this._editEditorType = editorKey || 'experience-workspace';
    this._saveMessage = null;
  }

  _handleCancelEdit() {
    this._editingPath = null;
    this._editingSource = null;
    this._editPath = '';
    this._saveMessage = null;
  }

  _handleNewPathChange(e) {
    this._newPath = e.target.value;
  }

  _handleNewEditorTypeChange(e) {
    this._newEditorType = e.target.value;
  }

  _handleEditPathChange(e) {
    this._editPath = e.target.value;
  }

  _handleEditEditorTypeChange(e) {
    this._editEditorType = e.target.value;
  }

  _handleOpenFolderPicker(mode) {
    this._folderPickerMode = mode;
    this._folderPickerOpen = true;
  }

  _handleFolderSelected(e) {
    const { path } = e.detail;
    if (this._folderPickerMode === 'add') {
      this._newPath = path;
    } else if (this._folderPickerMode === 'edit') {
      this._editPath = path;
    }
    this._folderPickerOpen = false;
    this._folderPickerMode = null;
    this.requestUpdate();
  }

  _handleCloseFolderPicker() {
    this._folderPickerOpen = false;
    this._folderPickerMode = null;
  }

  async _handleSaveNew() {
    if (this._isSaving) return;

    const trimmedPath = this._newPath.trim();
    if (!trimmedPath) {
      this._saveMessage = { type: 'error', text: 'Path is required' };
      return;
    }

    const editorUrl = EDITOR_TYPES[this._newEditorType].url;

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const result = await addEditorPath(
        this.org,
        this.site,
        trimmedPath,
        editorUrl,
        this.token,
      );

      if (result.success) {
        await this.loadData();
        this._isAdding = false;
        this._newPath = '';
        this._saveMessage = { type: 'success', text: 'Editor path added successfully' };

        this._trackAction('editor-path-added', {
          path: trimmedPath,
          editorType: this._newEditorType,
        });

        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to add editor path' };
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error saving: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  async _handleSaveEdit() {
    if (this._isSaving) return;

    const trimmedPath = this._editPath.trim();
    if (!trimmedPath) {
      this._saveMessage = { type: 'error', text: 'Path is required' };
      return;
    }

    const editorUrl = EDITOR_TYPES[this._editEditorType].url;

    this._isSaving = true;
    this._saveMessage = null;

    try {
      // Use the source to determine which config to update
      const siteToUse = this._editingSource === 'site' ? this.site : null;
      const result = await updateEditorPath(
        this.org,
        siteToUse,
        this._originalEditPath,
        trimmedPath,
        editorUrl,
        this.token,
      );

      if (result.success) {
        await this.loadData();
        this._editingPath = null;
        this._editingSource = null;
        this._editPath = '';
        this._saveMessage = { type: 'success', text: 'Editor path updated successfully' };

        this._trackAction('editor-path-updated', {
          oldPath: this._originalEditPath,
          newPath: trimmedPath,
          editorType: this._editEditorType,
        });

        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to update editor path' };
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error saving: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  async _handleDelete(path, source) {
    if (this._isSaving) return;

    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm(`Are you sure you want to delete the editor mapping for "${path}"?`)) {
      return;
    }

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const siteToUse = source === 'site' ? this.site : null;
      const result = await deleteEditorPath(
        this.org,
        siteToUse,
        path,
        this.token,
      );

      if (result.success) {
        await this.loadData();
        this._saveMessage = { type: 'success', text: 'Editor path deleted successfully' };

        this._trackAction('editor-path-deleted', {
          path,
          source,
        });

        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to delete editor path' };
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error deleting: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  _renderExplainerCard() {
    const pathCount = this._editorPaths.length;
    const status = pathCount > 0 ? 'configured' : 'not-configured';
    const statusLabel = pathCount > 0 ? `${pathCount} Path${pathCount === 1 ? '' : 's'} Configured` : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="editor-configuration"
        title="Editor Configuration"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Configure which editor type opens for different content paths. Map folders to specific editing experiences like Canvas, Forms, or the Universal Editor.</p>
          <p>Authors will be directed to the configured editor when they open content in these paths. This allows different editing workflows for different content types.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/about/early-access/experience-workspace"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Experience Workspace Docs</a>
        </div>
      </explainer-info-card>
    `;
  }

  _renderEditorTypeDropdown(selectedType, onChangeHandler) {
    return html`
      <select class="editor-type-select" .value=${selectedType} @change=${onChangeHandler}>
        ${Object.entries(EDITOR_TYPES).map(([key, config]) => html`
          <option value="${key}" ?selected=${selectedType === key}>
            ${config.label}
          </option>
        `)}
      </select>
    `;
  }

  _renderPathsTable() {
    return html`
      <div class="editor-paths-card">
        <div class="card-header">
          <h3>Editor Paths</h3>
          <button
            class="btn-small btn-primary"
            @click=${this._handleAdd}
            ?disabled=${this._isAdding || this._editingPath}
          >
            Add Path
          </button>
        </div>

        ${this._saveMessage ? html`
          <div class="message ${this._saveMessage.type}">
            ${this._saveMessage.text}
          </div>
        ` : ''}

        ${this._isAdding ? html`
          <div class="add-path-form">
            <div class="form-row">
              <label>Path</label>
              <div class="path-input-group">
                <input
                  type="text"
                  class="path-input"
                  .value=${this._newPath}
                  @input=${this._handleNewPathChange}
                  placeholder="/path/to/folder"
                  ?disabled=${this._isSaving}
                />
                <button
                  class="btn-small btn-secondary"
                  @click=${() => this._handleOpenFolderPicker('add')}
                  ?disabled=${this._isSaving}
                >
                  Browse
                </button>
              </div>
            </div>
            <div class="form-row">
              <label>Editor Type</label>
              ${this._renderEditorTypeDropdown(this._newEditorType, this._handleNewEditorTypeChange.bind(this))}
            </div>
            <div class="form-actions">
              <button
                class="btn-small btn-primary"
                @click=${this._handleSaveNew}
                ?disabled=${this._isSaving}
              >
                Save
              </button>
              <button
                class="btn-small btn-secondary"
                @click=${this._handleCancelAdd}
                ?disabled=${this._isSaving}
              >
                Cancel
              </button>
            </div>
          </div>
        ` : ''}

        ${this._editorPaths.length === 0 && !this._isAdding ? html`
          <div class="empty-state">
            <p>No editor paths configured.</p>
            <p>Click "Add Path" to configure an editor for a specific folder.</p>
          </div>
        ` : html`
          <table class="editor-paths-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Editor Type</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${this._editorPaths.map((item) => {
    const isEditing = this._editingPath === item.path;
    return html`
                  <tr class="${item.source === 'org' ? 'inherited-row' : ''}">
                    <td>
                      ${isEditing ? html`
                        <div class="path-input-group">
                          <input
                            type="text"
                            class="path-input"
                            .value=${this._editPath}
                            @input=${this._handleEditPathChange}
                            ?disabled=${this._isSaving}
                          />
                          <button
                            class="btn-small btn-secondary"
                            @click=${() => this._handleOpenFolderPicker('edit')}
                            ?disabled=${this._isSaving}
                          >
                            Browse
                          </button>
                        </div>
                      ` : html`
                        <code>${item.path}</code>
                      `}
                    </td>
                    <td>
                      ${isEditing ? html`
                        ${this._renderEditorTypeDropdown(this._editEditorType, this._handleEditEditorTypeChange.bind(this))}
                      ` : html`
                        ${this._getEditorTypeLabel(item.editorUrl)}
                      `}
                    </td>
                    <td>
                      ${item.source === 'org' ? html`
                        <span class="badge badge-org">Org</span>
                      ` : html`
                        <span class="badge badge-site">Site</span>
                      `}
                    </td>
                    <td>
                      ${isEditing ? html`
                        <div class="action-buttons">
                          <button
                            class="btn-small btn-primary"
                            @click=${this._handleSaveEdit}
                            ?disabled=${this._isSaving}
                          >
                            Save
                          </button>
                          <button
                            class="btn-small btn-secondary"
                            @click=${this._handleCancelEdit}
                            ?disabled=${this._isSaving}
                          >
                            Cancel
                          </button>
                        </div>
                      ` : html`
                        <div class="action-buttons">
                          ${this.site
    ? this._renderSiteLevelActions(item)
    : this._renderOrgLevelActions(item)}
                        </div>
                      `}
                    </td>
                  </tr>
                `;
  })}
            </tbody>
          </table>
        `}
      </div>

      ${this._folderPickerOpen ? html`
        <folder-picker
          .open=${this._folderPickerOpen}
          .org=${this.org}
          .site=${this.site}
          title="Select Folder"
          @folder-selected=${this._handleFolderSelected}
          @close=${this._handleCloseFolderPicker}
        ></folder-picker>
      ` : ''}
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading editor configuration...');
    }

    if (this._error) {
      return this._renderError(this._error);
    }

    return html`
      <div class="section-container">
        ${this._renderExplainerCard()}
        ${this._renderPathsTable()}
      </div>
    `;
  }
}

customElements.define('editor-config-section', EditorConfigSection);
