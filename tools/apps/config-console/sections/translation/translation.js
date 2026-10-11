// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  fetchInheritedTranslate,
  updateSiteTranslate,
  deleteSiteTranslate,
  fetchAllTranslateSheets,
  updateTranslateSheet,
} from '../../shared/api/config-api.js';
import { CONFIG_KEYS } from '../../shared/constants.js';
import '../../components/explainer-info-card.js';
import '../../components/compact-settings-table.js';

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
    _sheets: { state: true },
    _editingSheet: { state: true },
    _editingRowIndex: { state: true },
    _editedRow: { state: true },
  };

  constructor() {
    super();
    this._configs = {};
    this._editingKey = null;
    this._editedValue = '';
    this._isSaving = false;
    this._saveMessage = null;
    this._sheets = {
      languages: [],
      customDocRules: [],
      dntContentRules: [],
      dntSheetRules: [],
    };
    this._editingSheet = null;
    this._editingRowIndex = null;
    this._editedRow = null;
  }

  _getStylesheets() {
    return [commonStyles, sectionStyles].filter(Boolean);
  }

  async loadData() {
    if (!this.org) {
      this._setError('Organization is required');
      return;
    }

    if (!this.site) {
      this._setError('Site is required for translation configuration');
      return;
    }

    try {
      this._setLoading(true);

      const configKeys = [
        {
          key: CONFIG_KEYS.SYNC_CONFLICT_BEHAVIOR,
          label: 'Sync Conflict Behavior',
          hint: 'How to handle old content when it is pulled into the send for translation folder',
          type: 'text',
        },
        {
          key: CONFIG_KEYS.TRANSLATE_CONFLICT_BEHAVIOR,
          label: 'Translate Conflict Behavior',
          hint: 'How to handle old content when new content returns from translation',
          type: 'text',
        },
        {
          key: CONFIG_KEYS.ROLLOUT_CONFLICT_BEHAVIOR,
          label: 'Rollout Conflict Behavior',
          hint: 'How to handle old content when new content gets rolled out to the locale',
          type: 'text',
        },
        {
          key: CONFIG_KEYS.COPY_CONFLICT_BEHAVIOR,
          label: 'Copy Conflict Behavior',
          hint: 'How to handle when source content is copied into a region',
          type: 'text',
        },
      ];

      const configs = {};
      await Promise.all(
        configKeys.map(async ({
          key, label, hint, type,
        }) => {
          const config = await fetchInheritedTranslate(
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
          };
        }),
      );

      this._configs = configs;

      const sheets = await fetchAllTranslateSheets(this.org, this.site, this.token);
      if (sheets) {
        this._sheets = sheets;
      }

      this._setLoading(false);

      this._trackAction('translation-config-loaded', {
        hasConfigs: Object.keys(configs).length > 0,
      });
    } catch (error) {
      this._setError(`Failed to load translation configuration: ${error.message}`);
    }
  }

  _validateValue() {
    // Allow any text value for translation config
    return { valid: true };
  }

  _handleEdit(key) {
    this._editingKey = key;
    this._editedValue = this._configs[key]?.value || '';
    this._saveMessage = null;
    this.requestUpdate();
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
      // Translation is always at site level
      if (!this.site) {
        this._saveMessage = { type: 'error', text: 'Site is required for translation configuration' };
        this._isSaving = false;
        return;
      }

      const result = await updateSiteTranslate(this.org, this.site, key, trimmedValue, this.token);

      if (result.success) {
        this._configs[key].value = trimmedValue;
        this._configs[key].source = 'site';
        this._editingKey = null;
        this._editedValue = '';
        this._saveMessage = { type: 'success', text: `${this._configs[key].label} updated successfully` };

        this._trackAction('translation-config-updated', {
          key,
        });

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
      const result = await deleteSiteTranslate(
        this.org,
        this.site,
        key,
        this.token,
      );

      if (result.success) {
        this._configs[key].value = null;
        this._configs[key].source = null;
        this._editingKey = null;
        this._editedValue = '';
        this._saveMessage = { type: 'success', text: `${this._configs[key].label} removed` };

        this._trackAction('translation-config-reverted', {
          key,
        });

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

  _handleSheetAddRow(sheetName, template) {
    this._editingSheet = sheetName;
    this._editingRowIndex = -1; // -1 means adding new
    this._editedRow = { ...template };
  }

  _handleSheetEditRow(sheetName, index, row) {
    this._editingSheet = sheetName;
    this._editingRowIndex = index;
    this._editedRow = { ...row };
  }

  _handleSheetCancelEdit() {
    this._editingSheet = null;
    this._editingRowIndex = null;
    this._editedRow = null;
  }

  async _handleSheetSaveRow(sheetKey, sheetName) {
    if (this._isSaving) return;

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const updatedData = [...this._sheets[sheetKey]];

      if (this._editingRowIndex === -1) {
        updatedData.push(this._editedRow);
      } else {
        updatedData[this._editingRowIndex] = this._editedRow;
      }

      const result = await updateTranslateSheet(
        this.org,
        this.site,
        sheetName,
        updatedData,
        this.token,
      );

      if (result.success) {
        this._sheets[sheetKey] = updatedData;
        this._editingSheet = null;
        this._editingRowIndex = null;
        this._editedRow = null;
        this._saveMessage = { type: 'success', text: 'Sheet updated successfully' };

        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to save sheet' };
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error saving: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  async _handleSheetDeleteRow(sheetKey, sheetName, index) {
    if (this._isSaving) return;
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!confirm('Are you sure you want to delete this entry?')) return;

    this._isSaving = true;
    this._saveMessage = null;

    try {
      const updatedData = this._sheets[sheetKey].filter((_, i) => i !== index);

      const result = await updateTranslateSheet(
        this.org,
        this.site,
        sheetName,
        updatedData,
        this.token,
      );

      if (result.success) {
        this._sheets[sheetKey] = updatedData;
        this._saveMessage = { type: 'success', text: 'Entry deleted successfully' };

        setTimeout(() => {
          this._saveMessage = null;
          this.requestUpdate();
        }, 3000);
      } else {
        this._saveMessage = { type: 'error', text: result.error || 'Failed to delete entry' };
      }
    } catch (error) {
      this._saveMessage = { type: 'error', text: `Error deleting: ${error.message}` };
    } finally {
      this._isSaving = false;
    }
  }

  _handleSheetFieldChange(field, value) {
    this._editedRow = {
      ...this._editedRow,
      [field]: value,
    };
  }

  _prepareSettings() {
    const settingsConfig = [
      {
        key: CONFIG_KEYS.SYNC_CONFLICT_BEHAVIOR,
        required: false,
        helpUrl: 'https://docs.da.live/administrators/guides/setup-translation',
      },
      {
        key: CONFIG_KEYS.TRANSLATE_CONFLICT_BEHAVIOR,
        required: false,
        helpUrl: 'https://docs.da.live/administrators/guides/setup-translation',
      },
      {
        key: CONFIG_KEYS.ROLLOUT_CONFLICT_BEHAVIOR,
        required: false,
        helpUrl: 'https://docs.da.live/administrators/guides/setup-translation',
      },
      {
        key: CONFIG_KEYS.COPY_CONFLICT_BEHAVIOR,
        required: false,
        helpUrl: 'https://docs.da.live/administrators/guides/setup-translation',
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
        hint: config.hint,
        helpUrl,
      };
    }).filter(Boolean);
  }

  _renderExplainerCard() {
    const hasAnyValue = Object.values(this._configs).some((c) => c.value);
    const isConfigured = hasAnyValue;

    const status = isConfigured ? 'configured' : 'not-configured';
    const statusLabel = isConfigured ? 'Configured' : 'Not Configured';

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
      <div class="settings-card">
        <h2 class="settings-card-title">Rollout Config</h2>
        <compact-settings-table
          .settings=${settings}
          .onSave=${(key, value) => this._handleTableSave(key, value)}
          .onRevert=${(key) => this._handleRevert(key)}
          .isSaving=${this._isSaving}
        ></compact-settings-table>
      </div>
    `;
  }

  _renderEditableSheet(title, sheetKey, sheetName, data, columns, template) {
    const isEditing = this._editingSheet === sheetName;

    return html`
      <div class="settings-card">
        <div class="card-header">
          <h2 class="settings-card-title">${title}</h2>
          <button
            class="btn-small btn-primary"
            @click=${() => this._handleSheetAddRow(sheetName, template)}
            ?disabled=${this._isSaving || isEditing}
          >Add Entry</button>
        </div>

        ${data.length === 0 && !isEditing ? html`
          <p class="empty-state">No entries configured. Click "Add Entry" to get started.</p>
        ` : html`
          <div class="table-wrapper">
            <table class="data-table editable">
              <thead>
                <tr>
                  ${columns.map((col) => html`<th>${col}</th>`)}
                  <th class="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${data.map((row, index) => {
    const editingThis = isEditing && this._editingRowIndex === index;
    if (editingThis) {
      return html`
                      <tr class="editing-row">
                        ${columns.map((col) => html`
                          <td>
                            <input
                              type="text"
                              class="inline-input"
                              .value=${this._editedRow[col] || ''}
                              @input=${(e) => this._handleSheetFieldChange(col, e.target.value)}
                              ?disabled=${this._isSaving}
                            />
                          </td>
                        `)}
                        <td class="actions-col">
                          <button
                            class="btn-small btn-primary"
                            @click=${() => this._handleSheetSaveRow(sheetKey, sheetName)}
                            ?disabled=${this._isSaving}
                          >Save</button>
                          <button
                            class="btn-small btn-secondary"
                            @click=${() => this._handleSheetCancelEdit()}
                            ?disabled=${this._isSaving}
                          >Cancel</button>
                        </td>
                      </tr>
                    `;
    }
    return html`
                    <tr>
                      ${columns.map((col) => html`<td>${row[col] || ''}</td>`)}
                      <td class="actions-col">
                        <button
                          class="btn-small btn-secondary"
                          @click=${() => this._handleSheetEditRow(sheetName, index, row)}
                          ?disabled=${this._isSaving || isEditing}
                        >Edit</button>
                        <button
                          class="btn-small btn-tertiary"
                          @click=${() => this._handleSheetDeleteRow(sheetKey, sheetName, index)}
                          ?disabled=${this._isSaving || isEditing}
                        >Delete</button>
                      </td>
                    </tr>
                  `;
  })}
                ${isEditing && this._editingRowIndex === -1 ? html`
                  <tr class="editing-row">
                    ${columns.map((col) => html`
                      <td>
                        <input
                          type="text"
                          class="inline-input"
                          .value=${this._editedRow[col] || ''}
                          @input=${(e) => this._handleSheetFieldChange(col, e.target.value)}
                          ?disabled=${this._isSaving}
                          placeholder=${col}
                        />
                      </td>
                    `)}
                    <td class="actions-col">
                      <button
                        class="btn-small btn-primary"
                        @click=${() => this._handleSheetSaveRow(sheetKey, sheetName)}
                        ?disabled=${this._isSaving}
                      >Save</button>
                      <button
                        class="btn-small btn-secondary"
                        @click=${() => this._handleSheetCancelEdit()}
                        ?disabled=${this._isSaving}
                      >Cancel</button>
                    </td>
                  </tr>
                ` : ''}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  _renderAllSheets() {
    return html`
      ${this._renderEditableSheet(
    'Languages',
    'languages',
    'languages',
    this._sheets.languages,
    ['name', 'code', 'translate type', 'location', 'locales', 'actions'],
    {
      name: '',
      code: '',
      'translate type': '',
      location: '',
      locales: '',
      actions: '',
    },
  )}

      ${this._renderEditableSheet(
    'Custom Document Rules',
    'customDocRules',
    'custom-doc-rules',
    this._sheets.customDocRules,
    ['block', 'rule'],
    { block: '', rule: '' },
  )}

      ${this._renderEditableSheet(
    'Do Not Translate Content Rules',
    'dntContentRules',
    'dnt-content-rules',
    this._sheets.dntContentRules,
    ['content'],
    { content: '' },
  )}

      ${this._renderEditableSheet(
    'Do Not Translate Sheet Rules',
    'dntSheetRules',
    'dnt-sheet-rules',
    this._sheets.dntSheetRules,
    ['pattern', 'action'],
    { pattern: '', action: '' },
  )}
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

        ${this._renderAllSheets()}
      </div>
    `;
  }
}

customElements.define('translation-section', TranslationSection);
