// External import from importmap - unresolved at lint time
// Lit Element uses underscore prefix for private/reactive properties
/* eslint-disable import/no-unresolved, no-underscore-dangle, class-methods-use-this */
import { html, nothing } from 'da-lit';
import { BaseSectionElement } from '../../shared/components/base-section.js';
import {
  fetchOrgConfig,
  updateOrgConfig,
  fetchSiteList,
  listFolders,
} from './api.js';
import { icon } from './icons.js';

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
} catch {
  // Styles failed to load - section will render without styles

}

// ---- Display helpers ----

function pathLabel(path, site) {
  if (!site) {
    if (path === 'CONFIG') return 'DA Configurations';
    if (path === '/ + **' || path === '/+**') return 'All sites';
    return path;
  }
  if (path === `/${site}/ + **` || path === `/${site}/+**`) return 'Entire site';
  const folderMatch = path.match(new RegExp(`^\\/${site}\\/(.+)\\/ ?\\+ ?\\*\\*$`));
  if (folderMatch) return `${folderMatch[1]}/`;
  return path;
}

function pathClass(path, site) {
  if (!site) return path === 'CONFIG' ? 'scope-config' : 'scope-org';
  if (path === `/${site}/ + **` || path === `/${site}/+**`) return 'scope-site';
  return 'scope-folder';
}

// Normalize path variants like /+** and / + ** to a single canonical form
function normPath(path) {
  if (!path) return path;
  return path.replace(/\/ ?\+ ?\*\*/g, '/ + **');
}

function splitGroups(groups) {
  return (groups || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// DA actions values: 'write' | 'read' | '' (empty = deny/none)
// UI level names:    'write' | 'read' | 'none'
const levelToActions = (level) => (level === 'none' ? '' : level);
const actionsToLevel = (actions) => (actions === 'write' || actions === 'read' ? actions : 'none');

// ---- Component ----

class PermissionsSection extends BaseSectionElement {
  static properties = {
    ...BaseSectionElement.properties,
    // 'idle' | 'loading' | 'admin' | 'user'
    _state: { state: true },
    _userEmail: { state: true },
    _message: { state: true },
    _rules: { state: true },
    _siteList: { state: true },
    _isProcessing: { state: true },
    // path+level currently showing the inline add input
    _addingToPath: { state: true },
    _addingToLevel: { state: true },
    // folder browser for adding a new folder scope
    _newScopeOpen: { state: true },
    // folder path staged from browser, waiting for first member
    _pendingFolderPath: { state: true },
    _folderColumns: { state: true },
    _folderLoading: { state: true },
    _selectedFolderPath: { state: true },
    _infoDismissed: { state: true },
    _confirmRemove: { state: true },
    _readOnly: { state: true },
  };

  _getStylesheets() {
    return [nexter, sl, styles].filter(Boolean);
  }

  connectedCallback() {
    super.connectedCallback();

    this._state = 'idle';
    this._userEmail = '';
    this._message = null;
    this._rules = [];
    this._siteList = [];
    this._isProcessing = false;
    this._addingToPath = null;
    this._addingToLevel = null;
    this._newScopeOpen = false;
    this._pendingFolderPath = null;
    this._folderColumns = [];
    this._folderLoading = false;
    this._selectedFolderPath = '';
    this._infoDismissed = localStorage.getItem('da-permissions-info-dismissed') === 'true';
    this._confirmRemove = null;
    this._readOnly = false;

    if (this.token) {
      try {
        const payload = JSON.parse(atob(this.token.split('.')[1]));
        this._userEmail = payload.email || payload.user_id || '';
      } catch { /* noop */ }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  // Override loadData from BaseSectionElement
  async loadData() {
    if (!this.org) {
      this._state = 'idle';
      return;
    }

    this._state = 'loading';
    this._rules = [];
    this._siteList = [];
    this._message = null;
    this._addingToPath = null;
    this._addingToLevel = null;
    this._newScopeOpen = false;
    this._pendingFolderPath = null;
    this._folderColumns = [];
    this._folderLoading = false;
    this._selectedFolderPath = '';
    this._readOnly = false;

    try {
      const [orgResult, siteList] = await Promise.all([
        fetchOrgConfig(this.org),
        fetchSiteList(this.org),
      ]);

      this._siteList = siteList;

      if (orgResult.canAccess) {
        this._rules = orgResult.config?.permissions?.data || [];
        this._state = 'admin';
      } else {
        this._state = 'user';
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Permissions] Load error:', error);
      this._state = 'idle';
    }
  }

  // Watch for prop changes and reload data
  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has('org') || changedProperties.has('site')) {
      this.loadData();
    }
  }

  // Default paths that always appear for the current context (even if empty)
  get defaultPaths() {
    if (!this.site) return ['CONFIG', '/ + **'];
    return [`/${this.site}/ + **`];
  }

  // Group rules by path into Read/Write member lists
  get permissionSlots() {
    const { site } = this;
    const slotMap = new Map();

    this.defaultPaths.forEach((path) => {
      slotMap.set(path, {
        path,
        read: [],
        write: [],
        none: [],
        inheritedRead: [],
        inheritedWrite: [],
        inheritedNone: [],
      });
    });

    if (this._pendingFolderPath) {
      const pending = `/${site}/${this._pendingFolderPath}/ + **`;
      if (!slotMap.has(pending)) {
        slotMap.set(pending, {
          path: pending,
          read: [],
          write: [],
          none: [],
          inheritedRead: [],
          inheritedWrite: [],
          inheritedNone: [],
        });
      }
    }

    const isInContext = (path) => {
      const np = normPath(path);
      return !site
        ? (np === 'CONFIG' || np === '/ + **')
        : (np === `/${site}/ + **` || path.startsWith(`/${site}/`));
    };

    this._rules.filter((r) => r.path && isInContext(r.path)).forEach((rule) => {
      const key = normPath(rule.path);
      if (!slotMap.has(key)) {
        slotMap.set(key, {
          path: key,
          read: [],
          write: [],
          none: [],
          inheritedRead: [],
          inheritedWrite: [],
          inheritedNone: [],
        });
      }
      const slot = slotMap.get(key);
      const groups = splitGroups(rule.groups);
      slot[actionsToLevel(rule.actions)].push(...groups);
    });

    // In site context, populate inherited members on the top-level site slot
    // from org-level "All sites" (/ + **) rules, excluding anyone already listed.
    if (site) {
      const siteSlotKey = `/${site}/ + **`;
      const siteSlot = slotMap.get(siteSlotKey);
      if (siteSlot) {
        this._rules.filter((r) => normPath(r.path) === '/ + **').forEach((rule) => {
          const groups = splitGroups(rule.groups);
          const lvl = actionsToLevel(rule.actions);
          const inheritedKey = `inherited${lvl.charAt(0).toUpperCase()}${lvl.slice(1)}`;
          groups.filter((g) => !siteSlot[lvl].includes(g))
            .forEach((g) => siteSlot[inheritedKey].push(g));
        });
      }
    }

    return Array.from(slotMap.values());
  }

  // ---- Add member ----

  handleOpenAddMember(path, level) {
    this._addingToPath = path;
    this._addingToLevel = level;
    this._message = null;
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('.add-member-input')?.focus();
    });
  }

  handleAddMemberBlur() {
    this._addingToPath = null;
    this._addingToLevel = null;
  }

  async handleAddMemberKey(e) {
    if (e.key === 'Escape') {
      this._addingToPath = null;
      this._addingToLevel = null;
      return;
    }
    if (e.key !== 'Enter') return;

    const who = e.target.value.trim();
    if (!who || this._isProcessing) return;

    this._isProcessing = true;
    this._message = null;

    const path = this._addingToPath;
    const level = this._addingToLevel;

    const { canAccess, config } = await fetchOrgConfig(this.org);
    if (!canAccess || !config?.permissions) {
      this._message = { type: 'error', text: 'Config access denied.' };
      this._isProcessing = false;
      return;
    }

    const actions = levelToActions(level);
    const existing = config.permissions.data.find(
      (r) => normPath(r.path) === normPath(path) && r.actions === actions,
    );
    if (existing) {
      const current = splitGroups(existing.groups);
      if (!current.includes(who)) {
        existing.groups = [...current, who].join(', ');
      }
    } else {
      config.permissions.data.push({ path, groups: who, actions });
      config.permissions.total = config.permissions.data.length;
      config.permissions.limit = config.permissions.data.length;
    }

    const result = await updateOrgConfig(this.org, config);
    if (result.success) {
      this._rules = config.permissions.data;
      if (this._pendingFolderPath) {
        const pendingPath = `/${this.site}/${this._pendingFolderPath}/ + **`;
        if (path === pendingPath) this._pendingFolderPath = null;
      }
      this._addingToPath = null;
      this._addingToLevel = null;
    } else if (result.status === 403 || result.status === 401) {
      this._readOnly = true;
    } else {
      this._message = { type: 'error', text: `Failed to save: ${result.error}` };
    }

    this._isProcessing = false;
  }

  // ---- Remove member ----

  handleRemoveMember(path, level, who) {
    this._confirmRemove = { path, level, who };
  }

  async confirmRemove() {
    const { path, level, who } = this._confirmRemove;
    this._confirmRemove = null;
    if (this._isProcessing) return;

    this._isProcessing = true;
    this._message = null;

    const { canAccess, config } = await fetchOrgConfig(this.org);
    if (!canAccess || !config?.permissions?.data) {
      this._message = { type: 'error', text: 'Config access denied.' };
      this._isProcessing = false;
      return;
    }

    const ruleIdx = config.permissions.data.findIndex(
      (r) => normPath(r.path) === normPath(path) && r.actions === levelToActions(level),
    );
    if (ruleIdx === -1) {
      this._isProcessing = false;
      return;
    }

    const updated = splitGroups(config.permissions.data[ruleIdx].groups).filter((g) => g !== who);
    if (updated.length === 0) {
      config.permissions.data.splice(ruleIdx, 1);
    } else {
      config.permissions.data[ruleIdx].groups = updated.join(', ');
    }
    config.permissions.total = config.permissions.data.length;
    config.permissions.limit = config.permissions.data.length;

    const result = await updateOrgConfig(this.org, config);
    if (result.success) {
      this._rules = config.permissions.data;
    } else if (result.status === 403 || result.status === 401) {
      this._readOnly = true;
    } else {
      this._message = { type: 'error', text: `Failed to remove: ${result.error}` };
    }

    this._isProcessing = false;
  }

  // ---- New folder scope ----

  async handleOpenNewScope() {
    this._newScopeOpen = true;
    this._selectedFolderPath = '';
    this._folderColumns = [];
    this._folderLoading = true;
    const items = await listFolders(this.org, this.site, '/');
    this._folderColumns = [{ path: '/', items, selectedName: null }];
    this._folderLoading = false;
  }

  async handleFolderClick(columnIndex, folderName) {
    const updated = this._folderColumns
      .slice(0, columnIndex + 1)
      .map((col, i) => (i === columnIndex ? { ...col, selectedName: folderName } : col));

    const pathParts = updated.map((col) => col.selectedName).filter(Boolean);
    this._selectedFolderPath = pathParts.join('/');
    this._folderColumns = updated;
    this._folderLoading = true;

    const subPath = `/${pathParts.join('/')}/`;
    const subItems = await listFolders(this.org, this.site, subPath);
    if (subItems.length > 0) {
      this._folderColumns = [...updated, { path: subPath, items: subItems, selectedName: null }];
    }
    this._folderLoading = false;
  }

  handleConfirmNewScope() {
    if (!this._selectedFolderPath) return;
    this._pendingFolderPath = this._selectedFolderPath;
    this._newScopeOpen = false;
    this._folderColumns = [];
    this._selectedFolderPath = '';
  }

  handleCancelNewScope() {
    this._newScopeOpen = false;
    this._folderColumns = [];
    this._selectedFolderPath = '';
  }

  // ---- Render: loading ----

  renderLoading() {
    return html`
      <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
        <div class="spectrum-loading-indicator" aria-hidden="true"></div>
        <p class="loading-label">Loading…</p>
      </div>
    `;
  }

  // ---- Render: message ----

  renderMessage() {
    if (!this._message) return nothing;
    return html`<div class="message ${this._message.type}">${this._message.text}</div>`;
  }

  // ---- Render: level row within a slot ----

  renderPill(slot, level, member) {
    const isPending = this._confirmRemove?.path === slot.path
      && this._confirmRemove?.level === level
      && this._confirmRemove?.who === member;
    return html`
      <span class="group-pill ${isPending ? 'group-pill-confirming' : ''}">
        <span class="group-pill-text" title="${member}">${member}</span>
        ${isPending ? html`
          <span class="group-pill-confirm-label">Remove?</span>
          <button class="group-pill-confirm-yes" aria-label="Confirm remove ${member}" @click=${this.confirmRemove}>${icon('S2_Icon_Checkmark_20_N')}</button>
          <button class="group-pill-confirm-no" aria-label="Cancel" @click=${() => { this._confirmRemove = null; }}>${icon('S2_Icon_Close_20_N')}</button>
        ` : html`
          <button
            class="group-pill-remove"
            aria-label="Remove ${member}"
            @click=${() => this.handleRemoveMember(slot.path, level, member)}
            ?disabled=${this._isProcessing}
          >${icon('S2_Icon_Close_20_N')}</button>
        `}
      </span>
    `;
  }

  renderLevelRow(slot, level) {
    const members = slot[level];
    const inherited = slot[`inherited${level.charAt(0).toUpperCase()}${level.slice(1)}`] ?? [];
    const isAdding = this._addingToPath === slot.path && this._addingToLevel === level;
    const isEmpty = members.length === 0 && inherited.length === 0 && !isAdding;
    const labels = { write: 'Write', read: 'Read', none: 'None' };

    return html`
      <div class="level-row">
        <span class="level-row-label level-${level}">${labels[level]}</span>
        <div class="level-row-members">
          ${members.map((member) => this.renderPill(slot, level, member))}
          ${inherited.map((member) => html`
            <span class="group-pill group-pill-inherited" title="Inherited from All sites">
              <span class="group-pill-text">${member}</span>
            </span>
          `)}
          ${isEmpty ? html`
            <span class="level-empty">No one</span>
          ` : nothing}
          ${isAdding ? html`
            <span class="add-input-wrap">
              <input
                class="add-member-input"
                type="text"
                placeholder="email or IMS group ID — Esc to cancel"
                @keydown=${this.handleAddMemberKey}
                @blur=${this.handleAddMemberBlur}
              />
              <span class="add-input-hint" aria-hidden="true">↵</span>
            </span>
          ` : html`
            <button
              class="add-member-btn"
              @click=${() => this.handleOpenAddMember(slot.path, level)}
              ?disabled=${this._isProcessing}
            >+ Add</button>
          `}
        </div>
      </div>
    `;
  }

  // ---- Render: permission slot ----

  renderSlot(slot, sectionTitle = null) {
    const label = pathLabel(slot.path, this.site);
    const cls = pathClass(slot.path, this.site);
    const labelEl = cls === 'scope-folder'
      ? html`<span class="perm-slot-label ${cls}">${label}</span>`
      : html`<span class="perm-slot-plain-label">${label}</span>`;
    return html`
      ${sectionTitle ? html`<h2 class="slot-section-title">${sectionTitle}</h2>` : nothing}
      <div class="perm-slot">
        <div class="perm-slot-header">${labelEl}</div>
        ${this.renderLevelRow(slot, 'read')}
        ${this.renderLevelRow(slot, 'write')}
        ${slot.none.length > 0 ? this.renderLevelRow(slot, 'none') : nothing}
      </div>
    `;
  }

  // ---- Render: folder browser for new scope ----

  renderFolderBrowser() {
    return html`
      <div class="folder-browser">
        <div class="folder-browser-path">
          ${this._selectedFolderPath ? html`
            <span class="folder-path-label">Selected:</span>
            <span class="folder-path-value">${this._selectedFolderPath}</span>
          ` : html`
            <span class="folder-path-hint">Click a folder to select it</span>
          `}
        </div>
        <div class="folder-columns-wrap">
          ${this._folderColumns.map((col, colIndex) => html`
            <div class="folder-column">
              <div class="folder-column-header">
                ${col.path === '/' ? this.site : col.path.replace(/^\/|\/$/g, '')}
              </div>
              <div class="folder-column-items">
                ${col.items.length === 0 ? html`
                  <div class="folder-empty">No subfolders</div>
                ` : col.items.map((item) => html`
                  <button
                    class="folder-item ${col.selectedName === item.name ? 'folder-item-selected' : ''}"
                    @click=${() => this.handleFolderClick(colIndex, item.name)}
                  >
                    <span class="folder-item-name">${item.name}</span>
                    <span class="folder-item-chevron">›</span>
                  </button>
                `)}
              </div>
            </div>
          `)}
          ${this._folderLoading ? html`
            <div class="folder-column">
              <div class="folder-column-header">&nbsp;</div>
              <div class="folder-column-items folder-loading-col">Loading…</div>
            </div>
          ` : nothing}
        </div>
        <div class="folder-browser-actions">
          <sl-button
            class="pw-fill-accent pw-action-sm"
            @click=${this.handleConfirmNewScope}
            ?disabled=${!this._selectedFolderPath || this._folderLoading}
          >Add this folder</sl-button>
          <sl-button
            class="pw-quiet-secondary pw-action-sm"
            @click=${this.handleCancelNewScope}
          >Cancel</sl-button>
        </div>
      </div>
    `;
  }

  // ---- Render: admin view ----

  renderAdmin() {
    const orgSectionTitles = { CONFIG: 'Config Permissions', '/ + **': 'Content Permissions' };
    return html`
      ${this._readOnly ? html`
        <div class="message warning">You have read-only access to this configuration.</div>
      ` : nothing}
      <div class="slots-list">
        ${this.permissionSlots.map((slot) => this.renderSlot(slot, orgSectionTitles[slot.path] ?? null))}
        ${this.site && !this._newScopeOpen ? html`
          <button class="add-scope-btn" @click=${this.handleOpenNewScope}>
            + Add folder permission
          </button>
        ` : nothing}
        ${this.site && this._newScopeOpen ? this.renderFolderBrowser() : nothing}
      </div>
    `;
  }

  // ---- Render: top-level ----

  renderContent() {
    switch (this._state) {
      case 'loading': return this.renderLoading();
      case 'admin': return this.renderAdmin();
      case 'user': return html`<p class="empty-note">You don't have admin access to this org.</p>`;
      default: return nothing;
    }
  }

  dismissInfo() {
    this._infoDismissed = true;
    localStorage.setItem('da-permissions-info-dismissed', 'true');
  }

  renderInfoPanel() {
    if (this._infoDismissed || this._state !== 'admin') return nothing;
    return html`
      <div class="info-panel" role="note">
        <div class="info-panel-body">
          <div class="info-panel-sections">
            <div class="info-panel-section">
              <span class="info-panel-section-label">Content</span>
              <dl class="info-panel-terms">
                <div class="info-panel-term"><dt>Read</dt><dd>View content.</dd></div>
                <div class="info-panel-term"><dt>Write</dt><dd>Create, edit &amp; delete — includes Read.</dd></div>
                <div class="info-panel-term"><dt>None</dt><dd>Explicitly denies access.</dd></div>
              </dl>
            </div>
            <div class="info-panel-section">
              <span class="info-panel-section-label">Config</span>
              <dl class="info-panel-terms">
                <div class="info-panel-term"><dt>Read</dt><dd>Read DA configurations — recommended for content authors as using the block library or plugins in your DA project require it.</dd></div>
                <div class="info-panel-term"><dt>Write</dt><dd>Modify DA configurations — recommended for power users who need to manage org and site level configurations in DA.</dd></div>
              </dl>
            </div>
          </div>
          <p class="info-panel-note">Identity via Adobe IMS — use email addresses or IMS group IDs.</p>
          <sl-button
            class="pw-fill-accent"
            size="small"
            @click=${() => window.open('https://docs.da.live/administrators/guides/permissions', '_blank', 'noopener')}
          >DA permissions docs</sl-button>
        </div>
        <button class="info-panel-close" aria-label="Dismiss" @click=${this.dismissInfo}>✕</button>
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderInfoPanel()}
      ${this.renderMessage()}
      <div class="da-content">
        ${this.renderContent()}
      </div>
    `;
  }
}

customElements.define('permissions-section', PermissionsSection);

export default PermissionsSection;
