// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties and methods
/* eslint-disable import/no-unresolved, no-underscore-dangle */
import { LitElement, html } from 'da-lit';

const NX = 'https://da.live/nx2';
let modalStyles = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  modalStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load - modal will render without styles
}

/**
 * Shared Library Setup Modal Component
 * Used by Blocks, Templates, Icons, and Placeholders sections
 */
class LibrarySetupModal extends LitElement {
  static properties = {
    open: { type: Boolean },
    libraryType: { type: String }, // 'Blocks', 'Templates', 'Icons', 'Placeholders'
    options: { type: Object }, // { suggested, options, detected }
    selectedPath: { type: String },
    customPath: { type: String },
  };

  constructor() {
    super();
    this.open = false;
    this.libraryType = '';
    this.options = null;
    this.selectedPath = '';
    this.customPath = '';
  }

  connectedCallback() {
    super.connectedCallback();
    if (modalStyles) {
      this.shadowRoot.adoptedStyleSheets = [modalStyles];
    }
  }

  _handleOverlayClick() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  _handlePathSelection(path) {
    this.selectedPath = path;
    this.customPath = '';
    this.requestUpdate();
  }

  _handleCustomPathInput(e) {
    this.customPath = e.target.value;
    this.requestUpdate();
  }

  _handleConfirm() {
    const pathToUse = this.customPath || this.selectedPath;
    this.dispatchEvent(new CustomEvent('confirm', {
      detail: { path: pathToUse },
    }));
  }

  _handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  render() {
    if (!this.open || !this.options) {
      return html``;
    }

    return html`
      <div class="modal-overlay" @click=${this._handleOverlayClick}>
        <div class="modal-dialog" @click=${(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2>Configure ${this.libraryType} Library Location</h2>
            <button class="modal-close" @click=${this._handleCancel}>×</button>
          </div>
          <div class="modal-body">
            <p>Choose where you want to store ${this.libraryType.toLowerCase()} for this site:</p>
            ${this.options.detected ? html`
              <p class="library-setup-note">
                We detected another library configured at <code>${this.options.suggested}</code>.
                We recommend using the same location for ${this.libraryType.toLowerCase()}.
              </p>
            ` : ''}

            <div class="library-setup-options">
              ${this.options.options.map((option) => {
    const isSelected = this.selectedPath === option;
    // Show "(recommended)" only on the detected/suggested path
    const label = this.options.detected && option === this.options.suggested
      ? `${option} (recommended)`
      : option;

    return html`
                  <label class="library-option ${isSelected ? 'selected' : ''}">
                    <input
                      type="radio"
                      name="library-path"
                      .checked=${isSelected}
                      @change=${() => this._handlePathSelection(option)}
                    />
                    <div class="library-option-content">
                      <div class="library-option-label">${label}</div>
                      <div class="library-option-path">/${option}/${this.libraryType.toLowerCase()}.json</div>
                    </div>
                  </label>
                `;
  })}

              <label class="library-option ${this.customPath ? 'selected' : ''}">
                <input
                  type="radio"
                  name="library-path"
                  .checked=${!!this.customPath}
                  @change=${() => { this.selectedPath = ''; this.requestUpdate(); }}
                />
                <div class="library-option-content">
                  <div class="library-option-label">Custom path</div>
                  <input
                    type="text"
                    class="library-custom-input"
                    placeholder="e.g., content/library"
                    .value=${this.customPath}
                    @input=${this._handleCustomPathInput}
                    @focus=${() => { this.selectedPath = ''; this.requestUpdate(); }}
                  />
                </div>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-secondary" @click=${this._handleCancel}>Cancel</button>
            <button
              class="btn-primary"
              @click=${this._handleConfirm}
              ?disabled=${!this.selectedPath && !this.customPath}
            >Save</button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('library-setup-modal', LibrarySetupModal);
export default LibrarySetupModal;
