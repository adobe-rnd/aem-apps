// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import { parseGitHubURL } from '../../shared/api/github-api.js';
import GitHubAPI from '../../shared/utils/github-api.js';
import TokenStorage from '../../shared/utils/token-storage.js';
import { setupLibrary, checkLibraryExists, fetchExistingBlocks } from '../../shared/operations/library.js';

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
 * Blocks Section - Manages block discovery, selection, and library setup
 */
class BlocksSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    _githubUrl: { state: true },
    _githubToken: { state: true },
    _repositoryValidated: { state: true },
    _validating: { state: true },
    _needsToken: { state: true },
    _discovering: { state: true },
    _blocks: { state: true },
    _selectedBlocks: { state: true },
    _blocksDiscovered: { state: true },
    _libraryExists: { state: true },
    _pageSelections: { state: true },
    _showPagePicker: { state: true },
    _processing: { state: true },
    _processStep: { state: true },
    _processProgress: { state: true },
    _processResults: { state: true },
    _mode: { state: true },
  };

  constructor() {
    super();
    this._githubUrl = '';
    this._githubToken = TokenStorage.get() || '';
    this._repositoryValidated = false;
    this._validating = false;
    this._needsToken = false;
    this._discovering = false;
    this._blocks = [];
    this._selectedBlocks = new Set();
    this._blocksDiscovered = false;
    this._libraryExists = false;
    this._pageSelections = {};
    this._showPagePicker = false;
    this._processing = false;
    this._processStep = '';
    this._processProgress = {};
    this._processResults = null;
    this._mode = 'setup'; // 'setup' or 'update'
  }

  _getStylesheets() {
    return sectionStyles ? [sectionStyles] : [];
  }

  async loadData() {
    // Check if library exists for this site
    if (this.org && this.site) {
      try {
        const libraryCheck = await checkLibraryExists(this.org, this.site);
        this._libraryExists = libraryCheck.exists;
      } catch {
        // Library check failed - will default to false
      }
    }
  }

  // GitHub Repository Validation
  async _handleGitHubUrlChange(e) {
    this._githubUrl = e.target.value.trim();

    this._repositoryValidated = false;
    this._needsToken = false;
    this._blocksDiscovered = false;
    this._blocks = [];
    this._selectedBlocks.clear();
    this._clearError();
  }

  async _validateRepository() {
    this._clearError();
    this._validating = true;

    try {
      const parsed = parseGitHubURL(this._githubUrl);
      if (!parsed.org || !parsed.repo) {
        this._setError('Please enter a valid GitHub repository URL');
        this._validating = false;
        return;
      }

      const api = new GitHubAPI(parsed.org, parsed.repo, 'main', this._githubToken);
      const result = await api.validateAccess();

      if (!result.valid) {
        if (result.error === 'rate_limit') {
          this._needsToken = true;
          this._setError(`GitHub API rate limit exceeded (resets at ${result.resetTime}). Please add a GitHub token to continue.`);
          this._validating = false;
          return;
        }

        if (result.error === 'not_found') {
          this._setError('Repository not found. Please check the URL and try again.');
          this._validating = false;
          return;
        }

        if (result.error === 'private' && result.needsToken) {
          this._needsToken = true;
          this._setError('Unable to access repository. If this is a private repository, please enter a GitHub token below.');
          this._validating = false;
          return;
        }

        this._setError(result.error === 'private' ? 'Unable to access repository with provided token.' : result.error);
        this._validating = false;
        return;
      }

      this._repositoryValidated = true;
      this._needsToken = false;
      this._validating = false;

      // Track validation success
      this._trackAction('blocks-repo-validated', { repo: this._githubUrl });

      // Auto-discover blocks
      await this._discoverBlocks(parsed.org, parsed.repo);
    } catch (error) {
      this._setError(`Validation failed: ${error.message}`);
      this._validating = false;
    }
  }

  async _handleValidateWithToken(e) {
    e.preventDefault();
    const tokenInput = this.shadowRoot.querySelector('#github-token');
    const saveCheckbox = this.shadowRoot.querySelector('#save-token');
    const token = tokenInput?.value.trim();

    if (!token) {
      this._setError('Please enter a GitHub token');
      return;
    }

    if (saveCheckbox?.checked) {
      TokenStorage.set(token);
    }

    this._githubToken = token;
    await this._validateRepository();
  }

  _handleClearToken() {
    TokenStorage.clear();
    this._githubToken = '';
    this._setError(null);
    this.requestUpdate();
  }

  // Block Discovery
  async _discoverBlocks(org, repo) {
    this._discovering = true;
    this._clearError();

    try {
      const api = new GitHubAPI(org, repo, 'main', this._githubToken);
      const blocks = await api.discoverBlocks();

      // Filter out auto-blocks
      const excludedBlocks = new Set(['header', 'footer', 'fragment']);
      const filteredBlocks = blocks.filter((block) => !excludedBlocks.has(block.name));

      // Check which blocks are new
      const existingBlocksData = await fetchExistingBlocks(this.org, this.site);
      const existingBlockNames = new Set(existingBlocksData.map((b) => {
        const pathParts = b.path.split('/');
        return pathParts[pathParts.length - 1];
      }));

      this._blocks = filteredBlocks.map((block) => ({
        ...block,
        isNew: !existingBlockNames.has(block.name),
      }));

      this._selectedBlocks = new Set(filteredBlocks.map((b) => b.name));
      this._blocksDiscovered = true;
      this._discovering = false;

      // Track discovery
      this._trackAction('blocks-discovered', {
        count: filteredBlocks.length,
        newCount: this._blocks.filter((b) => b.isNew).length,
      });
    } catch (error) {
      this._setError(`Block discovery failed: ${error.message}`);
      this._discovering = false;
    }
  }

  async _loadExistingBlocks() {
    if (!this.org || !this.site) {
      this._setError('Organization and site are required');
      return;
    }

    this._discovering = true;
    this._clearError();

    try {
      const blocks = await fetchExistingBlocks(this.org, this.site);

      if (blocks.length === 0) {
        this._setError('No library found at this location. Please run "Library Setup" first to create the library.');
        this._discovering = false;
        return;
      }

      this._blocks = blocks.map((block) => ({
        ...block,
        isNew: false,
      }));
      this._selectedBlocks = new Set(blocks.map((b) => b.name));
      this._blocksDiscovered = true;
      this._mode = 'update';
      this._discovering = false;

      // Track load
      this._trackAction('blocks-loaded', { count: blocks.length });
    } catch (error) {
      this._setError(`Failed to load blocks: ${error.message}`);
      this._discovering = false;
    }
  }

  // Block Selection
  _handleBlockToggle(e) {
    const { blockName } = e.target.dataset;
    if (e.target.checked) {
      this._selectedBlocks.add(blockName);
    } else {
      this._selectedBlocks.delete(blockName);
    }
    this.requestUpdate();
  }

  _toggleAllBlocks() {
    if (this._selectedBlocks.size === this._blocks.length) {
      this._selectedBlocks.clear();
    } else {
      this._blocks.forEach((block) => this._selectedBlocks.add(block.name));
    }
    this.requestUpdate();
  }

  _selectNewBlocksOnly() {
    this._selectedBlocks.clear();
    this._blocks
      .filter((block) => block.isNew)
      .forEach((block) => this._selectedBlocks.add(block.name));
    this.requestUpdate();
  }

  // Page Selection (simplified - full page picker to be created separately)
  _openPagePicker() {
    this._showPagePicker = true;
    // TODO: Implement full page picker component
  }

  // Processing
  async _startProcessing() {
    if (this._selectedBlocks.size === 0) {
      this._setError('Please select at least one block');
      return;
    }

    this._processing = true;
    this._processResults = null;
    this._clearError();

    const blockNames = Array.from(this._selectedBlocks);
    const sitesWithPages = this._convertPageSelectionsToSites();

    // Track processing start
    this._trackAction('blocks-processing-start', {
      blockCount: blockNames.length,
      mode: this._mode,
      hasPages: sitesWithPages.length > 0,
    });

    const onProgress = (update) => {
      this._processStep = update.step;
      this._processProgress = update;
      this.requestUpdate();
    };

    try {
      const parsed = parseGitHubURL(this._githubUrl);
      const api = this._repositoryValidated
        ? new GitHubAPI(parsed.org, parsed.repo, 'main', this._githubToken)
        : null;

      const results = await setupLibrary({
        org: this.org,
        site: this.site,
        blockNames,
        sitesWithPages,
        onProgress,
        skipSiteConfig: this._mode === 'update',
        githubApi: api,
      });

      if (results.success) {
        this._processResults = results;
        this._trackAction('blocks-processing-complete', {
          blockCount: blockNames.length,
          mode: this._mode,
        });
      } else {
        this._setError(`Processing failed: ${results.error}`);
      }
    } catch (error) {
      this._setError(`Processing failed: ${error.message}`);
    } finally {
      this._processing = false;
    }
  }

  _convertPageSelectionsToSites() {
    const sitesMap = new Map();

    Object.entries(this._pageSelections).forEach(([site, paths]) => {
      if (paths.size > 0) {
        sitesMap.set(site, {
          site,
          pages: Array.from(paths).map((path) => ({ path })),
        });
      }
    });

    return Array.from(sitesMap.values());
  }

  _resetForm() {
    this._githubUrl = '';
    this._repositoryValidated = false;
    this._blocksDiscovered = false;
    this._blocks = [];
    this._selectedBlocks.clear();
    this._pageSelections = {};
    this._processing = false;
    this._processResults = null;
    this._mode = 'setup';
    this._clearError();
  }

  // Render Methods
  _renderGitHubSection() {
    if (this._mode === 'update') {
      return nothing;
    }

    return html`
      <div class="section-card">
        <h2>Repository</h2>
        <div class="form-row">
          <sl-input
            id="github-url"
            type="url"
            placeholder="https://github.com/{owner}/{repo}"
            value=${this._githubUrl}
            ?readonly=${this._repositoryValidated}
            @sl-input=${this._handleGitHubUrlChange}
          ></sl-input>
          ${!this._repositoryValidated ? html`
            <sl-button
              variant="primary"
              ?loading=${this._validating}
              @click=${this._validateRepository}
            >
              Validate
            </sl-button>
          ` : nothing}
        </div>

        ${this._needsToken ? html`
          <div class="token-section">
            <h3>GitHub Token Required</h3>
            <form @submit=${this._handleValidateWithToken}>
              <div class="form-row">
                <sl-input
                  id="github-token"
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  autocomplete="off"
                ></sl-input>
              </div>
              <div class="form-row">
                <label>
                  <input type="checkbox" id="save-token" checked />
                  Save for future use
                </label>
              </div>
              <div class="form-row">
                <sl-button type="submit" variant="primary">
                  Validate Repository
                </sl-button>
                ${TokenStorage.get() ? html`
                  <sl-button @click=${this._handleClearToken}>
                    Clear Saved Token
                  </sl-button>
                ` : nothing}
              </div>
            </form>
            <div class="token-instructions">
              <h4>Token Permissions</h4>
              <p>We only READ code (never write). Required:</p>
              <ul>
                <li><strong>Fine-Grained Token</strong> (recommended): Repository → Contents → Read-only</li>
                <li><strong>Classic Token</strong>: repo scope (private repos only)</li>
              </ul>
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                Create Fine-Grained Token →
              </a>
            </div>
          </div>
        ` : nothing}
      </div>
    `;
  }

  _renderBlocksList() {
    if (!this._blocksDiscovered || this._blocks.length === 0) {
      return nothing;
    }

    const selectedCount = this._selectedBlocks.size;
    const totalCount = this._blocks.length;
    const newCount = this._blocks.filter((b) => b.isNew).length;

    return html`
      <div class="section-card">
        <div class="blocks-header">
          <h2>
            Select Blocks
            <span class="heading-annotation">
              ${selectedCount} of ${totalCount} selected
              ${newCount > 0 ? ` (${newCount} new)` : ''}
            </span>
          </h2>
          <div class="blocks-actions">
            <sl-button @click=${this._toggleAllBlocks}>
              ${selectedCount === totalCount ? 'Deselect All' : 'Select All'}
            </sl-button>
            ${newCount > 0 ? html`
              <sl-button @click=${this._selectNewBlocksOnly}>
                Select New Only
              </sl-button>
            ` : nothing}
          </div>
        </div>

        <ul class="blocks-list">
          ${this._blocks.map((block) => html`
            <li class="block-item ${this._selectedBlocks.has(block.name) ? 'selected' : ''}">
              <label>
                <input
                  type="checkbox"
                  data-block-name=${block.name}
                  ?checked=${this._selectedBlocks.has(block.name)}
                  @change=${this._handleBlockToggle}
                />
                <span class="block-name">${block.name}</span>
                ${block.isNew ? html`<span class="block-badge new">New</span>` : nothing}
              </label>
            </li>
          `)}
        </ul>
      </div>
    `;
  }

  _renderPageSelection() {
    if (!this._blocksDiscovered || this._selectedBlocks.size === 0) {
      return nothing;
    }

    return html`
      <div class="section-card">
        <h2>
          Sample Pages
          <span class="heading-annotation">${this._mode === 'update' ? '' : '(Optional)'}</span>
        </h2>
        <p class="section-description">
          ${this._mode === 'update'
    ? 'Select pages to extract real block examples from. Only blocks found in these pages will be updated.'
    : 'Select pages to extract real block examples from. Skip to use placeholder content.'}
        </p>

        <sl-button @click=${this._openPagePicker}>
          Select Pages (${Object.values(this._pageSelections).reduce((sum, pages) => sum + pages.size, 0)})
        </sl-button>
      </div>
    `;
  }

  _renderProcessButton() {
    if (!this._blocksDiscovered || this._selectedBlocks.size === 0) {
      return nothing;
    }

    return html`
      <div class="section-actions">
        <sl-button
          variant="primary"
          size="large"
          ?loading=${this._processing}
          ?disabled=${this._processing}
          @click=${this._startProcessing}
        >
          ${this._mode === 'update' ? 'Update Library' : 'Create Library'}
        </sl-button>
      </div>
    `;
  }

  _renderProcessProgress() {
    if (!this._processing && !this._processResults) {
      return nothing;
    }

    if (this._processing) {
      return html`
        <div class="section-card progress-card">
          <h3>Processing...</h3>
          <div class="progress-step">
            <strong>${this._processStep}</strong>
            ${this._processProgress.message ? html`<p>${this._processProgress.message}</p>` : nothing}
          </div>
        </div>
      `;
    }

    if (this._processResults?.success) {
      return html`
        <div class="section-card success-card">
          <h3>✓ Processing Complete</h3>
          <p>Library has been ${this._mode === 'update' ? 'updated' : 'created'} successfully!</p>
          <div class="process-results">
            ${this._processResults.steps.map((step) => html`
              <div class="result-step">
                <span>✓ ${step.name}</span>
              </div>
            `)}
          </div>
          <sl-button @click=${this._resetForm}>
            Process More Blocks
          </sl-button>
        </div>
      `;
    }

    return nothing;
  }

  _renderModeSelector() {
    return html`
      <div class="mode-selector">
        <sl-button
          variant=${this._mode === 'setup' ? 'primary' : 'default'}
          @click=${() => { this._mode = 'setup'; this._resetForm(); }}
        >
          Library Setup
        </sl-button>
        <sl-button
          variant=${this._mode === 'update' ? 'primary' : 'default'}
          @click=${() => { this._mode = 'update'; this._resetForm(); }}
        >
          Update Existing
        </sl-button>
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading blocks section...');
    }

    if (this._error) {
      return html`
        <div class="section-container">
          ${this._renderError(this._error, () => this.loadData())}
        </div>
      `;
    }

    return html`
      <div class="section-container">
        <div class="section-header">
          <h1>Blocks</h1>
          <p class="section-description">
            Discover blocks from your GitHub repository and add them to your DA.live library.
          </p>
        </div>

        ${this._renderModeSelector()}
        ${this._renderGitHubSection()}

        ${this._mode === 'update' && !this._blocksDiscovered ? html`
          <div class="section-card">
            <sl-button variant="primary" @click=${this._loadExistingBlocks} ?loading=${this._discovering}>
              Load Existing Blocks
            </sl-button>
          </div>
        ` : nothing}

        ${this._renderBlocksList()}
        ${this._renderPageSelection()}
        ${this._renderProcessProgress()}
        ${this._renderProcessButton()}
      </div>
    `;
  }
}

customElements.define('blocks-section', BlocksSection);
export default BlocksSection;
