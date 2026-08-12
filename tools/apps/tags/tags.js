/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console, class-methods-use-this */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  resolveTaxonomyLocation,
  fetchTaxonomy,
  saveTaxonomy,
  previewTaxonomy,
  publishTaxonomy,
  searchPagesForTag,
} from './api.js';
import {
  parseTaxonomyTree,
  serializeTaxonomyTree,
  buildTaxonomySheet,
} from './taxonomy.js';

// NX style pipeline matches other da.live shell apps: nx.js loadStyle + getStyle.
const NX = 'https://da.live/nx2';
let nexter = null;
let sl = null;
let styles = null;
try {
  const [{ default: getStyle }, { loadStyle, getColorScheme }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);
  document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';
  await Promise.all([
    loadStyle(`${NX}/styles/styles.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);
  await import(`${NX}/public/sl/components.js`);
  [nexter, sl, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

function commitOnEnter(e) {
  if (e.key === 'Enter') e.target.blur();
}

// Remembers the last loaded location across sessions, so reopening the app
// without URL params (e.g. from a bookmark) picks up where the user left
// off. URL params (`org`/`site`/`taxonomy`, matching da-permissions' and the
// tags plugin's own param names) still take precedence when present. Stored
// as a single `/org/site:taxonomyPath` string rather than one key per field.
const STORAGE_KEY = 'tagger-location';

function formatStoredLocation(org, site, taxonomyPath) {
  return `/${org}/${site}:${taxonomyPath || ''}`;
}

function parseStoredLocation(value) {
  const trimmed = (value || '').trim();
  const colonIndex = trimmed.indexOf(':');
  const sitePart = (colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex)).replace(/^\/+/, '');
  const taxonomyPath = colonIndex === -1 ? '' : trimmed.slice(colonIndex + 1);
  const slashIndex = sitePart.indexOf('/');
  if (slashIndex === -1) return { org: '', site: '', taxonomyPath };
  return { org: sitePart.slice(0, slashIndex), site: sitePart.slice(slashIndex + 1), taxonomyPath };
}

class TaggerApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    // 'idle' | 'loading' | 'loaded' | 'error'
    _state: { state: true },
    _orgValue: { state: true },
    _siteValue: { state: true },
    _taxonomyPathValue: { state: true },
    _org: { state: true },
    _site: { state: true },
    _taxonomyLocation: { state: true },
    _tree: { state: true },
    _dirty: { state: true },
    _saving: { state: true },
    _publishing: { state: true },
    _message: { state: true },
    // Miller-column drill path: [namespace, child, grandchild, ...].
    _selection: { state: true },
    // The node whose name/description is currently shown as editable inputs
    // (toggled via its pencil icon) — only one at a time.
    _editingNode: { state: true },
    // Nodes changed since the last save (added, renamed, re-described, or
    // moved) — rendered with a small dot so unsaved changes are easy to spot.
    _dirtyNodes: { state: true },
    // { list, item, mode } for the row currently under a drag — `mode` is
    // 'reorder' (same list, inserted before this row) or 'into' (a
    // different list, appended as this row's child) — used to show where a
    // drop would land.
    _dragOverTarget: { state: true },
    // { list, item, name, hasChildren, typed } while the delete modal is open.
    _deleteTarget: { state: true },
    // { path } while the find-pages modal is open.
    _searchModalTag: { state: true },
    _searchSubfolder: { state: true },
    _searching: { state: true },
    _searchProgress: { state: true },
    _searchResult: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);

    this._state = 'idle';
    this._orgValue = '';
    this._siteValue = '';
    this._taxonomyPathValue = '';
    this._org = '';
    this._site = '';
    this._taxonomyLocation = null;
    this._tree = { namespaces: [] };
    this._dirty = false;
    this._saving = false;
    this._publishing = false;
    this._message = null;
    this._selection = [];
    this._editingNode = null;
    this._dirtyNodes = new Set();
    this._dragOverTarget = null;
    this._deleteTarget = null;
    this._searchModalTag = null;
    this._searchSubfolder = '';
    this._searching = false;
    this._searchProgress = null;
    this._searchResult = null;
    // Not a reactive property — set/read only inside a single drag gesture.
    this._dragItem = null;

    const params = new URLSearchParams(window.location.search);
    const orgParam = (params.get('org') || '').trim();
    const siteParam = (params.get('site') || '').trim();
    const taxonomyParam = (params.get('taxonomy') || '').trim();
    const stored = parseStoredLocation(TaggerApp.readStorage(STORAGE_KEY));
    const org = orgParam || stored.org;
    const site = siteParam || stored.site;
    const taxonomyPath = taxonomyParam || stored.taxonomyPath;
    this._orgValue = org;
    this._siteValue = site;
    this._taxonomyPathValue = taxonomyPath;
    if (org && site) this.loadTaxonomy(org, site, taxonomyPath);
  }

  static readStorage(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  }

  // Persists the resolved location to both the URL (so the page is
  // shareable/reloadable) and localStorage (so it's remembered even when
  // reopened without those params).
  persistLocation(org, site, taxonomyPath) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('org', org);
      url.searchParams.set('site', site);
      if (taxonomyPath) {
        url.searchParams.set('taxonomy', taxonomyPath);
      } else {
        url.searchParams.delete('taxonomy');
      }
      window.history.replaceState(null, '', url);
    } catch (e) {
      console.warn('[tagger] updating URL failed:', e);
    }

    try {
      localStorage.setItem(STORAGE_KEY, formatStoredLocation(org, site, taxonomyPath));
    } catch (e) {
      console.warn('[tagger] persisting to localStorage failed:', e);
    }
  }

  // ---- Loading ----

  async loadTaxonomy(org, site, taxonomyPath) {
    this._state = 'loading';
    this._message = null;
    this._dirty = false;
    this._selection = [];
    this._editingNode = null;
    this._dirtyNodes = new Set();

    const location = resolveTaxonomyLocation(org, site, taxonomyPath);
    this._taxonomyLocation = location;
    this._org = org;
    this._site = site;
    this._orgValue = org;
    this._siteValue = site;
    this._taxonomyPathValue = taxonomyPath;
    this.persistLocation(org, site, taxonomyPath);

    const { ok, status, sheet } = await fetchTaxonomy(location.sourceUrl);

    if (!ok && status !== 404) {
      this._state = 'error';
      this._message = { type: 'error', text: `Failed to load taxonomy (${status || 'network error'}).` };
      return;
    }

    this._tree = parseTaxonomyTree(Array.isArray(sheet?.data) ? sheet.data : []);
    this._state = 'loaded';
    if (!ok) {
      this._message = {
        type: 'warning',
        text: `No taxonomy.json found yet at ${location.path} — add a namespace and save to create it.`,
      };
    }
  }

  handleLoadClick() {
    const org = (this.shadowRoot.querySelector('#org-input')?.value ?? '').trim();
    const site = (this.shadowRoot.querySelector('#site-input')?.value ?? '').trim();
    const taxonomyPath = (this.shadowRoot.querySelector('#taxonomy-input')?.value ?? '').trim();
    if (!org || !site) {
      this._message = { type: 'error', text: 'Enter both an organization and a site.' };
      return;
    }
    this.loadTaxonomy(org, site, taxonomyPath);
  }

  // ---- Save / Publish ----

  async handleSave() {
    if (this._saving) return;
    this._saving = true;
    this._message = null;

    const sheet = buildTaxonomySheet(serializeTaxonomyTree(this._tree));
    const result = await saveTaxonomy(this._taxonomyLocation.sourceUrl, sheet);

    this._saving = false;
    if (result.success) {
      this._dirty = false;
      this._dirtyNodes = new Set();
      this._message = { type: 'success', text: 'Saved.' };
    } else {
      this._message = { type: 'error', text: `Failed to save (${result.status || result.error}).` };
    }
  }

  async handlePublish() {
    if (this._publishing || this._dirty) return;
    this._publishing = true;
    this._message = null;

    const { org, repo, path } = this._taxonomyLocation;
    const preview = await previewTaxonomy(org, repo, path);
    if (!preview.success) {
      this._publishing = false;
      this._message = { type: 'error', text: `Preview failed (${preview.status || preview.error}).` };
      return;
    }

    const live = await publishTaxonomy(org, repo, path);
    this._publishing = false;
    this._message = live.success
      ? { type: 'success', text: 'Published.' }
      : { type: 'error', text: `Publish failed (${live.status || live.error}).` };
  }

  // ---- Tree editing ----
  //
  // A namespace, category, and tag are all the same `{ name, description,
  // children }` node — they differ only in depth and whether they currently
  // have children — so there's a single add/rename/edit path for all of them.

  // Marks `node` as changed since the last save — tracked separately from
  // `_dirty` so individual items can be highlighted, not just the overall
  // save/publish state.
  markDirty(node) {
    this._dirtyNodes = new Set(this._dirtyNodes).add(node);
    this._dirty = true;
  }

  handleAddChild(owner) {
    const list = owner ? owner.children : this._tree.namespaces;
    const node = { name: 'New Item', description: '', children: [] };
    list.push(node);
    this.markDirty(node);
    this.requestUpdate();
  }

  renameNode(node, name) {
    node.name = name;
    this.markDirty(node);
  }

  updateNodeField(node, field, value) {
    node[field] = value;
    this.markDirty(node);
  }

  // ---- Name/description edit toggle (pencil icon) ----

  startEditing(node) {
    this._editingNode = node;
  }

  stopEditing() {
    this._editingNode = null;
  }

  // ---- Delete confirmation (type the name to confirm) ----

  openDeleteConfirm(list, item) {
    this._deleteTarget = {
      list, item, name: item.name, hasChildren: item.children.length > 0, typed: '',
    };
  }

  closeDeleteConfirm() {
    this._deleteTarget = null;
  }

  updateDeleteTyped(value) {
    this._deleteTarget = { ...this._deleteTarget, typed: value };
  }

  confirmDelete() {
    const {
      list, item, name, typed,
    } = this._deleteTarget;
    if (typed !== name) return;

    const idx = list.indexOf(item);
    if (idx !== -1) list.splice(idx, 1);

    const selIdx = this._selection.indexOf(item);
    if (selIdx !== -1) this._selection = this._selection.slice(0, selIdx);
    if (this._editingNode === item) this._editingNode = null;

    this._dirty = true;
    this._deleteTarget = null;
    this.requestUpdate();
  }

  // ---- Drag & drop ----
  //
  // Each draggable item stashes `{ list, item }` on drag start — `list` is a
  // direct reference to the array it currently lives in. Dropping onto
  // another item in the SAME list reorders before it; dropping onto an item
  // in a DIFFERENT list moves the dragged item into it (appended to its
  // `.children`) — how an item moves to a different branch without both
  // branches needing to be visible in the same column at once.

  onDragStart(e, list, item) {
    this._dragItem = { list, item };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  }

  onDragEnd() {
    this._dragItem = null;
    this._dragOverTarget = null;
  }

  onDragOverRow(e) {
    e.preventDefault();
  }

  // Highlights the hovered row differently depending on what the drop would
  // do: `reorder` (same list — inserted before this row) vs `into` (a
  // different list — appended as this row's child).
  onDragEnterItem(e, targetList, targetItem) {
    e.preventDefault();
    if (!this._dragItem || this._dragItem.item === targetItem) return;
    const mode = this._dragItem.list === targetList ? 'reorder' : 'into';
    this._dragOverTarget = { list: targetList, item: targetItem, mode };
  }

  // Only highlights the column itself when hovering its bare background —
  // hovering a specific item is handled by `onDragEnterItem` instead.
  onDragEnterColumn(e, targetList) {
    if (e.target !== e.currentTarget || !this._dragItem) return;
    e.preventDefault();
    this._dragOverTarget = { list: targetList, item: null, mode: 'into' };
  }

  moveItem(targetList, targetIndex) {
    const drag = this._dragItem;
    if (!drag || !targetList) return;
    const sourceIndex = drag.list.indexOf(drag.item);
    if (sourceIndex === -1) return;

    drag.list.splice(sourceIndex, 1);
    let insertAt = targetIndex;
    if (drag.list === targetList && sourceIndex < insertAt) insertAt -= 1;
    targetList.splice(insertAt, 0, drag.item);

    this.markDirty(drag.item);
    this._dragItem = null;
    this._dragOverTarget = null;
    this.requestUpdate();
  }

  // True if `maybeInside` is `node` itself or nested somewhere in its subtree
  // — used to refuse a drop that would nest a node inside itself.
  isNodeOrDescendant(node, maybeInside) {
    if (node === maybeInside) return true;
    return node.children.some((child) => this.isNodeOrDescendant(child, maybeInside));
  }

  onDropOnItem(e, targetList, targetItem) {
    e.preventDefault();
    e.stopPropagation();
    const drag = this._dragItem;
    if (!drag) return;

    if (drag.list === targetList) {
      this.moveItem(targetList, targetList.indexOf(targetItem));
      return;
    }
    if (this.isNodeOrDescendant(drag.item, targetItem)) return;
    this.moveItem(targetItem.children, targetItem.children.length);
  }

  onDropInColumn(e, owner) {
    e.preventDefault();
    const drag = this._dragItem;
    if (!drag) return;
    if (owner && this.isNodeOrDescendant(drag.item, owner)) return;
    const targetList = owner ? owner.children : this._tree.namespaces;
    this.moveItem(targetList, targetList.length);
  }

  // ---- Miller column navigation ----

  handleColumnItemClick(node, colIndex) {
    this._selection = [...this._selection.slice(0, colIndex), node];
  }

  // The parent list the node at `_selection[idx]` was found in — needed to
  // delete or reparent it. `idx === 0` lives in the tree's namespace list;
  // deeper indexes live in the previous selection level's `.children`.
  parentListFor(idx) {
    return idx === 0 ? this._tree.namespaces : this._selection[idx - 1].children;
  }

  // Builds the `Namespace:Category/Tag` (or `Namespace/Tag`, or bare
  // `Namespace`) path for the node at `_selection[idx]`, matching
  // `taxonomy.js`'s `flattenTaxonomyTags` convention exactly.
  pathForSelectionIndex(idx) {
    const namespace = this._selection[0];
    if (idx === 0) return namespace.name;
    const node = this._selection[idx];
    const categoryPath = this._selection.slice(1, idx).map((n) => n.name).join('/');
    return categoryPath ? `${namespace.name}:${categoryPath}/${node.name}` : `${namespace.name}/${node.name}`;
  }

  // ---- Bulk search (find pages) ----

  openSearchModal(path) {
    this._searchModalTag = { path };
    this._searchSubfolder = '';
    this._searching = false;
    this._searchProgress = null;
    this._searchResult = null;
  }

  closeSearchModal() {
    this._searchModalTag = null;
  }

  async handleSearch() {
    if (!this._searchModalTag || this._searching) return;
    this._searching = true;
    this._searchResult = null;
    this._searchProgress = {
      checked: 0, total: 0, matched: 0, failed: 0,
    };

    // Search always crawls the currently loaded site's content — not
    // `_taxonomyLocation`, which may point at a taxonomy shared from a
    // different org/repo when a custom taxonomy path is in use.
    const rootPath = (this._searchSubfolder || '/').trim() || '/';
    const result = await searchPagesForTag({
      org: this._org,
      repo: this._site,
      rootPath,
      tagPath: this._searchModalTag.path,
      onProgress: (progress) => {
        this._searchProgress = progress;
      },
    });

    this._searching = false;
    this._searchResult = result;
  }

  editUrl(path) {
    const clean = path.replace(/\.html$/, '');
    return `https://da.live/edit#/${this._org}/${this._site}${clean}`;
  }

  previewUrl(path) {
    const clean = path.replace(/\.html$/, '').replace(/\/index$/, '') || '/';
    return `https://main--${this._site}--${this._org}.aem.page${clean}`;
  }

  // ---- Render: toolbar ----

  renderToolbar() {
    return html`
      <div class="tagger-toolbar">
        <header class="tagger-toolbar-header">
          <h1 class="tagger-title">Tags</h1>
        </header>
        <div class="tagger-org-form">
          <label class="tagger-field">
            <span>Organization</span>
            <sl-input id="org-input" type="text" autocomplete="off" .value=${this._orgValue}
              @keydown=${(e) => { if (e.key === 'Enter') this.handleLoadClick(); }}></sl-input>
          </label>
          <label class="tagger-field">
            <span>Site</span>
            <sl-input id="site-input" type="text" autocomplete="off" .value=${this._siteValue}
              @keydown=${(e) => { if (e.key === 'Enter') this.handleLoadClick(); }}></sl-input>
          </label>
          <label class="tagger-field tagger-field-path">
            <span>Taxonomy Path</span>
            <sl-input id="taxonomy-input" type="text" placeholder="/taxonomy.json"
              autocomplete="off" .value=${this._taxonomyPathValue}
              @keydown=${(e) => { if (e.key === 'Enter') this.handleLoadClick(); }}></sl-input>
          </label>
          <sl-button class="pw-fill-accent" @click=${() => this.handleLoadClick()}
            ?disabled=${this._state === 'loading'}>
            ${this._state === 'loading' ? 'Loading…' : 'Load'}
          </sl-button>
        </div>
      </div>
    `;
  }

  renderLoading() {
    return html`
      <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
        <div class="tagger-spinner" aria-hidden="true"></div>
        <p class="loading-label">Loading…</p>
      </div>
    `;
  }

  renderMessage() {
    if (!this._message) return nothing;
    return html`<div class="message ${this._message.type}">${this._message.text}</div>`;
  }

  // ---- Render: editor (Miller columns) ----

  renderEditor() {
    return html`
      <div class="tagger-editor">
        <div class="editor-actions">
          <sl-button class="pw-fill-accent" @click=${() => this.handleSave()}
            ?disabled=${this._saving || !this._dirty}>
            ${this._saving ? 'Saving…' : 'Save'}
          </sl-button>
          <sl-button class="pw-quiet-secondary" @click=${() => this.handlePublish()}
            ?disabled=${this._publishing || this._dirty}>
            ${this._publishing ? 'Publishing…' : 'Publish'}
          </sl-button>
          ${this._dirty ? html`<span class="dirty-hint">Unsaved changes (dots mark what changed) — publish is disabled until you save.</span>` : nothing}
          ${this.renderMessage()}
        </div>
        <div class="miller-panel">
          ${this.renderItemToolbar()}
          <div class="miller-columns">
            ${this.buildColumns().map((col, i) => this.renderColumn(col, i))}
          </div>
        </div>
      </div>
    `;
  }

  // A Spectrum action-bar-style toolbar attached directly to the columns it
  // acts on: shows the current selection path as context (with a way to
  // clear it) alongside the actions themselves. Acts on the deepest
  // selected node — no selection means the implicit target is the
  // namespace level, so Add still works (it creates a new top-level
  // namespace), while Delete/Find pages need an actual node and stay
  // disabled.
  renderItemToolbar() {
    const hasSelection = this._selection.length > 0;
    const selected = hasSelection ? this._selection[this._selection.length - 1] : null;
    const selectedIndex = this._selection.length - 1;
    const context = hasSelection ? this._selection.map((n) => n.name).join(' / ') : 'Namespaces';

    return html`
      <div class="miller-actionbar">
        <div class="miller-actionbar-context">
          ${hasSelection ? html`
            <button class="icon-btn" aria-label="Clear selection"
              @click=${() => { this._selection = []; }}>&times;</button>
          ` : nothing}
          <span class="miller-actionbar-label">${context}</span>
        </div>
        <div class="miller-actionbar-actions">
          <sl-button class="pw-quiet-secondary pw-action-sm" @click=${() => this.handleAddChild(selected)}>
            + Add
          </sl-button>
          <sl-button class="pw-quiet-secondary pw-action-sm" ?disabled=${!hasSelection}
            @click=${() => this.openSearchModal(this.pathForSelectionIndex(selectedIndex))}>
            Find pages
          </sl-button>
          <sl-button class="pw-quiet-danger pw-action-sm" ?disabled=${!hasSelection}
            @click=${() => this.openDeleteConfirm(this.parentListFor(selectedIndex), selected)}>
            Delete
          </sl-button>
        </div>
      </div>
    `;
  }

  // Column 0 is always the namespace list. Column i (i >= 1) shows the
  // children of `_selection[i - 1]`, and only exists once there's a
  // selection that deep.
  buildColumns() {
    const columns = [{ owner: null, items: this._tree.namespaces }];
    this._selection.forEach((node) => {
      columns.push({ owner: node, items: node.children });
    });
    return columns;
  }

  renderColumnHeader(col) {
    if (!col.owner) return html`<span class="miller-column-title">Namespaces</span>`;

    const isEditing = this._editingNode === col.owner;
    if (isEditing) {
      return html`
        <div class="miller-column-title-row">
          <input class="tax-name-input" .value=${col.owner.name} @keydown=${commitOnEnter}
            @change=${(e) => this.renameNode(col.owner, e.target.value)} />
          <button class="icon-btn" aria-label="Done editing" @click=${() => this.stopEditing()}>✓</button>
        </div>
      `;
    }

    const isDirty = this._dirtyNodes.has(col.owner);
    return html`
      <div class="miller-column-title-row">
        <span class="miller-column-owner-name">
          ${isDirty ? html`<span class="dirty-dot" aria-hidden="true" title="Unsaved change"></span>` : nothing}
          ${col.owner.name}
        </span>
        <button class="icon-btn" aria-label="Edit ${col.owner.name}" @click=${() => this.startEditing(col.owner)}>✎</button>
      </div>
    `;
  }

  renderColumnMeta(col) {
    if (!col.owner) return nothing;

    if (this._editingNode === col.owner) {
      return html`
        <div class="miller-column-meta">
          <input class="tax-desc-input" placeholder="Description" .value=${col.owner.description} @keydown=${commitOnEnter}
            @change=${(e) => this.updateNodeField(col.owner, 'description', e.target.value)} />
        </div>
      `;
    }

    if (!col.owner.description) return nothing;
    return html`
      <div class="miller-column-meta">
        <p class="miller-column-description">${col.owner.description}</p>
      </div>
    `;
  }

  renderColumn(col, colIndex) {
    const ownerList = col.owner ? col.owner.children : this._tree.namespaces;
    const isColumnDragOver = this._dragOverTarget?.item === null
      && this._dragOverTarget?.list === ownerList;

    return html`
      <div class="miller-column">
        <div class="miller-column-header">
          ${this.renderColumnHeader(col)}
          ${this.renderColumnMeta(col)}
        </div>
        <div class="miller-column-items ${isColumnDragOver ? 'drag-over-column' : ''}"
          @dragenter=${(e) => this.onDragEnterColumn(e, ownerList)}
          @dragover=${this.onDragOverRow}
          @drop=${(e) => this.onDropInColumn(e, col.owner)}>
          ${col.items.map((node) => this.renderColumnItem(node, colIndex, ownerList))}
        </div>
      </div>
    `;
  }

  renderColumnItem(node, colIndex, ownerList) {
    const isSelected = this._selection[colIndex] === node;
    const hasChildren = node.children.length > 0;
    const isDirty = this._dirtyNodes.has(node);
    const dragOverMode = this._dragOverTarget?.item === node ? this._dragOverTarget.mode : null;

    return html`
      <div class="miller-item ${isSelected ? 'is-selected' : ''} ${dragOverMode ? `drag-over-${dragOverMode}` : ''}"
        draggable="true"
        @dragstart=${(e) => this.onDragStart(e, ownerList, node)}
        @dragend=${() => this.onDragEnd()}
        @dragenter=${(e) => this.onDragEnterItem(e, ownerList, node)}
        @dragover=${this.onDragOverRow}
        @drop=${(e) => this.onDropOnItem(e, ownerList, node)}
        @click=${() => this.handleColumnItemClick(node, colIndex)}>
        <span class="drag-handle" aria-hidden="true">⠿</span>
        ${isDirty ? html`<span class="dirty-dot" aria-hidden="true" title="Unsaved change"></span>` : nothing}
        <span class="miller-item-label">${node.name}</span>
        ${hasChildren ? html`<span class="miller-item-chevron" aria-hidden="true">›</span>` : nothing}
      </div>
    `;
  }

  // ---- Render: delete confirmation modal ----

  renderDeleteModal() {
    const {
      name, typed, hasChildren,
    } = this._deleteTarget;
    const matches = typed.length > 0 && typed === name;

    return html`
      <div class="modal-backdrop" @click=${() => this.closeDeleteConfirm()}>
        <div class="modal" @click=${(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2>Delete "${name}"?</h2>
            <button class="modal-close" aria-label="Close" @click=${() => this.closeDeleteConfirm()}>&times;</button>
          </div>
          <div class="modal-body">
            ${hasChildren ? html`<p class="modal-warning">This deletes everything under it.</p>` : nothing}
            <label class="search-field">
              <span>Type "${name}" to confirm</span>
              <input type="text" .value=${typed} @input=${(e) => this.updateDeleteTyped(e.target.value)} />
            </label>
            <div class="modal-actions">
              <sl-button class="pw-quiet-secondary" @click=${() => this.closeDeleteConfirm()}>Cancel</sl-button>
              <sl-button class="pw-quiet-danger" @click=${() => this.confirmDelete()} ?disabled=${!matches}>Delete</sl-button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ---- Render: find-pages modal ----

  renderSearchModal() {
    const { path } = this._searchModalTag;
    return html`
      <div class="modal-backdrop" @click=${() => this.closeSearchModal()}>
        <div class="modal" @click=${(e) => e.stopPropagation()}>
          <div class="modal-header">
            <h2>Find pages tagged "${path}"</h2>
            <button class="modal-close" aria-label="Close" @click=${() => this.closeSearchModal()}>&times;</button>
          </div>
          <div class="modal-body">
            <label class="search-field">
              <span>Subfolder <em>(optional)</em></span>
              <input type="text" placeholder="/blog" .value=${this._searchSubfolder}
                @change=${(e) => { this._searchSubfolder = e.target.value; }} />
            </label>
            <sl-button class="pw-fill-accent" @click=${() => this.handleSearch()}
              ?disabled=${this._searching}>
              ${this._searching ? 'Searching…' : 'Find pages'}
            </sl-button>
            ${this._searching ? this.renderSearchProgress() : nothing}
            ${!this._searching && this._searchResult ? this.renderSearchResults() : nothing}
          </div>
        </div>
      </div>
    `;
  }

  renderSearchProgress() {
    const p = this._searchProgress;
    if (!p) return nothing;
    return html`
      <p class="search-progress">
        Checked ${p.checked} of ${p.total || '…'} pages — ${p.matched} match${p.matched === 1 ? '' : 'es'} so far.
      </p>
    `;
  }

  renderSearchResults() {
    const { total, matches, failed } = this._searchResult;
    if (total === 0) return html`<p class="search-summary">No pages found to check in this scope.</p>`;
    return html`
      <p class="search-summary">
        ${matches.length} of ${total} pages matched${failed ? ` (${failed} page${failed === 1 ? '' : 's'} could not be checked)` : ''}.
      </p>
      <ul class="search-results-list">
        ${matches.map((path) => html`
          <li>
            <code>${path}</code>
            <a href=${this.editUrl(path)} target="_blank" rel="noopener">Edit</a>
            <a href=${this.previewUrl(path)} target="_blank" rel="noopener">Preview</a>
          </li>
        `)}
      </ul>
    `;
  }

  // ---- Render: top-level ----

  render() {
    return html`
      ${this.renderToolbar()}
      ${this._state === 'loading' ? this.renderLoading() : nothing}
      ${this._state !== 'loading' && this._state !== 'loaded' ? this.renderMessage() : nothing}
      ${this._state === 'loaded' ? this.renderEditor() : nothing}
      ${this._deleteTarget ? this.renderDeleteModal() : nothing}
      ${this._searchModalTag ? this.renderSearchModal() : nothing}
    `;
  }
}

customElements.define('tagger-app', TaggerApp);

(async function init() {
  const { context, token } = await DA_SDK;
  const cmp = document.createElement('tagger-app');
  cmp.context = context;
  cmp.token = token;
  document.body.append(cmp);
}());
