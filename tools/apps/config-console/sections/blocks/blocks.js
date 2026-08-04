// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import { parseGitHubURL } from '../../shared/api/github-api.js';
import GitHubAPI from '../../shared/utils/github-api.js';
import TokenStorage from '../../shared/utils/token-storage.js';
import { getLibraryPath, registerLibraryType } from '../../shared/api/config-api.js';
import { LibrarySetupHandlerMixin, LibrarySetupHandlerProperties } from '../../shared/mixins/library-setup-handler.js';
import '../../components/explainer-info-card.js';
import '../../shared/components/library-setup-modal.js';
import '../../shared/components/page-picker.js';

// Get stylesheet for this section
const NX = 'https://da.live/nx2';
let sectionStyles = null;

try {
  const [{ default: getStyle }, { loadStyle }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);

  // Load Shoelace styles and components
  await loadStyle(`${NX}/public/sl/styles.css`);
  await import(`${NX}/public/sl/components.js`);

  // Get section-specific stylesheet
  sectionStyles = await getStyle(import.meta.url);
} catch (err) {
  // Styles failed to load
}

/**
 * Blocks Section - Simplified UX
 * Connect GitHub repo → Select blocks → Add samples → Manage library
 */
class BlocksSection extends LibrarySetupHandlerMixin(BaseSectionElement) {
  static properties = {
    ...BaseSectionElement.properties,
    ...LibrarySetupHandlerProperties,
    _importMode: { state: true }, // 'content' | 'github'
    _githubUrl: { state: true },
    _githubToken: { state: true },
    _validating: { state: true },
    _needsToken: { state: true },
    _repoConnected: { state: true },
    _discovering: { state: true },
    _scanningContent: { state: true },
    _scannedPages: { state: true },
    _scanMessage: { state: true },
    _blocks: { state: true },
    _selectedBlocks: { state: true },
    _showSamplePages: { state: true },
    _samplePages: { state: true },
    _libraryExists: { state: true },
    _existingBlocks: { state: true },
    _processing: { state: true },
    _processStep: { state: true },
    _infoDismissed: { state: true },
    _showPagePicker: { state: true },
    _libraryPath: { state: true },
    _customLibraryPath: { state: true },
    _blocksWithUpdates: { state: true },
    _checkingUpdates: { state: true },
    _lastChecked: { state: true },
    _blockSearchQuery: { state: true },
    _editingExamplesBlock: { state: true },
  };

  constructor() {
    super();
    this._importMode = 'content'; // Default to content mode
    this._githubUrl = '';
    this._githubToken = TokenStorage.get() || '';
    this._validating = false;
    this._needsToken = false;
    this._repoConnected = false;
    this._discovering = false;
    this._scanningContent = false;
    this._scannedPages = [];
    this._scanMessage = null;
    this._blocks = [];
    this._selectedBlocks = new Set();
    this._showSamplePages = false;
    this._samplePages = [];
    this._libraryExists = false;
    this._existingBlocks = [];
    this._processing = false;
    this._processStep = '';
    this._infoDismissed = localStorage.getItem('blocks-info-dismissed') === 'true';
    this._showPagePicker = false;
    this._libraryPath = '/library';
    this._customLibraryPath = false;
    this._blocksWithUpdates = new Map();
    this._checkingUpdates = false;
    this._lastChecked = null;
    this._blockSearchQuery = '';
    this._editingExamplesBlock = null;
    this._pendingLibraryPath = null; // Temp storage before registration

    // Bind event handlers
    this._handleBlockSearch = this._handleBlockSearch.bind(this);
  }

  _getLibraryType() {
    return 'Blocks';
  }

  _getStylesheets() {
    return sectionStyles ? [sectionStyles] : [];
  }

  async loadData() {
    if (!this.org || !this.site) {
      return;
    }

    try {
      this._setLoading(true);

      // Clear previous org/site data
      this._existingBlocks = [];
      this._libraryExists = false;
      this._libraryPath = '/library';
      this._customLibraryPath = false;
      this._blocksWithUpdates = new Map();

      // Check if blocks.json exists at library path
      await this._checkLibraryExists();

      this._setLoading(false);
    } catch (error) {
      this._setError(`Failed to load blocks: ${error.message}`);
    }
  }

  async _checkLibraryExists() {
    try {
      // Get blocks.json path from library config
      const blocksJsonUrl = await getLibraryPath(this.org, this.site, 'Blocks', this.token);

      if (!blocksJsonUrl) {
        // Library not configured - treat as first time setup
        this._libraryExists = false;
        this._existingBlocks = [];
        return;
      }

      // Library is configured - set path even if file doesn't exist yet
      this._libraryExists = true;
      this._libraryPath = blocksJsonUrl;

      // Try to fetch blocks.json from the configured path
      const response = await fetch(blocksJsonUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        // Config exists but file doesn't - show as configured with no blocks
        this._existingBlocks = [];
        return;
      }

      const data = await response.json();

      // Parse blocks from blocks.json - handle different response structures
      // Could be: { data: { data: [...] } } or { data: [...] } or [...]
      let blocksData = null;
      if (data?.data?.data && Array.isArray(data.data.data)) {
        // Nested structure: { data: { data: [...] } }
        blocksData = data.data.data;
      } else if (data?.data && Array.isArray(data.data)) {
        // Single nesting: { data: [...] }
        blocksData = data.data;
      } else if (Array.isArray(data)) {
        // Direct array: [...]
        blocksData = data;
      }

      if (blocksData && Array.isArray(blocksData)) {
        // Load last modified dates for each block document
        const enriched = await this._enrichBlocksWithMetadata(blocksData);
        this._existingBlocks = enriched;
      } else {
        this._existingBlocks = [];
      }
    } catch (error) {
      this._libraryExists = false;
      this._existingBlocks = [];
    }
  }

  async _checkCustomLibraryPath() {
    try {
      const blocksJsonUrl = `https://admin.da.live/source/${this.org}/${this.site}${this._libraryPath}/blocks.json`;
      const response = await fetch(blocksJsonUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        this._libraryExists = true;

        // Parse blocks from blocks.json - handle different response structures
        let blocksData = null;
        if (data?.data?.data && Array.isArray(data.data.data)) {
          blocksData = data.data.data;
        } else if (data?.data && Array.isArray(data.data)) {
          blocksData = data.data;
        } else if (Array.isArray(data)) {
          blocksData = data;
        }

        if (blocksData && Array.isArray(blocksData)) {
          const enriched = await this._enrichBlocksWithMetadata(blocksData);
          this._existingBlocks = enriched;
        }
      } else {
        this._libraryExists = false;
        this._existingBlocks = [];
      }
    } catch (error) {
      // Library doesn't exist or error fetching
      this._libraryExists = false;
      this._existingBlocks = [];
    }
  }

  async _enrichBlocksWithMetadata(blocksData) {
    // Group blocks by their actual location (org/site/path)
    // Parse the path URL to find where blocks are actually stored
    const blocksByLocation = new Map();

    // Extract the directory path from the blocks.json URL
    // e.g., https://content.da.live/org/site/library/blocks.json -> org/site/library/blocks
    let defaultBlocksPath = `${this.org}/${this.site}/library/blocks`;
    if (this._libraryPath) {
      try {
        const url = new URL(this._libraryPath);
        // Remove leading slash and .json extension
        const pathParts = url.pathname.replace(/^\//, '').replace(/\.json$/, '');
        defaultBlocksPath = pathParts;
      } catch (error) {
        // Use default if URL parsing fails
      }
    }

    blocksData.forEach((block) => {
      const blockName = block.name || block.Name || '';
      if (!block.path) {
        // No path specified, use default blocks path
        const key = defaultBlocksPath;
        if (!blocksByLocation.has(key)) {
          blocksByLocation.set(key, []);
        }
        blocksByLocation.get(key).push({ name: blockName, block });
      } else {
        // Parse the path URL to extract org/site/path
        // Example: https://content.da.live/aemsites/da-block-collection/docs/library/blocks/hero
        try {
          const url = new URL(block.path);
          const pathParts = url.pathname.split('/').filter(Boolean);
          if (pathParts.length >= 2) {
            const org = pathParts[0];
            const site = pathParts[1];
            // Get the parent directory (everything except the last part which is the block name)
            const blockPath = `/${pathParts.slice(2, -1).join('/')}`;
            const key = `${org}/${site}${blockPath}`;
            if (!blocksByLocation.has(key)) {
              blocksByLocation.set(key, []);
            }
            blocksByLocation.get(key).push({ name: blockName, block });
          }
        } catch (error) {
          // Invalid URL, skip this block
        }
      }
    });

    // Fetch metadata for each location
    const enrichedBlocks = [];

    /* eslint-disable no-restricted-syntax, no-await-in-loop */
    for (const [location, blocks] of blocksByLocation) {
      try {
        const listUrl = `https://admin.da.live/list/${location}`;

        const response = await fetch(listUrl, {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        });

        if (response.ok) {
          const files = await response.json();

          // Create a map of block names to their metadata
          const fileMetadataMap = new Map();
          files.forEach((file) => {
            if (file.name && file.ext === 'html') {
              fileMetadataMap.set(file.name.toLowerCase(), {
                lastModified: file.lastModified ? new Date(file.lastModified) : null,
              });
            }
          });

          // Enrich blocks from this location
          blocks.forEach(({ name, block }) => {
            const metadata = fileMetadataMap.get(name.toLowerCase());
            // Check if block is external (from different org/site)
            const isExternal = !location.startsWith(`${this.org}/${this.site}`);
            enrichedBlocks.push({
              name,
              lastModified: metadata?.lastModified || null,
              examples: 0,
              path: block.path || null,
              isExternal,
            });
          });
        } else {
          // Couldn't fetch metadata, add blocks without timestamps
          blocks.forEach(({ name, block }) => {
            const isExternal = !location.startsWith(`${this.org}/${this.site}`);
            enrichedBlocks.push({
              name,
              lastModified: null,
              examples: 0,
              path: block.path || null,
              isExternal,
            });
          });
        }
      } catch (error) {
        // Error fetching this location, add blocks without timestamps
        blocks.forEach(({ name, block }) => {
          const isExternal = !location.startsWith(`${this.org}/${this.site}`);
          enrichedBlocks.push({
            name,
            lastModified: null,
            examples: 0,
            path: block.path || null,
            isExternal,
          });
        });
      }
    }
    /* eslint-enable no-restricted-syntax, no-await-in-loop */

    return enrichedBlocks;
  }

  async _checkForUpdates() {
    if (!this._githubUrl || this._existingBlocks.length === 0) {
      this._setError('Please provide a GitHub repository URL first');
      return;
    }

    this._checkingUpdates = true;
    this._clearError();

    try {
      const parsed = parseGitHubURL(this._githubUrl);
      if (!parsed.org || !parsed.repo) {
        this._setError('Invalid GitHub repository URL');
        this._checkingUpdates = false;
        return;
      }

      const api = new GitHubAPI(parsed.org, parsed.repo, 'main', this._githubToken);

      // Check each block for updates
      const updateChecks = this._existingBlocks.map(async (block) => {
        try {
          // Get latest commit for this block's folder
          const commits = await api.getCommits(`blocks/${block.name}`, 1);

          if (commits && commits.length > 0) {
            const latestCommit = commits[0];
            const commitDate = new Date(latestCommit.commit.committer.date);

            // Compare with block's last modified date
            if (block.lastModified && commitDate > block.lastModified) {
              return {
                name: block.name,
                hasUpdate: true,
                commitDate,
                commitSha: latestCommit.sha.substring(0, 7),
                commitMessage: latestCommit.commit.message.split('\n')[0],
              };
            }
          }

          return { name: block.name, hasUpdate: false };
        } catch (error) {
          // Block might not exist in repo
          return { name: block.name, hasUpdate: false };
        }
      });

      const results = await Promise.all(updateChecks);

      // Update the map with results
      this._blocksWithUpdates.clear();
      results.forEach((result) => {
        if (result.hasUpdate) {
          this._blocksWithUpdates.set(result.name, result);
        }
      });

      this._lastChecked = new Date();
      this._checkingUpdates = false;

      // Track action
      this._trackAction('blocks-updates-checked', {
        totalBlocks: this._existingBlocks.length,
        updatesAvailable: this._blocksWithUpdates.size,
      });

      this.requestUpdate();
    } catch (error) {
      this._setError(`Failed to check for updates: ${error.message}`);
      this._checkingUpdates = false;
    }
  }

  _handleLibraryPathChange(e) {
    this._libraryPath = e.target.value.trim();
    if (this._libraryPath && !this._libraryPath.startsWith('/')) {
      this._libraryPath = `/${this._libraryPath}`;
    }
  }

  async _handleCheckLibraryPath() {
    await this._checkCustomLibraryPath();
    this.requestUpdate();
  }

  _handleToggleCustomPath() {
    this._customLibraryPath = !this._customLibraryPath;
  }

  // GitHub Repository Connection
  _handleGitHubUrlChange(e) {
    this._githubUrl = e.target.value.trim();
    this._clearError();
  }

  async _connectRepository() {
    if (!this._githubUrl) {
      this._setError('Please enter a GitHub repository URL');
      return;
    }

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
          this._setError('GitHub API rate limit exceeded. Please add a GitHub token to continue.');
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

        this._setError(result.error);
        this._validating = false;
        return;
      }

      this._repoConnected = true;
      this._validating = false;

      // Track connection
      this._trackAction('blocks-repo-connected', { repo: this._githubUrl });

      // Auto-discover blocks
      await this._discoverBlocks(parsed.org, parsed.repo);
    } catch (error) {
      this._setError(`Lookup failed: ${error.message}`);
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
    await this._connectRepository();
  }

  _handleClearToken() {
    TokenStorage.clear();
    this._githubToken = '';
    this._setError(null);
    this.requestUpdate();
  }

  _handleChangeRepo() {
    this._repoConnected = false;
    this._blocks = [];
    this._selectedBlocks.clear();
    this._showSamplePages = false;
    this._samplePages = [];
    this._clearError();
  }

  // Import Mode Switching
  _handleModeChange(mode) {
    this._importMode = mode;
    // Reset state when switching modes
    this._blocks = [];
    this._selectedBlocks.clear();
    this._scannedPages = [];
    this._repoConnected = false;
    this._showSamplePages = false;
    this._samplePages = [];
    this._clearError();
  }

  // Content Mode Handlers
  _handleBrowsePagesForScan() {
    this._showPagePicker = true;
  }

  _handlePageSelectedForScan(e) {
    if (!this._scannedPages.includes(e.detail.path)) {
      this._scannedPages = [...this._scannedPages, e.detail.path];
      this._scanMessage = null;
    }
  }

  _handleRemoveScannedPage(pagePath) {
    this._scannedPages = this._scannedPages.filter((p) => p !== pagePath);
    this._scanMessage = null;
  }

  async _handleScanContent() {
    if (this._scannedPages.length === 0) {
      this._setError('Please select at least one page to scan');
      return;
    }

    this._scanningContent = true;
    this._scanMessage = null;
    this._clearError();

    try {
      const { discoverBlocksFromContent } = await import('../../shared/utils/content-extract.js');

      const sitesWithPages = [{
        org: this.org,
        site: this.site,
        pages: this._scannedPages.map((path) => ({ path })),
      }];

      const onProgress = ({ current, total, page }) => {
        this._processStep = `Scanning ${current}/${total}: ${page}`;
        this.requestUpdate();
      };

      const discoveredBlocks = await discoverBlocksFromContent(
        sitesWithPages,
        onProgress,
        this.token,
      );

      // Check for conflicts with existing blocks
      const existingBlockNames = new Set(this._existingBlocks.map((b) => b.name));
      this._blocks = discoveredBlocks.map((block) => ({
        ...block,
        hasConflict: existingBlockNames.has(block.name),
      }));

      this._scanningContent = false;

      // Show message if no blocks found
      if (this._blocks.length === 0) {
        this._scanMessage = {
          type: 'warning',
          text: 'No blocks found in selected pages',
        };
      }

      this._trackAction('blocks-content-scanned', {
        pagesScanned: this._scannedPages.length,
        blocksFound: this._blocks.length,
      });
    } catch (error) {
      this._setError(`Content scan failed: ${error.message}`);
      this._scanningContent = false;
    }
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

      this._blocks = filteredBlocks;
      this._discovering = false;

      // Track discovery
      this._trackAction('blocks-discovered', { count: filteredBlocks.length });
    } catch (error) {
      this._setError(`Block discovery failed: ${error.message}`);
      this._discovering = false;
    }
  }

  // Block Selection
  _handleBlockToggle(blockName) {
    if (this._selectedBlocks.has(blockName)) {
      this._selectedBlocks.delete(blockName);
    } else {
      this._selectedBlocks.add(blockName);
    }
    this.requestUpdate();
  }

  _handleSelectAll() {
    this._blocks.forEach((block) => this._selectedBlocks.add(block.name));
    this.requestUpdate();
  }

  _handleDeselectAll() {
    this._selectedBlocks.clear();
    this.requestUpdate();
  }

  // Sample Pages
  _handleProceedToSamples() {
    if (this._selectedBlocks.size === 0) {
      this._setError('Please select at least one block');
      return;
    }

    // For content mode, we already have the example pages (scanned pages)
    // Skip directly to library creation
    if (this._importMode === 'content') {
      this._samplePages = [...this._scannedPages];
      this._createLibrary();
    } else {
      // For GitHub mode, show sample pages selection
      this._showSamplePages = true;
      this._clearError();
    }
  }

  _handleSkipSamples() {
    this._createLibrary();
  }

  _handleBrowsePages() {
    this._showPagePicker = true;
  }

  _handlePageSelected(e) {
    // For content mode scanning
    if (this._importMode === 'content' && this._blocks.length === 0) {
      this._handlePageSelectedForScan(e);
    } else if (!this._samplePages.includes(e.detail.path)) {
      // For adding examples (GitHub mode or editing existing blocks)
      this._samplePages = [...this._samplePages, e.detail.path];
    }
  }

  _handlePagePickerClose() {
    // If we're editing examples for a block, save them
    if (this._editingExamplesBlock && this._samplePages.length > 0) {
      try {
        // TODO: Save example pages to block metadata
        // For now, just show a message
        this._setError(`Saving ${this._samplePages.length} example(s) for "${this._editingExamplesBlock.name}" - not yet implemented`);
      } catch (error) {
        this._setError(`Failed to save examples: ${error.message}`);
      }
    }

    this._showPagePicker = false;
    this._editingExamplesBlock = null;
  }

  _handleRemovePage(pagePath) {
    this._samplePages = this._samplePages.filter((p) => p !== pagePath);
  }

  _handleBlockSearch(e) {
    this._blockSearchQuery = e.target.value;
  }

  _handleBlockEdit(block) {
    try {
      // Open page picker to add/edit examples for this block
      this._editingExamplesBlock = block;

      // Load existing example pages for this block if any
      // TODO: Load from block metadata
      this._samplePages = [];

      this._showPagePicker = true;
    } catch (error) {
      this._setError(`Failed to open page picker: ${error.message}`);
    }
  }

  _handleBlockRemove(block) {
    // TODO: Implement block removal
    this._setError(`Remove block "${block.name}" - not yet implemented`);
  }

  _handleBlockUpdate(block) {
    // TODO: Implement block update from GitHub
    this._setError(`Update block "${block.name}" - not yet implemented`);
  }

  // Custom library setup hook for blocks-specific logic
  async _onLibrarySetupComplete(pathToRegister) {
    // Save to temporary state for blocks-specific workflow
    // Registration already happened in the mixin
    this._pendingLibraryPath = pathToRegister;

    // Construct the full path for display
    this._libraryPath = `https://content.da.live/${this.org}/${this.site}/${pathToRegister.replace(/^\/+/, '')}/blocks.json`;

    // If user was trying to create library, proceed with that now
    if (this._selectedBlocks.size > 0) {
      await this._createLibrary();
    }
  }

  // Library Creation
  async _createLibrary() {
    // Check if library is configured first
    if (!this._libraryExists && !this._pendingLibraryPath) {
      // First time creating library - need to setup library location
      await this._showLibrarySetupModal();
      return;
    }

    this._processing = true;
    this._processStep = 'Preparing library setup...';
    this._clearError();

    try {
      const blockNames = Array.from(this._selectedBlocks);

      // Prepare sites with pages for example extraction
      const sitesWithPages = this._samplePages.length > 0 ? [{
        org: this.org,
        site: this.site,
        pages: this._samplePages.map((path) => ({ path })),
      }] : [];

      // Create GitHub API instance if we have a connected repo
      let githubApi = null;
      if (this._githubUrl && this._githubToken) {
        const parsed = parseGitHubURL(this._githubUrl);
        if (parsed.org && parsed.repo) {
          githubApi = new GitHubAPI(parsed.org, parsed.repo, 'main', this._githubToken);
        }
      }

      // Import the library setup function
      const { setupLibrary } = await import('../../shared/operations/library.js');

      // Progress callback
      const onProgress = ({
        step, status, current, total, blockName,
      }) => {
        if (status === 'start') {
          switch (step) {
            case 'register':
              this._processStep = 'Registering library configuration...';
              break;
            case 'extract':
              this._processStep = `Extracting examples from ${total} pages...`;
              break;
            case 'generate':
              this._processStep = `Generating block documents (${total} blocks)...`;
              break;
            case 'upload':
              this._processStep = 'Uploading block documents...';
              break;
            case 'blocks-json':
              this._processStep = 'Creating blocks.json...';
              break;
            default:
              this._processStep = `Processing ${step}...`;
          }
        } else if (status === 'uploading' && blockName) {
          this._processStep = `Uploading ${blockName} (${current}/${total})...`;
        } else if (status === 'success' && blockName) {
          this._processStep = `Uploaded ${blockName} (${current}/${total})`;
        }
        this.requestUpdate();
      };

      // If we have a pending library path, we need to register it first
      // The setupLibrary function will use the default path,
      // so we need to register our custom path first
      if (this._pendingLibraryPath) {
        this._processStep = 'Registering custom library path...';
        const result = await registerLibraryType(
          this.org,
          this.site,
          'Blocks',
          this._pendingLibraryPath,
          this.token,
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to register library path');
        }

        // Clear pending path after successful registration
        this._pendingLibraryPath = null;
      }

      // Run the library setup
      const results = await setupLibrary({
        org: this.org,
        site: this.site,
        blockNames,
        sitesWithPages,
        onProgress,
        skipSiteConfig: false, // We want to register the config
        githubApi,
      });

      if (!results.success) {
        throw new Error(results.error || 'Library setup failed');
      }

      this._processing = false;
      this._libraryExists = true;

      // Reload the library to get the actual blocks
      await this._checkLibraryExists();

      // Track success
      this._trackAction('blocks-library-created', {
        blockCount: blockNames.length,
        samplePages: this._samplePages.length,
      });

      // Reset form
      this._repoConnected = false;
      this._blocks = [];
      this._selectedBlocks.clear();
      this._showSamplePages = false;
      this._samplePages = [];
    } catch (error) {
      this._setError(`Library creation failed: ${error.message}`);
      this._processing = false;
    }
  }

  // Info Panel
  _dismissInfo() {
    this._infoDismissed = true;
    localStorage.setItem('blocks-info-dismissed', 'true');
  }

  // Render Methods
  _renderModeToggle() {
    return html`
      <div class="import-mode-toggle">
        <label class="mode-toggle-label">Import from:</label>
        <div class="mode-toggle-radios">
          <label class="mode-radio-option">
            <input
              type="radio"
              name="import-mode"
              value="content"
              .checked=${this._importMode === 'content'}
              @change=${() => this._handleModeChange('content')}
            />
            <span class="mode-radio-label">Content</span>
          </label>
          <label class="mode-radio-option">
            <input
              type="radio"
              name="import-mode"
              value="github"
              .checked=${this._importMode === 'github'}
              @change=${() => this._handleModeChange('github')}
            />
            <span class="mode-radio-label">Code</span>
          </label>
        </div>
      </div>
    `;
  }

  _renderInfoPanel() {
    if (this._infoDismissed || this._libraryExists) {
      return nothing;
    }

    return html`
      <div class="info-panel">
        <button class="info-panel-close" @click=${this._dismissInfo} aria-label="Dismiss">×</button>
        ${this._renderModeToggle()}
        <div class="info-panel-content">
          ${this._importMode === 'content' ? html`
            Select pages containing blocks to scan and extract. The blocks found will be added to your library with their content as examples.
          ` : html`
            Your block library connects code from your repository with real content examples.
            Keep blocks in sync as your code and example content in it evolves.
          `}
        </div>
        ${this._importMode === 'content' ? html`
          <!-- Content Mode UI -->
          ${this._scannedPages.length > 0 ? html`
            <div class="scanned-pages-list">
              <h3>Selected Pages (${this._scannedPages.length}):</h3>
              <ul class="pages-list">
                ${this._scannedPages.map((page) => html`
                  <li class="page-item">
                    <span class="page-path">${page}</span>
                    <sl-button size="small" @click=${() => this._handleRemoveScannedPage(page)}>Remove</sl-button>
                  </li>
                `)}
              </ul>
            </div>
          ` : nothing}

          <div class="form-row">
            <sl-button @click=${this._handleBrowsePagesForScan}>
              ${this._scannedPages.length > 0 ? 'Add More Pages...' : 'Browse Pages...'}
            </sl-button>
            ${this._scannedPages.length > 0 ? html`
              <sl-button
                variant="primary"
                ?loading=${this._scanningContent}
                @click=${this._handleScanContent}
              >
                Scan for Blocks
              </sl-button>
            ` : nothing}
          </div>

          ${this._scanMessage ? html`
            <div class="message ${this._scanMessage.type}">
              ${this._scanMessage.text}
            </div>
          ` : nothing}
        ` : html`
          <!-- GitHub Mode UI -->
          ${this._repoConnected ? html`
            <div class="info-panel-repo">
              <span class="info-panel-repo-label">Repository:</span>
              <span class="info-panel-repo-value">${this._githubUrl}</span>
              <sl-button size="small" @click=${this._handleChangeRepo}>Change</sl-button>
            </div>
          ` : html`
            <div class="form-row">
              <sl-input
                id="github-url"
                type="url"
                placeholder="https://github.com/{owner}/{repo}"
                .value=${this._githubUrl}
                @input=${this._handleGitHubUrlChange}
                style="width: 500px;"
              ></sl-input>
              <sl-button
                variant="primary"
                ?loading=${this._validating}
                @click=${this._connectRepository}
              >
                Lookup
              </sl-button>
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
                      style="width: 500px;"
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
              </div>
            ` : nothing}
          `}
        `}
      </div>
    `;
  }

  _renderBlockSelection() {
    // Show blocks for both GitHub and content modes
    const showBlocks = (this._importMode === 'github' && this._repoConnected)
      || (this._importMode === 'content' && this._blocks.length > 0);

    if (!showBlocks || this._showSamplePages) {
      return nothing;
    }

    const selectedCount = this._selectedBlocks.size;
    const totalCount = this._blocks.length;
    const hasConflicts = this._blocks.some((b) => b.hasConflict);

    return html`
      <div class="blocks-grid-container">
        <div class="blocks-selection-header">
          <div class="blocks-selection-actions">
            <sl-button size="small" @click=${this._handleSelectAll}>Select All</sl-button>
            <sl-button size="small" @click=${this._handleDeselectAll}>Deselect All</sl-button>
          </div>
          <span class="blocks-count">${selectedCount} of ${totalCount} selected</span>
        </div>
        ${hasConflicts ? html`
          <div class="blocks-warning">
            <strong>Warning:</strong> Some blocks already exist in your library. They will be replaced with new content.
          </div>
        ` : nothing}
        <ul class="blocks-list">
          ${this._blocks.map((block) => {
    const isSelected = this._selectedBlocks.has(block.name);
    const variantInfo = block.variantCount > 0 ? ` (${block.variantCount} variant${block.variantCount > 1 ? 's' : ''})` : '';
    return html`
              <li class="block-card ${isSelected ? 'selected' : ''} ${block.hasConflict ? 'has-conflict' : ''}"
                  @click=${() => this._handleBlockToggle(block.name)}>
                <input
                  type="checkbox"
                  class="block-card-checkbox"
                  .checked=${isSelected}
                  @click=${(e) => e.stopPropagation()}
                  @change=${() => this._handleBlockToggle(block.name)}
                />
                <div class="block-card-content">
                  <div class="block-card-name">${this._toDisplayName(block.name)}${variantInfo}</div>
                  ${block.hasConflict ? html`
                    <div class="block-card-warning">Will replace existing</div>
                  ` : nothing}
                </div>
              </li>
            `;
  })}
        </ul>
      </div>

      ${selectedCount > 0 ? html`
        <div class="section-actions">
          <sl-button
            variant="primary"
            size="large"
            @click=${this._handleProceedToSamples}
          >
            Add to Library (${selectedCount})
          </sl-button>
        </div>
      ` : nothing}
    `;
  }

  _renderSamplePages() {
    if (!this._showSamplePages) {
      return nothing;
    }

    const selectedBlocksList = Array.from(this._selectedBlocks);

    return html`
      <div class="section-card">
        <h2>Add Sample Pages (Optional)</h2>
        <p class="section-description">
          Select pages that contain your blocks. We'll automatically detect which blocks appear
          in each page and extract examples. You can skip this and add examples later.
        </p>

        <div class="selected-blocks-summary">
          <h3>Selected Blocks (${selectedBlocksList.length}):</h3>
          <div class="selected-blocks-tags">
            ${selectedBlocksList.map((blockName) => html`
              <span class="block-tag">
                ${blockName}
                <button
                  class="block-tag-remove"
                  @click=${() => this._handleBlockToggle(blockName)}
                  aria-label="Remove ${blockName}"
                >×</button>
              </span>
            `)}
          </div>
          <p class="hint">We'll scan your selected pages for these blocks.</p>
        </div>

        ${this._samplePages.length > 0 ? html`
          <div class="sample-pages-list">
            <h3>Selected Pages (${this._samplePages.length}):</h3>
            <ul class="pages-list">
              ${this._samplePages.map((page) => html`
                <li class="page-item">
                  <span class="page-path">${page}</span>
                  <sl-button size="small" @click=${() => this._handleRemovePage(page)}>Remove</sl-button>
                </li>
              `)}
            </ul>
          </div>
        ` : nothing}

        <div class="form-row">
          <sl-button @click=${this._handleBrowsePages}>
            ${this._samplePages.length > 0 ? 'Add More Pages...' : 'Browse Pages...'}
          </sl-button>
        </div>

        <div class="section-actions">
          <sl-button
            variant="primary"
            size="large"
            @click=${this._createLibrary}
          >
            Create Block Library
          </sl-button>
          <sl-button
            size="large"
            @click=${this._handleSkipSamples}
          >
            Skip Examples
          </sl-button>
        </div>
      </div>

      ${this._renderPagePicker()}
    `;
  }

  _renderPagePicker() {
    const title = this._editingExamplesBlock
      ? `Select Example Pages for "${this._editingExamplesBlock.name}"`
      : 'Select Pages';

    return html`
      <page-picker
        .open=${this._showPagePicker}
        .org=${this.org}
        .site=${this.site}
        .title=${title}
        .selectedPages=${this._samplePages}
        .multiSelect=${true}
        @page-selected=${this._handlePageSelected}
        @close=${this._handlePagePickerClose}
      ></page-picker>
    `;
  }

  _renderEmptyState() {
    // Don't show empty state if library exists or if blocks are showing
    if (this._libraryExists || this._blocks.length > 0) {
      return nothing;
    }

    // Only show "Lookup Repository" message in Code mode
    if (this._importMode === 'github' && !this._repoConnected) {
      return html`
        <div class="empty-state">
          <div class="empty-state-icon">
            <img src="./icons/library-cc-library.svg" alt="Library" width="48" height="48" />
          </div>
          <h2 class="empty-state-title">Lookup Repository</h2>
          <p class="empty-state-description">
            Enter your GitHub repository URL above to look up available blocks and set up your library.
          </p>
        </div>
      `;
    }

    // For Content mode, don't show empty state (info panel has instructions)
    return nothing;
  }

  _renderProcessing() {
    if (!this._processing) {
      return nothing;
    }

    return html`
      <div class="section-card progress-card">
        <h3>Processing...</h3>
        <div class="progress-step">
          <strong>${this._processStep}</strong>
        </div>
      </div>
    `;
  }

  _renderExplainerCard() {
    const hasBlocks = this._libraryExists && this._existingBlocks.length > 0;
    const status = hasBlocks ? 'configured' : 'not-configured';
    const statusLabel = hasBlocks ? `${this._existingBlocks.length} Blocks Configured` : 'Not Configured';

    return html`
      <explainer-info-card
        cardId="blocks-library-setup"
        title="Blocks"
        status="${status}"
        statusLabel="${statusLabel}"
      >
        <div slot="content">
          <p>Blocks are functional components authors insert into pages. Each block provides specific functionality like carousels, hero images, forms, or product listings.</p>
          <p>${!this._libraryExists ? 'Without blocks, authors cannot add interactive or structured components to pages.' : 'Authors can now insert these blocks from the library picker.'} Blocks come from your codebase library folder.</p>
          <p>Provide a GitHub repository URL to look up available blocks, or scan content pages to discover blocks already in use.</p>
        </div>
        <div slot="actions">
          <a
            href="https://docs.da.live/administrators/guides/setup-library"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-small btn-secondary"
          >Setup Library Docs</a>
        </div>
      </explainer-info-card>
    `;
  }

  _renderLibraryPathConfig() {
    if (!this._libraryExists && !this._customLibraryPath) {
      return html`
        <div class="library-path-prompt">
          <p>No existing library found at <code>/library</code> or <code>/docs/library</code></p>
          <sl-button size="small" @click=${this._handleToggleCustomPath}>
            Specify Custom Library Path
          </sl-button>
        </div>
      `;
    }

    if (this._customLibraryPath) {
      return html`
        <div class="library-path-config">
          <label>Custom Library Path:</label>
          <div class="library-path-input">
            <sl-input
              type="text"
              placeholder="/library"
              .value=${this._libraryPath}
              @input=${this._handleLibraryPathChange}
              style="width: 300px;"
            ></sl-input>
            <sl-button @click=${this._handleCheckLibraryPath}>Check Path</sl-button>
            ${this._libraryExists ? html`
              <span class="library-status success">Library found at ${this._libraryPath}</span>
            ` : html`
              <span class="library-status error">No library found</span>
            `}
          </div>
        </div>
      `;
    }

    return nothing;
  }

  _renderExistingBlocks() {
    if (!this._libraryExists || this._existingBlocks.length === 0) {
      return nothing;
    }

    const updatesAvailable = this._blocksWithUpdates.size;

    // Filter blocks based on search query
    const filteredBlocks = this._blockSearchQuery
      ? this._existingBlocks.filter((block) => {
        const blockName = block.name.toLowerCase();
        const searchQuery = this._blockSearchQuery.toLowerCase();
        return blockName.includes(searchQuery);
      })
      : this._existingBlocks;

    return html`
      <div class="collection-card">
        <div class="collection-header">
          <h3 class="collection-title">Block Library (${this._existingBlocks.length})</h3>
          <div class="collection-header-actions">
            <sl-input
              type="search"
              size="small"
              placeholder="Search blocks..."
              .value=${this._blockSearchQuery}
              @sl-input=${this._handleBlockSearch}
              @sl-change=${this._handleBlockSearch}
              @input=${this._handleBlockSearch}
              @keyup=${this._handleBlockSearch}
              clearable
            ></sl-input>
            ${this._githubUrl ? html`
              <sl-button
                size="small"
                @click=${this._checkForUpdates}
                ?loading=${this._checkingUpdates}
              >
                Check for Updates
              </sl-button>
            ` : nothing}
            <sl-button size="small" @click=${this._handleCheckLibraryPath}>Refresh</sl-button>
          </div>
        </div>

        ${this._lastChecked || updatesAvailable > 0 ? html`
          <div class="blocks-status-bar">
            ${this._lastChecked ? html`
              <span class="last-checked">Last checked: ${this._formatDate(this._lastChecked)}</span>
            ` : nothing}
            ${updatesAvailable > 0 ? html`
              <span class="updates-available">${updatesAvailable} ${updatesAvailable === 1 ? 'update' : 'updates'} available</span>
            ` : nothing}
          </div>
        ` : nothing}

        <div class="blocks-management-list">
          ${filteredBlocks.length === 0 ? html`
            <div class="empty-state">
              ${this._blockSearchQuery ? html`
                <p>No blocks match your search</p>
              ` : html`
                <p>No blocks configured yet</p>
              `}
            </div>
          ` : filteredBlocks.map((block) => {
    const updateInfo = this._blocksWithUpdates.get(block.name);
    return html`
            <div class="block-management-item ${updateInfo ? 'has-update' : ''}">
              <div class="block-row">
                <div class="block-info">
                  <div class="block-name-row">
                    <h3 class="block-name">${this._toDisplayName(block.name)}</h3>
                    <div class="block-pills">
                      ${updateInfo ? html`
                        <span class="pill pill-update" title="Update available">Update available</span>
                      ` : ''}
                      ${block.isExternal ? html`
                        <span class="pill pill-external" title="External block">External</span>
                      ` : ''}
                      ${block.examples > 0 ? html`
                        <span class="pill pill-examples" title="${block.examples} example pages">${block.examples} example${block.examples === 1 ? '' : 's'}</span>
                      ` : ''}
                    </div>
                  </div>
                  ${updateInfo ? html`
                    <div class="block-update-details">
                      <span class="update-message">"${updateInfo.commitMessage}"</span>
                      <span class="update-meta">${this._formatDate(updateInfo.commitDate)} · ${updateInfo.commitSha}</span>
                    </div>
                  ` : ''}
                  ${block.isExternal && block.path ? html`
                    <div class="block-source">
                      <a href="${block.path}" target="_blank" rel="noopener">${this._getReadablePath(block.path)}</a>
                    </div>
                  ` : ''}
                </div>
                <div class="block-actions">
                  ${updateInfo ? html`
                    <button class="block-action-btn" @click=${() => this._handleBlockUpdate(block)}>Update</button>
                  ` : ''}
                  ${!block.isExternal ? html`
                    <button class="block-action-btn" @click=${() => this._handleBlockEdit(block)}>Edit Examples</button>
                  ` : ''}
                  <button class="block-action-btn remove" @click=${() => this._handleBlockRemove(block)}>Remove</button>
                </div>
              </div>
            </div>
          `;
  })}
        </div>
      </div>
    `;
  }

  // Helper to convert kebab-case to PascalCase for display
  // eslint-disable-next-line class-methods-use-this
  _toDisplayName(kebabName) {
    return kebabName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  _getReadablePath(pathUrl) {
    try {
      const url = new URL(pathUrl);
      // Return relative path without org/site prefix
      // e.g., "https://content.da.live/org/site/library/blocks.json" -> "library"
      const { pathname } = url;
      const parts = pathname.split('/').filter(Boolean);

      // Skip first 2 parts (org/site) and last part (filename)
      if (parts.length > 2) {
        return parts.slice(2, -1).join('/');
      }

      return pathname;
    } catch (error) {
      // If URL parsing fails, return as-is
      return pathUrl;
    }
  }

  _formatDate(date) {
    if (!date) return 'Unknown';

    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} ${days < 14 ? 'week' : 'weeks'} ago`;
    if (days < 365) return `${Math.floor(days / 30)} ${days < 60 ? 'month' : 'months'} ago`;
    return `${Math.floor(days / 365)} ${days < 730 ? 'year' : 'years'} ago`;
  }

  render() {
    if (this._loading) {
      return this._renderLoading('Loading blocks section...');
    }

    if (this._error) {
      return html`
        <div class="section-container">
          ${this._renderError(this._error)}
        </div>
      `;
    }

    return html`
      <div class="section-container">
        ${this._renderExplainerCard()}
        ${this._renderInfoPanel()}
        ${this._renderExistingBlocks()}
        ${this._renderEmptyState()}
        ${this._renderBlockSelection()}
        ${this._renderSamplePages()}
        ${this._renderProcessing()}
      </div>
      ${this._renderPagePicker()}
      <library-setup-modal
        .open=${this._showLibrarySetup}
        .libraryType=${'Blocks'}
        .options=${this._librarySetupOptions}
        .selectedPath=${this._selectedLibraryPath}
        .customPath=${this._customLibraryPathInput}
        @confirm=${this._handleLibrarySetupConfirm}
        @cancel=${this._handleLibrarySetupCancel}
      ></library-setup-modal>
    `;
  }
}

customElements.define('blocks-section', BlocksSection);
export default BlocksSection;
