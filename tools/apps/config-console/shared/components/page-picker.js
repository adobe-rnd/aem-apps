/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { LitElement, html, nothing } from 'da-lit';
// eslint-disable-next-line import/order
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

const NX = 'https://da.live/nx2';
let componentStyles = null;

try {
  const { default: getStyle } = await import(`${NX}/public/utils/styles.js`);
  componentStyles = await getStyle(import.meta.url);
} catch {
  // Styles failed to load
}

/**
 * Page Picker Component
 * Reusable component for browsing and selecting pages from a DA site
 *
 * Events:
 *  - page-selected: Fired when a page is selected { detail: { path } }
 *  - close: Fired when the picker is closed
 *
 * Properties:
 *  - open: Boolean - Whether the picker is visible
 *  - org: String - Organization name
 *  - site: String - Site name
 *  - title: String - Modal title
 *  - selectedPages: Array - Currently selected page paths
 *  - multiSelect: Boolean - Allow multiple page selection
 */
class PagePicker extends LitElement {
  static properties = {
    open: { type: Boolean },
    org: { type: String },
    site: { type: String },
    title: { type: String },
    selectedPages: { type: Array },
    multiSelect: { type: Boolean },
    _tree: { state: true },
    _loading: { state: true },
    _searchQuery: { state: true },
    _allPages: { state: true },
  };

  constructor() {
    super();
    this.open = false;
    this.org = '';
    this.site = '';
    this.title = 'Select Page';
    this.selectedPages = [];
    this.multiSelect = false;
    this._tree = {};
    this._loading = false;
    this._searchQuery = '';
    this._allPages = [];
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    // Load styles if not already loaded
    if (!document.querySelector('link[href*="page-picker.css"]') && componentStyles) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./page-picker.css', import.meta.url).href;
      document.head.appendChild(link);
    }
  }

  updated(changedProperties) {
    if (changedProperties.has('open') && this.open) {
      this._loadPages();
    }
  }

  async _loadPages() {
    if (!this.org || !this.site) {
      return;
    }

    this._loading = true;
    this._searchQuery = '';

    try {
      const pages = [];
      const basePath = `/${this.org}/${this.site}`;

      // Use crawl utility to recursively get all HTML pages
      const { results } = crawl({
        path: basePath,
        callback: (file) => {
          if (file.path.endsWith('.html')) {
            pages.push(file);
          }
        },
        throttle: 10,
      });

      await results;

      // Store all pages for search
      this._allPages = pages;

      // Build tree structure
      this._tree = this._createFileTree(pages, basePath);
      this._loading = false;
    } catch (error) {
      // Silently fail - error will be visible in UI
      this._loading = false;
    }
  }

  _createFileTree(files, basePath) {
    const tree = {};
    files.forEach((file) => {
      const displayPath = file.path.replace(basePath, '');
      const parts = displayPath.split('/').filter(Boolean);
      let current = tree;
      parts.forEach((part, i) => {
        if (!current[part]) {
          current[part] = {
            isFile: i === parts.length - 1 && file.path.endsWith('.html'),
            children: {},
            path: file.path.replace(basePath, '').replace(/^\//, ''),
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
      if (node.isFile) {
        if (node.path.toLowerCase().includes(searchText)) {
          filtered[name] = node;
        }
      } else {
        const filteredChildren = this._filterTreeBySearch(node.children, searchText);
        if (Object.keys(filteredChildren).length > 0) {
          filtered[name] = {
            ...node,
            children: filteredChildren,
          };
        }
      }
    });
    return filtered;
  }

  _handleSearch(e) {
    this._searchQuery = e.target.value.toLowerCase();
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

  _handlePageSelect(pagePath) {
    this.dispatchEvent(new CustomEvent('page-selected', {
      detail: { path: pagePath },
      bubbles: true,
      composed: true,
    }));

    // Close modal if single-select
    if (!this.multiSelect) {
      this._handleClose();
    }
  }

  _handleClose() {
    this.dispatchEvent(new CustomEvent('close', {
      bubbles: true,
      composed: true,
    }));
  }

  _handleOverlayClick(e) {
    if (e.target.classList.contains('page-picker-overlay')) {
      this._handleClose();
    }
  }

  _renderTreeItem(name, node, autoExpand = false) {
    if (node.isFile) {
      const alreadySelected = this.selectedPages.includes(node.path);
      const displayName = name.replace('.html', '');

      return html`
        <div class="tree-item" role="listitem">
          <div class="tree-item-content">
            <button
              class="page-btn-item ${alreadySelected ? 'selected' : ''}"
              @click=${() => this._handlePageSelect(node.path)}
            >
              <span class="tree-icon page-icon">📄</span>
              <span>${displayName}</span>
              ${alreadySelected ? html`<span class="item-selected">✓</span>` : nothing}
            </button>
          </div>
        </div>
      `;
    }

    // It's a folder
    const childEntries = Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b));
    const hasChildren = childEntries.length > 0;

    return html`
      <div class="tree-item" role="listitem">
        <div class="tree-item-content">
          <button class="folder-btn ${autoExpand ? 'expanded' : ''}" @click=${this._handleToggleFolder}>
            ${hasChildren ? html`<span class="tree-icon expand-icon">▶</span>` : nothing}
            <span class="tree-icon folder-icon">📁</span>
            <span class="folder-name">${name}</span>
          </button>
        </div>
        ${hasChildren ? html`
          <div class="tree-list ${autoExpand ? '' : 'hidden'}" role="list">
            ${childEntries.map(([childName, childNode]) => this._renderTreeItem(childName, childNode, autoExpand))}
          </div>
        ` : nothing}
      </div>
    `;
  }

  render() {
    if (!this.open) {
      return nothing;
    }

    const isSearching = !!this._searchQuery;
    const treeToRender = isSearching
      ? this._filterTreeBySearch(this._tree, this._searchQuery)
      : this._tree;

    const treeEntries = Object.entries(treeToRender).sort(([a], [b]) => a.localeCompare(b));

    return html`
      <div class="page-picker-overlay" @click=${this._handleOverlayClick}>
        <div class="page-picker-modal" @click=${(e) => e.stopPropagation()}>
          <div class="page-picker-header">
            <h3>${this.title} ${this._allPages.length > 0 ? `(${this._allPages.length} pages found)` : ''}</h3>
            <button class="page-picker-close" @click=${this._handleClose} aria-label="Close">×</button>
          </div>

          <div class="page-picker-search">
            <sl-input
              type="text"
              placeholder="Search pages..."
              .value=${this._searchQuery}
              @sl-input=${this._handleSearch}
              clearable
            ></sl-input>
          </div>

          <div class="page-picker-content">
            ${this._loading ? html`
              <div class="page-picker-loading">Loading pages...</div>
            ` : html`
              ${treeEntries.length === 0 ? html`
                <div class="page-picker-empty">
                  ${isSearching ? 'No pages match your search' : 'No pages found'}
                </div>
              ` : html`
                <div class="page-picker-tree" role="list">
                  ${treeEntries.map(([name, node]) => this._renderTreeItem(name, node, isSearching))}
                </div>
              `}
            `}
          </div>

          <div class="page-picker-footer">
            ${this.multiSelect ? html`
              <span class="page-picker-count">${this.selectedPages.length} pages selected</span>
            ` : nothing}
            <sl-button @click=${this._handleClose}>${this.multiSelect ? 'Done' : 'Cancel'}</sl-button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('page-picker', PagePicker);
export default PagePicker;
