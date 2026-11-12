/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
import { fetchSiteList } from '../api/config-api.js';
// eslint-disable-next-line import/order
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

/**
 * Folder Picker Component
 * Combines site selection with folder browsing
 *
 * Events:
 *  - folder-selected: Fired when a folder is selected { detail: { path } }
 *  - close: Fired when the picker is closed
 *
 * Properties:
 *  - open: Boolean - Whether the picker is visible
 *  - org: String - Organization name
 *  - site: String - (Optional) Site name - if provided, skips site selection
 *  - title: String - Modal title
 *
 * Note: Styles are embedded in parent section's CSS (editor-config.css)
 */
class FolderPicker extends LitElement {
  static properties = {
    open: { type: Boolean },
    org: { type: String },
    site: { type: String },
    title: { type: String },
    _sites: { state: true },
    _loading: { state: true },
    _searchQuery: { state: true },
    _selectedSite: { state: true },
    _tree: { state: true },
    _allFolders: { state: true },
  };

  constructor() {
    super();
    this.open = false;
    this.org = '';
    this.site = '';
    this.title = 'Select Folder';
    this._sites = [];
    this._loading = false;
    this._searchQuery = '';
    this._selectedSite = null;
    this._tree = {};
    this._allFolders = [];
    this._siteTrees = {}; // Store loaded folder trees per site
    this._loadingSites = new Set(); // Track which sites are loading
  }

  createRenderRoot() {
    return this;
  }

  updated(changedProperties) {
    if (changedProperties.has('open') && this.open) {
      // Reset state
      this._siteTrees = {};
      this._loadingSites = new Set();

      // If site is provided, load folders directly for that site
      if (this.site) {
        this._handleSiteClick(this.site);
      } else {
        this._loadSites();
      }
    }
  }

  async _loadSites() {
    if (!this.org) {
      return;
    }

    this._loading = true;
    this._searchQuery = '';
    this._selectedSite = null;
    this._tree = {};

    try {
      const sites = await fetchSiteList(this.org);
      this._sites = sites || [];
    } catch (error) {
      this._sites = [];
    } finally {
      this._loading = false;
    }
  }

  async _handleSiteClick(site) {
    // If site prop is provided, this is single-site mode
    if (this.site) {
      this._selectedSite = site;
      this._loading = true;
      this._searchQuery = '';

      try {
        const folders = new Set();
        const basePath = `/${this.org}/${site}`;

        // Use crawl utility to recursively get all items
        const { results } = crawl({
          path: basePath,
          callback: (file) => {
            // Extract folder paths from file path
            const displayPath = file.path.replace(basePath, '');
            const pathParts = displayPath.split('/').filter(Boolean);

            // Build folder paths - folders are items without extensions
            let currentPath = '';
            for (let i = 0; i < pathParts.length; i += 1) {
              const part = pathParts[i];
              if (part) {
                currentPath += `/${part}`;
                const isLast = i === pathParts.length - 1;
                const hasExtension = part.includes('.');

                // Add as folder if: not the last part, OR last part without extension
                if (!isLast || !hasExtension) {
                  folders.add(currentPath);
                }
              }
            }
          },
          throttle: 10,
        });

        await results;

        // Convert Set to array and sort
        this._allFolders = Array.from(folders).sort();

        // Build tree structure
        this._tree = this._createFolderTree(this._allFolders);
        this._loading = false;
      } catch (error) {
        this._loading = false;
        this._allFolders = [];
        this._tree = {};
      }
    }
  }

  async _handleSiteToggle(e, site) {
    e.stopPropagation();

    // If already loaded, toggle visibility (collapse)
    if (this._siteTrees[site]) {
      delete this._siteTrees[site];
      this.requestUpdate();
      return;
    }

    // Load folders for this site
    this._loadingSites.add(site);
    this.requestUpdate();

    try {
      const folders = new Set();
      const basePath = `/${this.org}/${site}`;

      const { results } = crawl({
        path: basePath,
        callback: (file) => {
          const displayPath = file.path.replace(basePath, '');
          const pathParts = displayPath.split('/').filter(Boolean);

          let currentPath = '';
          for (let i = 0; i < pathParts.length; i += 1) {
            const part = pathParts[i];
            if (part) {
              currentPath += `/${part}`;
              const isLast = i === pathParts.length - 1;
              const hasExtension = part.includes('.');

              if (!isLast || !hasExtension) {
                folders.add(currentPath);
              }
            }
          }
        },
        throttle: 10,
      });

      await results;

      const folderArray = Array.from(folders).sort();
      this._siteTrees[site] = this._createFolderTree(folderArray);
    } catch (error) {
      this._siteTrees[site] = {};
    } finally {
      this._loadingSites.delete(site);
      this.requestUpdate();
    }
  }

  _createFolderTree(folderPaths) {
    const tree = {};
    folderPaths.forEach((folderPath) => {
      const parts = folderPath.split('/').filter(Boolean);
      let current = tree;
      parts.forEach((part, i) => {
        if (!current[part]) {
          current[part] = {
            isFolder: true,
            children: {},
            path: `/${parts.slice(0, i + 1).join('/')}`,
            name: part,
          };
        }
        current = current[part].children;
      });
    });
    return tree;
  }

  _filterTreeBySearch(tree, searchText) {
    const filtered = {};
    Object.entries(tree).forEach(([name, node]) => {
      const filteredChildren = this._filterTreeBySearch(node.children, searchText);
      const matchesPath = node.path.toLowerCase().includes(searchText);
      const hasMatchingChildren = Object.keys(filteredChildren).length > 0;

      if (matchesPath || hasMatchingChildren) {
        filtered[name] = {
          ...node,
          children: filteredChildren,
        };
      }
    });
    return filtered;
  }

  _handleSearch(e) {
    this._searchQuery = e.target.value.toLowerCase();
  }

  _handleBackToSites() {
    // If site was provided as prop, close instead of going back
    if (this.site) {
      this._handleClose();
      return;
    }
    this._selectedSite = null;
    this._tree = {};
    this._searchQuery = '';
  }

  _handleToggleFolder(e) {
    e.stopPropagation();
    const button = e.currentTarget;
    const treeItem = button.closest('.tree-item');
    const treeList = treeItem?.querySelector(':scope > .tree-list');

    button.classList.toggle('expanded');
    if (treeList) {
      treeList.classList.toggle('hidden');
    }
  }

  _handleFolderSelect(folderPath, site = null) {
    const siteToUse = site || this._selectedSite;
    const fullPath = `/${this.org}/${siteToUse}${folderPath}`;
    this.dispatchEvent(new CustomEvent('folder-selected', {
      detail: { path: fullPath },
      bubbles: true,
      composed: true,
    }));
    this._handleClose();
  }

  _handleClose() {
    this.dispatchEvent(new CustomEvent('close', {
      bubbles: true,
      composed: true,
    }));
  }

  _handleOverlayClick(e) {
    if (e.target.classList.contains('folder-picker-overlay')) {
      this._handleClose();
    }
  }

  _getFilteredSites() {
    if (!this._searchQuery) return this._sites;
    return this._sites.filter((site) => site.toLowerCase().includes(this._searchQuery));
  }

  _renderSiteTreeItem(site) {
    const siteTree = this._siteTrees[site];
    const isLoading = this._loadingSites.has(site);
    const isExpanded = !!siteTree;
    const treeEntries = siteTree
      ? Object.entries(siteTree).sort(([a], [b]) => a.localeCompare(b))
      : [];

    return html`
      <div class="tree-item" role="listitem">
        <div class="tree-item-content">
          <button
            class="folder-btn ${isExpanded ? 'expanded' : ''}"
            @click=${(e) => this._handleSiteToggle(e, site)}
          >
            <span class="tree-icon expand-icon">▶</span>
            <span class="tree-icon folder-icon">📁</span>
            <span class="folder-name">${site}</span>
            ${isLoading ? html`<span class="tree-loading-spinner"></span>` : nothing}
          </button>
        </div>
        ${isExpanded && !isLoading ? html`
          <div class="tree-list" role="list">
            ${treeEntries.length === 0 ? html`
              <div class="tree-empty">No folders found</div>
            ` : html`
              ${treeEntries.map(([name, node]) => this._renderTreeItem(name, node, false, site))}
            `}
          </div>
        ` : nothing}
      </div>
    `;
  }

  _renderTreeItem(name, node, autoExpand = false, site = null) {
    const childEntries = Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b));
    const hasChildren = childEntries.length > 0;

    return html`
      <div class="tree-item" role="listitem">
        <div class="tree-item-content">
          <button
            class="folder-btn ${autoExpand ? 'expanded' : ''}"
            @click=${hasChildren ? this._handleToggleFolder : () => this._handleFolderSelect(node.path, site)}
          >
            ${hasChildren ? html`<span class="tree-icon expand-icon">▶</span>` : nothing}
            <span class="tree-icon folder-icon">📁</span>
            <span class="folder-name">${name}</span>
          </button>
        </div>
        ${hasChildren ? html`
          <div class="tree-list ${autoExpand ? '' : 'hidden'}" role="list">
            ${childEntries.map(([childName, childNode]) => this._renderTreeItem(childName, childNode, autoExpand, site))}
          </div>
        ` : nothing}
      </div>
    `;
  }

  render() {
    if (!this.open) return nothing;

    // Show site tree if no site prop provided (org mode)
    if (!this.site && !this._selectedSite) {
      const filteredSites = this._getFilteredSites();

      return html`
        <div class="folder-picker-overlay" @click=${this._handleOverlayClick}>
          <div class="folder-picker-modal">
            <div class="folder-picker-header">
              <h2 class="folder-picker-title">${this.title}</h2>
              <button class="folder-picker-close" @click=${this._handleClose} aria-label="Close">×</button>
            </div>

            <div class="folder-picker-search">
              <input
                type="search"
                class="folder-picker-search-input"
                placeholder="Search sites..."
                .value=${this._searchQuery}
                @input=${this._handleSearch}
              />
            </div>

            ${this._loading ? html`
              <div class="folder-picker-loading">
                <div class="loading-spinner"></div>
                <p>Loading sites...</p>
              </div>
            ` : html`
              <div class="folder-picker-content">
                ${filteredSites.length === 0 ? html`
                  <div class="folder-picker-empty">
                    <p>${this._searchQuery ? 'No sites found matching your search' : 'No sites available'}</p>
                  </div>
                ` : html`
                  <div class="folder-picker-tree" role="list">
                    ${filteredSites.map((site) => this._renderSiteTreeItem(site))}
                  </div>
                `}
              </div>
            `}

            <div class="folder-picker-footer">
              <button class="folder-picker-cancel" @click=${this._handleClose}>Cancel</button>
            </div>
          </div>
        </div>
      `;
    }

    // Show folder tree for selected site
    const isSearching = !!this._searchQuery;
    const treeToRender = isSearching
      ? this._filterTreeBySearch(this._tree, this._searchQuery)
      : this._tree;
    const treeEntries = Object.entries(treeToRender).sort(([a], [b]) => a.localeCompare(b));

    return html`
      <div class="folder-picker-overlay" @click=${this._handleOverlayClick}>
        <div class="folder-picker-modal">
          <div class="folder-picker-header">
            ${!this.site ? html`
              <button class="folder-picker-back" @click=${this._handleBackToSites}>← Back to Sites</button>
            ` : nothing}
            <h2 class="folder-picker-title">${this._selectedSite}</h2>
            <button class="folder-picker-close" @click=${this._handleClose} aria-label="Close">×</button>
          </div>

          <div class="folder-picker-search">
            <input
              type="search"
              class="folder-picker-search-input"
              placeholder="Search folders..."
              .value=${this._searchQuery}
              @input=${this._handleSearch}
            />
          </div>

          <div class="folder-picker-content">
            ${this._loading ? html`
              <div class="folder-picker-loading">
                <div class="loading-spinner"></div>
                <p>Loading folders...</p>
              </div>
            ` : html`
              ${treeEntries.length === 0 ? html`
                <div class="folder-picker-empty">
                  <p>${isSearching ? 'No folders match your search' : 'No folders found'}</p>
                </div>
              ` : html`
                <div class="folder-picker-tree" role="list">
                  ${treeEntries.map(([name, node]) => this._renderTreeItem(name, node, isSearching))}
                </div>
              `}
            `}
          </div>

          <div class="folder-picker-footer">
            <button class="folder-picker-cancel" @click=${this._handleClose}>Cancel</button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('folder-picker', FolderPicker);
export default FolderPicker;
