// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle */
import { LitElement, html, nothing } from 'da-lit';

// Spectrum icons for inheritance indicators
const SPECTRUM_ICONS = {
  inherited: './icons/multi-site-manager-branch.svg',
  override: './icons/universal-editor-edit.svg',
};

// Get stylesheet for this component
const NX = 'https://da.live/nx2';
let componentStyles = null;
try {
  const [{ default: getStyle }, { loadStyle }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);

  // Load Shoelace styles and components
  await loadStyle(`${NX}/public/sl/styles.css`);
  await import(`${NX}/public/sl/components.js`);

  componentStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - component will render without styles
}

/**
 * Compact Settings Table Component
 * Renders configuration settings in a compact table format
 * - Table columns: Setting, Value/Input, Actions
 * - Input fields always visible with current values
 * - Save button enabled only when value changes
 * - Required/Optional badges
 * - Tooltips for help (hover over setting name)
 */
class CompactSettingsTable extends LitElement {
  static properties = {
    settings: { type: Array }, // Array of setting objects
    onSave: { type: Function },
    onRevert: { type: Function },
    isSaving: { type: Boolean },
    _editedValues: { state: true }, // Track edited values per setting key
  };

  constructor() {
    super();
    this.settings = [];
    this.onSave = null;
    this.onRevert = null;
    this.isSaving = false;
    this._editedValues = {}; // Track edited values per setting key
  }

  connectedCallback() {
    super.connectedCallback();
    if (componentStyles) {
      this.shadowRoot.adoptedStyleSheets = [componentStyles];
    }
  }

  // eslint-disable-next-line class-methods-use-this
  _renderIcon(iconKey, title = '') {
    const iconPath = SPECTRUM_ICONS[iconKey];
    if (!iconPath) return nothing;

    return html`<img
      class="inheritance-icon"
      src="${iconPath}"
      alt="${title}"
      title="${title}"
    />`;
  }

  _getEditedValue(key, originalValue) {
    // Return edited value if exists, otherwise return original value
    return this._editedValues[key] !== undefined ? this._editedValues[key] : (originalValue || '');
  }

  async _handleSave(setting) {
    if (this.onSave) {
      const editedValue = this._editedValues[setting.key];
      if (editedValue !== undefined) {
        await this.onSave(setting.key, editedValue);
        // Clear edited value after successful save
        delete this._editedValues[setting.key];
        this.requestUpdate();
      }
    }
  }

  async _handleRevert(setting) {
    if (this.onRevert) {
      await this.onRevert(setting.key);
      // Clear any edited value
      delete this._editedValues[setting.key];
      this.requestUpdate();
    }
  }

  _handleInputChange(e, key) {
    let newValue = e.target.value;
    // Convert sentinel value back to empty string
    if (newValue === '__unset__') {
      newValue = '';
    }
    this._editedValues[key] = newValue;
    this.requestUpdate();
  }

  _renderSettingRow(setting) {
    const canRevert = setting.source === 'site' && setting.inheritedValue !== undefined;
    const editedValue = this._editedValues[setting.key];
    const originalValue = setting.value;

    // Determine inheritance state
    const isInherited = !originalValue && setting.inheritedValue;
    const isSiteOverride = setting.source === 'site' && setting.inheritedValue;

    // Determine if field has no value (should show "Select...")
    const hasNoValue = (originalValue === null || originalValue === undefined || originalValue === '')
      && editedValue === undefined;

    // Current value to display
    const currentValue = editedValue !== undefined ? editedValue : (originalValue || '');

    // Check if value has actually changed from original
    // Note: We need to distinguish between null/undefined (no value) and '' (explicit empty)
    const normalizeValue = (val) => {
      if (val === null || val === undefined) return null;
      return typeof val === 'string' ? val.trim() : String(val).trim();
    };

    const editedNormalized = editedValue !== undefined ? normalizeValue(editedValue) : null;
    const originalNormalized = normalizeValue(originalValue);

    const hasChanged = editedNormalized !== null && editedNormalized !== originalNormalized;

    // Build tooltip text
    const tooltipText = setting.hint || 'No description available';

    return html`
      <div class="setting-row">
        <!-- Setting Name Column with Tooltip -->
        <div class="setting-name" title="${tooltipText}">
          <span class="setting-label">${setting.label}</span>
          ${setting.required ? html`
            <span class="badge badge-required">Required</span>
          ` : html`
            <span class="badge badge-optional">Optional</span>
          `}
          ${isInherited ? html`
            <span class="inheritance-indicator inherited">
              ${this._renderIcon('inherited', 'Inherited from organization')}
              <span class="indicator-text">Inherited from org</span>
            </span>
          ` : nothing}
          ${isSiteOverride ? html`
            <span class="inheritance-indicator override">
              ${this._renderIcon('override', 'Site override active')}
              <span class="indicator-text">Site override</span>
            </span>
          ` : nothing}
        </div>

        <!-- Value/Input Column (Always Visible) -->
        <div class="setting-value">
          ${setting.type === 'select' ? html`
            <select
              class="setting-input"
              .value=${hasNoValue ? '__unset__' : currentValue}
              @change=${(e) => this._handleInputChange(e, setting.key)}
            >
              ${setting.defaultLabel && hasNoValue ? html`
                <option value="__unset__" selected>${setting.defaultLabel}</option>
              ` : nothing}
              ${setting.options?.map((opt) => html`
                <option value="${opt.value}" ?selected=${currentValue === opt.value && !hasNoValue}>
                  ${opt.label}
                </option>
              `)}
            </select>
          ` : html`
            <sl-input
              type="text"
              size="medium"
              .value=${currentValue}
              @sl-input=${(e) => this._handleInputChange(e, setting.key)}
              @sl-change=${(e) => this._handleInputChange(e, setting.key)}
              @input=${(e) => this._handleInputChange(e, setting.key)}
              placeholder="${setting.placeholder || `e.g. ${setting.hint || ''}`}"
            ></sl-input>
          `}
          ${isSiteOverride && setting.inheritedValue ? html`
            <div class="org-default-value">
              <span class="org-default-label">Org default:</span>
              <span class="org-default-text">${setting.inheritedValue}</span>
            </div>
          ` : nothing}
        </div>

        <!-- Actions Column -->
        <div class="setting-actions">
          <sl-button
            variant="primary"
            size="small"
            @click=${() => this._handleSave(setting)}
            ?disabled=${this.isSaving || !hasChanged}
          >
            ${this.isSaving ? 'Saving...' : 'Save'}
          </sl-button>
          ${canRevert ? html`
            <sl-button
              size="small"
              @click=${() => this._handleRevert(setting)}
              ?disabled=${this.isSaving}
              title="Revert to organization default"
            >
              Revert
            </sl-button>
          ` : nothing}
        </div>
      </div>
    `;
  }

  render() {
    if (!this.settings || this.settings.length === 0) {
      return html`
        <div class="settings-empty">
          <p>No settings available</p>
        </div>
      `;
    }

    return html`
      <div class="settings-table">
        <!-- Header Row -->
        <div class="settings-header">
          <div class="header-cell">Configuration</div>
        </div>

        <!-- Settings Rows -->
        <div class="settings-body">
          ${this.settings.map((setting) => this._renderSettingRow(setting))}
        </div>
      </div>
    `;
  }
}

customElements.define('compact-settings-table', CompactSettingsTable);
export default CompactSettingsTable;
