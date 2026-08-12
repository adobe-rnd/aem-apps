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
  flattenTaxonomyTags,
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

// Collects every `.categories` array reachable from a category (itself
// included), so a drag-move can refuse to drop a category into its own
// subtree and create a cycle.
function collectCategoryLists(category) {
  return category.categories.reduce(
    (lists, sub) => lists.concat(collectCategoryLists(sub)),
    [category.categories],
  );
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
    // 'editor' | 'search'
    _tab: { state: true },
    _searchTag: { state: true },
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
    this._tab = 'editor';
    this._searchTag = '';
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
    this._searchResult = null;
    this._searchTag = '';

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

  handleAddNamespace() {
    this._tree.namespaces.push({ name: 'New Namespace', tags: [], categories: [] });
    this._dirty = true;
    this.requestUpdate();
  }

  handleDeleteNamespace(ns) {
    // eslint-disable-next-line no-alert -- cascading delete; native confirm is enough here
    if (!window.confirm(`Delete namespace "${ns.name}" and everything under it?`)) return;
    this._tree.namespaces = this._tree.namespaces.filter((n) => n !== ns);
    this._dirty = true;
    this.requestUpdate();
  }

  renameNamespace(ns, name) {
    ns.name = name;
    this._dirty = true;
  }

  handleAddTag(owner) {
    owner.tags.push({ tag: 'New Tag', description: '' });
    this._dirty = true;
    this.requestUpdate();
  }

  updateTagField(tag, field, value) {
    tag[field] = value;
    this._dirty = true;
  }

  handleDeleteTag(list, tag) {
    const idx = list.indexOf(tag);
    if (idx === -1) return;
    list.splice(idx, 1);
    this._dirty = true;
    this.requestUpdate();
  }

  handleAddCategory(owner) {
    owner.categories.push({ name: 'New Category', tags: [], categories: [] });
    this._dirty = true;
    this.requestUpdate();
  }

  renameCategory(cat, name) {
    cat.name = name;
    this._dirty = true;
  }

  handleDeleteCategory(list, cat) {
    // eslint-disable-next-line no-alert -- cascading delete; native confirm is enough here
    if (!window.confirm(`Delete category "${cat.name}" and everything under it?`)) return;
    const idx = list.indexOf(cat);
    if (idx === -1) return;
    list.splice(idx, 1);
    this._dirty = true;
    this.requestUpdate();
  }

  // ---- Drag & drop reordering ----
  //
  // Each draggable row stashes `{ kind, list, item }` on drag start — `list`
  // is a direct reference to the array the item currently lives in (a
  // namespace/category's `.tags` or `.categories`). A drop target then
  // splices `item` out of its source list and into the target list at the
  // target index. Because the tree is held by reference, this works for
  // reordering in place and for moving an item to a different namespace/
  // category without any separate path bookkeeping.

  onDragStart(e, kind, list, item) {
    this._dragItem = { kind, list, item };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  }

  onDragEnd() {
    this._dragItem = null;
  }

  onDragOverRow(e) {
    e.preventDefault();
  }

  moveItem(targetList, targetIndex) {
    const drag = this._dragItem;
    if (!drag) return;
    const sourceIndex = drag.list.indexOf(drag.item);
    if (sourceIndex === -1) return;

    drag.list.splice(sourceIndex, 1);
    let insertAt = targetIndex;
    if (drag.list === targetList && sourceIndex < insertAt) insertAt -= 1;
    targetList.splice(insertAt, 0, drag.item);

    this._dragItem = null;
    this._dirty = true;
    this.requestUpdate();
  }

  onDropBeforeTag(e, targetList, targetTag) {
    e.preventDefault();
    if (this._dragItem?.kind !== 'tag') return;
    this.moveItem(targetList, targetList.indexOf(targetTag));
  }

  onDropAtEndOfTags(e, targetList) {
    e.preventDefault();
    if (this._dragItem?.kind !== 'tag') return;
    this.moveItem(targetList, targetList.length);
  }

  onDropBeforeCategory(e, targetList, targetCat) {
    e.preventDefault();
    const drag = this._dragItem;
    if (drag?.kind !== 'category' || collectCategoryLists(drag.item).includes(targetList)) return;
    this.moveItem(targetList, targetList.indexOf(targetCat));
  }

  onDropAtEndOfCategories(e, targetList) {
    e.preventDefault();
    const drag = this._dragItem;
    if (drag?.kind !== 'category' || collectCategoryLists(drag.item).includes(targetList)) return;
    this.moveItem(targetList, targetList.length);
  }

  onDropBeforeNamespace(e, targetNs) {
    e.preventDefault();
    if (this._dragItem?.kind !== 'namespace') return;
    this.moveItem(this._tree.namespaces, this._tree.namespaces.indexOf(targetNs));
  }

  onDropAtEndOfNamespaces(e) {
    e.preventDefault();
    if (this._dragItem?.kind !== 'namespace') return;
    this.moveItem(this._tree.namespaces, this._tree.namespaces.length);
  }

  // ---- Bulk search ----

  async handleSearch() {
    if (!this._searchTag || this._searching) return;
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
      tagPath: this._searchTag,
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
            <span>Taxonomy path <em>(optional, defaults to /taxonomy.json)</em></span>
            <sl-input id="taxonomy-input" type="text" placeholder="/taxonomy.json or a DA source URL"
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

  renderTabs() {
    return html`
      <div class="tagger-tabs" role="tablist">
        <button role="tab" class="tagger-tab ${this._tab === 'editor' ? 'is-active' : ''}"
          @click=${() => { this._tab = 'editor'; }}>Editor</button>
        <button role="tab" class="tagger-tab ${this._tab === 'search' ? 'is-active' : ''}"
          @click=${() => { this._tab = 'search'; }}>Find pages</button>
      </div>
    `;
  }

  // ---- Render: editor ----

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
          ${this._dirty ? html`<span class="dirty-hint">Unsaved changes — publish is disabled until you save.</span>` : nothing}
        </div>
        ${this.renderMessage()}
        <div class="namespace-list">
          ${this._tree.namespaces.map((ns) => this.renderNamespace(ns))}
          <div class="drop-zone" @dragover=${this.onDragOverRow} @drop=${(e) => this.onDropAtEndOfNamespaces(e)}></div>
        </div>
        <button class="add-node-btn" @click=${() => this.handleAddNamespace()}>+ Add namespace</button>
      </div>
    `;
  }

  renderNamespace(ns) {
    return html`
      <div class="tax-node tax-namespace" draggable="true"
        @dragstart=${(e) => this.onDragStart(e, 'namespace', this._tree.namespaces, ns)}
        @dragend=${() => this.onDragEnd()}
        @dragover=${this.onDragOverRow}
        @drop=${(e) => this.onDropBeforeNamespace(e, ns)}>
        <div class="tax-node-header">
          <span class="drag-handle" aria-hidden="true">⠿</span>
          <input class="tax-name-input tax-namespace-name" .value=${ns.name} @keydown=${commitOnEnter}
            @change=${(e) => this.renameNamespace(ns, e.target.value)} />
          <button class="tax-action-btn" @click=${() => this.handleAddTag(ns)}>+ Tag</button>
          <button class="tax-action-btn" @click=${() => this.handleAddCategory(ns)}>+ Category</button>
          <button class="tax-action-btn tax-action-danger" @click=${() => this.handleDeleteNamespace(ns)}>Delete</button>
        </div>
        <div class="tax-node-body">
          ${this.renderTagsList(ns.tags)}
          ${ns.categories.map((cat) => this.renderCategory(cat, ns.categories))}
          <div class="drop-zone" @dragover=${this.onDragOverRow} @drop=${(e) => this.onDropAtEndOfCategories(e, ns.categories)}></div>
        </div>
      </div>
    `;
  }

  renderCategory(cat, ownerList) {
    return html`
      <div class="tax-node tax-category" draggable="true"
        @dragstart=${(e) => this.onDragStart(e, 'category', ownerList, cat)}
        @dragend=${() => this.onDragEnd()}
        @dragover=${this.onDragOverRow}
        @drop=${(e) => this.onDropBeforeCategory(e, ownerList, cat)}>
        <div class="tax-node-header">
          <span class="drag-handle" aria-hidden="true">⠿</span>
          <input class="tax-name-input" .value=${cat.name} @keydown=${commitOnEnter}
            @change=${(e) => this.renameCategory(cat, e.target.value)} />
          <button class="tax-action-btn" @click=${() => this.handleAddTag(cat)}>+ Tag</button>
          <button class="tax-action-btn" @click=${() => this.handleAddCategory(cat)}>+ Subcategory</button>
          <button class="tax-action-btn tax-action-danger" @click=${() => this.handleDeleteCategory(ownerList, cat)}>Delete</button>
        </div>
        <div class="tax-node-body">
          ${this.renderTagsList(cat.tags)}
          ${cat.categories.map((sub) => this.renderCategory(sub, cat.categories))}
          <div class="drop-zone" @dragover=${this.onDragOverRow} @drop=${(e) => this.onDropAtEndOfCategories(e, cat.categories)}></div>
        </div>
      </div>
    `;
  }

  renderTagsList(list) {
    return html`
      <div class="tags-list">
        ${list.map((tag) => html`
          <div class="tag-row" draggable="true"
            @dragstart=${(e) => this.onDragStart(e, 'tag', list, tag)}
            @dragend=${() => this.onDragEnd()}
            @dragover=${this.onDragOverRow}
            @drop=${(e) => this.onDropBeforeTag(e, list, tag)}>
            <span class="drag-handle" aria-hidden="true">⠿</span>
            <input class="tax-name-input" .value=${tag.tag} @keydown=${commitOnEnter}
              @change=${(e) => this.updateTagField(tag, 'tag', e.target.value)} />
            <input class="tax-desc-input" placeholder="Description" .value=${tag.description} @keydown=${commitOnEnter}
              @change=${(e) => this.updateTagField(tag, 'description', e.target.value)} />
            <button class="tax-action-btn tax-action-danger" title="Delete tag"
              @click=${() => this.handleDeleteTag(list, tag)}>&times;</button>
          </div>
        `)}
        <div class="drop-zone drop-zone-tags" @dragover=${this.onDragOverRow} @drop=${(e) => this.onDropAtEndOfTags(e, list)}></div>
      </div>
    `;
  }

  // ---- Render: search ----

  renderSearch() {
    const flatTags = flattenTaxonomyTags(this._tree);
    const byNamespace = new Map();
    flatTags.forEach((tag) => {
      if (!byNamespace.has(tag.namespace)) byNamespace.set(tag.namespace, []);
      byNamespace.get(tag.namespace).push(tag);
    });

    return html`
      <div class="tagger-search">
        <div class="search-form">
          <label class="search-field">
            <span>Tag</span>
            <select @change=${(e) => { this._searchTag = e.target.value; }}>
              <option value="" ?selected=${!this._searchTag}>Select a tag…</option>
              ${[...byNamespace.entries()].map(([namespace, tags]) => html`
                <optgroup label=${namespace}>
                  ${tags.map((tag) => html`
                    <option value=${tag.path} ?selected=${this._searchTag === tag.path}>
                      ${tag.category ? `${tag.category} / ${tag.tag}` : tag.tag}
                    </option>
                  `)}
                </optgroup>
              `)}
            </select>
          </label>
          <label class="search-field">
            <span>Subfolder <em>(optional)</em></span>
            <input type="text" placeholder="/blog" .value=${this._searchSubfolder}
              @change=${(e) => { this._searchSubfolder = e.target.value; }} />
          </label>
          <sl-button class="pw-fill-accent" @click=${() => this.handleSearch()}
            ?disabled=${!this._searchTag || this._searching}>
            ${this._searching ? 'Searching…' : 'Find pages'}
          </sl-button>
        </div>
        ${this._searching ? this.renderSearchProgress() : nothing}
        ${!this._searching && this._searchResult ? this.renderSearchResults() : nothing}
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
      ${this._state !== 'loading' ? this.renderMessage() : nothing}
      ${this._state === 'loaded' ? html`
        ${this.renderTabs()}
        <div class="tagger-content">
          ${this._tab === 'editor' ? this.renderEditor() : this.renderSearch()}
        </div>
      ` : nothing}
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
