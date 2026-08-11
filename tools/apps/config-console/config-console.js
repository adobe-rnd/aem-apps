// External imports from da.live CDN and importmap - unresolved at lint time
/* eslint-disable import/no-unresolved */
// Lit Element uses underscore prefix for private/reactive properties (_state, _org, etc)
/* eslint-disable no-underscore-dangle */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { fetchSiteList } from './shared/api/config-api.js';

const NX = 'https://da.live/nx2';
let nexter = null;
let sl = null;
let styles = null;

try {
  const [{ default: getStyle }, { loadStyle, getColorScheme }] = await Promise.all([
    import(`${NX}/public/utils/styles.js`),
    import(`${NX}/scripts/nx.js`),
  ]);

  // Apply color scheme
  document.documentElement.style.colorScheme = getColorScheme() === 'dark-scheme' ? 'dark' : 'light';

  // Load base styles
  await Promise.all([
    loadStyle(`${NX}/styles/styles.css`),
    loadStyle(`${NX}/public/sl/styles.css`),
  ]);

  // Load Shoelace components
  await import(`${NX}/public/sl/components.js`);

  // Get stylesheets
  [nexter, sl, styles] = await Promise.all([
    getStyle(`${NX}/styles/styles.css`),
    getStyle(`${NX}/public/sl/styles.css`),
    getStyle(import.meta.url),
  ]);
} catch {
  // Styles failed to load - app will render without styles
}

// RUM helper
function sampleRUM(checkpoint, data = {}) {
  try {
    window.hlx?.rum?.sampleRUM?.(checkpoint, data);
  } catch { /* noop */ }
}

// Spectrum icon mapping (SVG files from Adobe Spectrum CDN)
const SPECTRUM_ICONS = {
  permissions: './icons/permissions-lock-closed.svg',
  library: './icons/library-cc-library.svg',
  integrations: './icons/integrations-plug.svg',
  blocks: './icons/blocks-box.svg',
  templates: './icons/templates-file-template.svg',
  icons: './icons/icons-image.svg',
  placeholders: './icons/placeholders-variable.svg',
  'aem-assets': './icons/aem-assets-asset.svg',
  translation: './icons/translation-globe.svg',
  'universal-editor': './icons/universal-editor-edit.svg',
  'multi-site-manager': './icons/multi-site-manager-branch.svg',
  collapse: './icons/collapse-menu-rail-right-close.svg',
  expand: './icons/collapse-menu-rail-right-open.svg',
};

// Section definitions with Spectrum icon references
const SECTIONS = {
  ORG: [
    {
      id: 'permissions-group',
      title: 'Permissions',
      iconKey: 'permissions',
      type: 'group',
      children: [
        {
          id: 'permissions',
          title: 'Permissions',
          iconKey: 'permissions',
          scope: 'org',
          inheritable: false,
        },
      ],
    },
    {
      id: 'multi-site-manager-group',
      title: 'Multi-Site Manager',
      iconKey: 'multi-site-manager',
      type: 'group',
      children: [
        {
          id: 'multi-site-manager',
          title: 'Multi-Site Manager',
          iconKey: 'multi-site-manager',
          scope: 'org',
          inheritable: false,
        },
      ],
    },
    {
      id: 'authoring-experience-group',
      title: 'Authoring Experience',
      iconKey: 'universal-editor',
      type: 'group',
      children: [
        {
          id: 'experience-workspace',
          title: 'Experience Workspace',
          iconKey: 'universal-editor',
          scope: 'both',
          inheritable: true,
        },
        {
          id: 'editor-config',
          title: 'Editor Config',
          iconKey: 'universal-editor',
          scope: 'both',
          inheritable: true,
        },
      ],
    },
    {
      id: 'integrations-group',
      title: 'Integrations',
      iconKey: 'integrations',
      type: 'group',
      children: [
        {
          id: 'aem-assets',
          title: 'AEM Assets',
          iconKey: 'aem-assets',
          scope: 'both',
          inheritable: true,
        },
      ],
    },
  ],

  SITE: [
    {
      id: 'library-group',
      title: 'Library',
      iconKey: 'library',
      type: 'group',
      children: [
        {
          id: 'blocks',
          title: 'Blocks',
          iconKey: 'blocks',
          scope: 'site',
          inheritable: false,
        },
        {
          id: 'templates',
          title: 'Templates',
          iconKey: 'templates',
          scope: 'site',
          inheritable: false,
        },
        {
          id: 'icons',
          title: 'Icons',
          iconKey: 'icons',
          scope: 'site',
          inheritable: false,
        },
        {
          id: 'placeholders',
          title: 'Placeholders',
          iconKey: 'placeholders',
          scope: 'site',
          inheritable: false,
        },
      ],
    },
    {
      id: 'translation-group',
      title: 'Translation',
      iconKey: 'translation',
      type: 'group',
      children: [
        {
          id: 'translation',
          title: 'Translation',
          iconKey: 'translation',
          scope: 'site',
          inheritable: false,
        },
      ],
    },
  ],
};

class ConfigConsoleApp extends LitElement {
  static properties = {
    context: { attribute: false },
    token: { attribute: false },
    _state: { state: true },
    _org: { state: true },
    _site: { state: true },
    _orgInput: { state: true },
    _siteInput: { state: true },
    _currentSection: { state: true },
    _sectionComponent: { state: true },
    _error: { state: true },
    _expandedGroups: { state: true },
    _sidebarCollapsed: { state: true },
    _recentPaths: { state: true },
    _availableSites: { state: true },
    _fetchingSites: { state: true },
  };

  constructor() {
    super();
    this._state = 'idle';
    this._org = '';
    this._site = '';
    this._orgInput = '';
    this._siteInput = '';
    this._currentSection = null;
    this._sectionComponent = null;
    this._error = null;
    this._expandedGroups = this._loadExpandedState();
    this._sidebarCollapsed = this._loadSidebarState();
    this._recentPaths = this._loadRecentPaths();
    this._availableSites = [];
    this._fetchingSites = false;
    this._fetchSitesDebounceTimer = null;
  }

  // eslint-disable-next-line class-methods-use-this -- sessionStorage access is stateless
  _loadExpandedState() {
    try {
      const saved = sessionStorage.getItem('config-console-expanded');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }

  _saveExpandedState() {
    try {
      sessionStorage.setItem('config-console-expanded', JSON.stringify(this._expandedGroups));
    } catch {
      // SessionStorage failed - continue without persistence
    }
  }

  // eslint-disable-next-line class-methods-use-this -- localStorage access is stateless
  _loadSidebarState() {
    try {
      const saved = localStorage.getItem('config-console-sidebar-collapsed');
      // If no saved state, default to collapsed
      if (saved === null) return true;
      return saved === 'true';
    } catch {
      return true; // Default to collapsed
    }
  }

  _saveSidebarState() {
    try {
      localStorage.setItem('config-console-sidebar-collapsed', String(this._sidebarCollapsed));
    } catch {
      // localStorage failed - continue without persistence
    }
  }

  // eslint-disable-next-line class-methods-use-this -- localStorage access is stateless
  _loadRecentPaths() {
    try {
      // Load from our own storage (config-console-recent)
      // NOTE: We cannot read da.live's "da-sites" localStorage due to cross-origin policy
      // since this app is never loaded from da.live domain. Sites are fetched from API instead.
      // Try sessionStorage first (more reliable), fallback to localStorage
      const rawValue = sessionStorage.getItem('config-console-recent')
        || localStorage.getItem('config-console-recent');

      const configSites = JSON.parse(rawValue || '[]');

      const parsed = configSites.map((path) => {
        const parts = path.split('/');
        return {
          path,
          org: parts[0] || '',
          site: parts[1] || '',
        };
      }).filter((item) => item.org);

      return parsed;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[ConfigConsole] Failed to load recent paths:', error);
      return [];
    }
  }

  _saveRecentPath(org, site) {
    const path = site ? `${org}/${site}` : org;

    try {
      // Load from both storages to merge
      const sessionRecent = JSON.parse(sessionStorage.getItem('config-console-recent') || '[]');
      const localRecent = JSON.parse(localStorage.getItem('config-console-recent') || '[]');
      const recent = [...new Set([...sessionRecent, ...localRecent])];

      const updated = [path, ...recent.filter((p) => p !== path)].slice(0, 10);

      // Always save to sessionStorage (more reliable)
      sessionStorage.setItem('config-console-recent', JSON.stringify(updated));

      // Try to save to localStorage as well (for persistence across sessions)
      try {
        localStorage.setItem('config-console-recent', JSON.stringify(updated));
      } catch {
        // localStorage full, sessionStorage still works
      }

      this._recentPaths = this._loadRecentPaths();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[ConfigConsole] Failed to save recent path:', error);

      // Update in-memory only as last resort
      this._recentPaths = [{
        path,
        org,
        site: site || '',
      }];
    }
  }

  async _fetchSitesForOrg(org) {
    // Clear previous timer
    if (this._fetchSitesDebounceTimer) {
      clearTimeout(this._fetchSitesDebounceTimer);
    }

    // Don't fetch if org is too short
    if (!org || org.length < 2) {
      this._availableSites = [];
      return;
    }

    // Debounce: wait 500ms after last keystroke
    this._fetchSitesDebounceTimer = setTimeout(async () => {
      try {
        this._fetchingSites = true;

        const sites = await fetchSiteList(org);

        this._availableSites = sites || [];
        this._fetchingSites = false;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[ConfigConsole] Failed to fetch sites:', error);
        this._availableSites = [];
        this._fetchingSites = false;
      }
    }, 500);
  }

  _toggleSidebar() {
    this._sidebarCollapsed = !this._sidebarCollapsed;
    this._saveSidebarState();
  }

  _toggleGroup(groupId) {
    // If sidebar is collapsed, expand it first
    if (this._sidebarCollapsed) {
      this._sidebarCollapsed = false;
      this._saveSidebarState();
    }
    this._expandedGroups = {
      ...this._expandedGroups,
      [groupId]: !this._expandedGroups[groupId],
    };
    this._saveExpandedState();
  }

  connectedCallback() {
    super.connectedCallback();
    const sheets = [nexter, sl, styles].filter(Boolean);
    this.shadowRoot.adoptedStyleSheets = sheets;

    // Handle hash-based routing
    window.addEventListener('hashchange', () => this._handleRouteChange());
    this._handleRouteChange();

    // Try DA SDK first, then fall back to URL params
    this._initContext();
  }

  async _initContext() {
    // Get token from DA SDK if available (but don't use org/site context)
    try {
      const { token } = await Promise.race([
        DA_SDK,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('DA SDK timeout')), 2000);
        }),
      ]);
      this.token = token;
    } catch {
      // DA SDK not available
    }

    // Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const urlOrg = (urlParams.get('org') || '').trim();
    const urlSite = (urlParams.get('site') || '').trim();

    // If URL params provided, use them
    if (urlOrg) {
      this._orgInput = urlOrg;
      this._siteInput = urlSite;
      this._loadContext(urlOrg, urlSite);
      return;
    }

    // No URL params - auto-load from most recent localStorage entry
    if (this._recentPaths.length > 0) {
      const mostRecent = this._recentPaths[0];
      const org = mostRecent.org || '';
      const site = mostRecent.site || '';

      // Pre-populate inputs and auto-load context
      this._orgInput = org;
      this._siteInput = site;

      // Trigger site fetch for autocomplete
      if (org) {
        this._fetchSitesForOrg(org);
      }

      // Auto-load the context (same as if user clicked Load)
      if (org) {
        this._loadContext(org, site);
        return;
      }
    }

    this._state = 'idle';
  }

  async _loadContext(org, site = '') {
    this._state = 'loading';
    this._error = null;

    // Step 1: Always validate org first
    const orgValid = await this._validateOrg(org);
    if (!orgValid) {
      this._state = 'idle';
      this._org = '';
      this._site = '';
      // Error already set by _validateOrg
      return;
    }

    // Org is valid, set it
    this._org = org;
    this._site = ''; // Clear site when loading new org

    // Step 2: If site provided, validate it
    if (site) {
      const siteValid = await this._validateSite(org, site);
      if (siteValid) {
        // Site is valid, set it
        this._site = site;
      }
      // If site invalid, error is set but we continue with org-only sections
    }

    // Update URL
    this._updateURL(this._org, this._site);

    // Save to recent paths
    this._saveRecentPath(this._org, this._site);

    // Track load
    sampleRUM('config-console-load', { org: this._org, site: this._site, source: 'manual' });

    this._state = 'ready';

    // Re-process hash navigation now that context is loaded
    this._handleRouteChange();
  }

  async _validateOrg(org) {
    try {
      const listUrl = `https://admin.da.live/list/${org}/`;
      const response = await fetch(listUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          this._error = `Organization not found: /${org}. Please check the path.`;
          return false;
        }
        if (response.status === 403) {
          this._error = `Access denied to /${org}. Check your token permissions.`;
          return false;
        }
        this._error = `Failed to access /${org}: ${response.status}`;
        return false;
      }

      // Check response body - org returns direct array of sites
      const data = await response.json();

      if (data?.error || !Array.isArray(data)) {
        this._error = `Organization not found: /${org}. Please check the path.`;
        return false;
      }

      return true;
    } catch (error) {
      this._error = `Failed to validate org: ${error.message}`;
      return false;
    }
  }

  async _validateSite(org, site) {
    try {
      const listUrl = `https://admin.da.live/list/${org}/${site}/`;
      const response = await fetch(listUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          this._error = `Site not found: /${org}/${site}. Showing org-level sections only.`;
          return false;
        }
        if (response.status === 403) {
          this._error = `Access denied to /${org}/${site}. Showing org-level sections only.`;
          return false;
        }
        this._error = `Failed to access /${org}/${site}: ${response.status}`;
        return false;
      }

      // Check response body - site returns { data: {...} }
      const data = await response.json();

      // Site validation is trickier - the list endpoint returns different structures
      // For sites, we should get { data: {...} } but might get an array or other structure
      const isValidSite = (data?.data && typeof data.data === 'object')
        || (Array.isArray(data) && data.length > 0);

      if (data?.error || !isValidSite) {
        this._error = `Site not found: /${org}/${site}. Showing org-level sections only.`;
        return false;
      }

      return true;
    } catch (error) {
      this._error = `Failed to validate site: ${error.message}`;
      return false;
    }
  }

  _getFirstAvailableSection() {
    // Default to "blocks" section
    const blocksSection = this._availableSections.find((section) => {
      if (section.type === 'group' && section.children) {
        return section.children.some((child) => child.id === 'blocks');
      }
      return section.id === 'blocks';
    });

    if (blocksSection) {
      if (blocksSection.type === 'group' && blocksSection.children) {
        return blocksSection.children.find((child) => child.id === 'blocks');
      }
      return blocksSection;
    }

    // Fallback to first available section if blocks not found
    const fallbackSection = this._availableSections.find((section) => {
      if (section.type === 'group' && section.children && section.children.length > 0) {
        return true;
      }
      return section.type !== 'group';
    });

    if (fallbackSection?.type === 'group' && fallbackSection.children) {
      return fallbackSection.children[0];
    }
    return fallbackSection || null;
  }

  // eslint-disable-next-line class-methods-use-this -- URL update is stateless utility
  _updateURL(org, site) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('org', org);
      if (site) {
        url.searchParams.set('site', site);
      } else {
        url.searchParams.delete('site');
      }
      window.history.replaceState(null, '', url);
    } catch {
      // URL update failed - non-critical
    }
  }

  _handleOrgInput(e) {
    this._orgInput = e.target.value;

    // Find the most recent site used with this org
    const lastUsedSite = this._recentPaths.find((p) => p.org === e.target.value)?.site || '';

    // Pre-populate site input with last used site for this org
    this._siteInput = lastUsedSite;

    // Fetch sites for autocomplete
    this._fetchSitesForOrg(e.target.value);
  }

  _handleLoadClick() {
    const org = this._orgInput.trim();

    if (!org) {
      this._error = 'Please enter an organization';
      return;
    }

    const site = this._siteInput.trim();
    this._loadContext(org, site);
  }

  async _handleBrowseSites() {
    const org = this._orgInput.trim();

    if (!org) {
      this._error = 'Please enter an organization first';
      return;
    }

    // Validate org exists
    this._state = 'loading';
    const orgValid = await this._validateOrg(org);
    this._state = 'idle';

    if (!orgValid) {
      return; // Error already set by _validateOrg
    }

    // Open site picker
    this._openSitePicker(org);
  }

  async _openSitePicker(org) {
    // Import and show site picker modal
    await import('./shared/components/site-picker.js');

    const picker = document.createElement('site-picker');
    picker.org = org;
    picker.open = true;
    picker.addEventListener('site-selected', (e) => {
      this._siteInput = e.detail.site;
      picker.remove();
      this.requestUpdate();
    });
    picker.addEventListener('close', () => {
      picker.remove();
    });
    document.body.appendChild(picker);
  }

  _handleRouteChange() {
    const hash = window.location.hash.slice(1); // Remove #

    if (hash && hash !== this._currentSection) {
      this._navigateToSection(hash);
    }
  }

  get _availableSections() {
    const sections = [];
    if (this._org) sections.push(...SECTIONS.ORG);
    if (this._org && this._site) sections.push(...SECTIONS.SITE);
    return sections;
  }

  async _navigateToSection(sectionId) {
    // Find section in hierarchical structure (could be in children)
    let section = null;
    const foundItem = this._availableSections.find((item) => {
      if (item.id === sectionId) {
        return true;
      }
      if (item.type === 'group' && item.children) {
        return item.children.some((c) => c.id === sectionId);
      }
      return false;
    });

    if (foundItem) {
      if (foundItem.id === sectionId) {
        section = foundItem;
      } else if (foundItem.type === 'group' && foundItem.children) {
        const child = foundItem.children.find((c) => c.id === sectionId);
        if (child) {
          section = child;
          // Accordion behavior: collapse all groups, expand only this one
          this._expandedGroups = { [foundItem.id]: true };
          this._saveExpandedState();
        }
      }
    }

    if (!section || section.type === 'group') {
      // Don't navigate to group items, only to actual sections
      return;
    }

    this._currentSection = sectionId;
    this._sectionComponent = null;
    this._error = null; // Clear any previous errors

    // Track section view
    sampleRUM('config-section', {
      section: sectionId,
      org: this._org,
      site: this._site,
    });

    // Dynamic import
    try {
      await import(`./sections/${sectionId}/${sectionId}.js`);
      // Store the tag name instead of the class reference
      this._sectionComponent = `${sectionId}-section`;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ConfigConsole] Failed to load section:', sectionId, err);
      this._error = `Failed to load ${section.title} section. Please try again.`;
    }
  }

  _handleNavClick(sectionId) {
    // If sidebar is collapsed, expand it first
    if (this._sidebarCollapsed) {
      this._sidebarCollapsed = false;
      this._saveSidebarState();
    }
    window.location.hash = sectionId;
  }

  // Helper to render Spectrum SVG icons
  // eslint-disable-next-line class-methods-use-this
  _renderIcon(iconKey, title = '') {
    const iconPath = SPECTRUM_ICONS[iconKey];
    if (!iconPath) return nothing;

    return html`
      <img
        class="nav-icon"
        src="${iconPath}"
        alt="${title || iconKey}"
        width="18"
        height="18"
        aria-hidden="true"
      />
    `;
  }

  _renderToolbar() {
    const orgSuggestions = [...new Set(this._recentPaths.map((p) => p.org))];

    // Merge API-fetched sites with recent sites for the current org
    const recentSitesForOrg = this._recentPaths
      .filter((p) => p.org === this._orgInput && p.site)
      .map((p) => p.site);

    const siteSuggestions = this._orgInput
      ? [...new Set([...recentSitesForOrg, ...this._availableSites])]
      : [];

    return html`
      <div class="console-toolbar">
        <div class="console-toolbar-fields">
          <div class="console-toolbar-input-group">
            <label for="org-input">Organization</label>
            <input
              id="org-input"
              type="text"
              placeholder="org"
              list="org-suggestions"
              .value=${this._orgInput}
              @input=${this._handleOrgInput}
              @keydown=${(e) => { if (e.key === 'Enter') this._handleLoadClick(); }}
            />
            <datalist id="org-suggestions">
              ${orgSuggestions.map((org) => html`<option value="${org}"></option>`)}
            </datalist>
          </div>
          <div class="console-toolbar-input-group">
            <label for="site-input">Site (optional)</label>
            <input
              id="site-input"
              type="text"
              placeholder="site"
              list="site-suggestions"
              .value=${this._siteInput}
              @input=${(e) => { this._siteInput = e.target.value; }}
              @keydown=${(e) => { if (e.key === 'Enter') this._handleLoadClick(); }}
            />
            <datalist id="site-suggestions">
              ${siteSuggestions.map((site) => html`<option value="${site}"></option>`)}
            </datalist>
          </div>
          <sl-button
            @click=${this._handleLoadClick}
            ?disabled=${!this._orgInput.trim() || this._state === 'loading'}
          >
            ${this._state === 'loading' ? 'Loading...' : 'Load'}
          </sl-button>
        </div>
        ${this._error ? html`
          <div class="console-toolbar-error">${this._error}</div>
        ` : nothing}
      </div>
    `;
  }

  _renderNav() {
    return html`
      <div class="console-nav-header">
        ${!this._sidebarCollapsed ? html`
          <div class="console-title-small">Config Console</div>
        ` : nothing}
        <button
          class="nav-collapse-button"
          @click=${this._toggleSidebar}
          title="${this._sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
          aria-label="${this._sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"
        >
          ${this._renderIcon(this._sidebarCollapsed ? 'expand' : 'collapse')}
        </button>
      </div>

      <nav class="console-nav-items">
        ${this._availableSections.map((section) => this._renderNavItem(section))}
      </nav>
    `;
  }

  _renderNavItem(section) {
    if (section.type === 'group') {
      const isExpanded = this._expandedGroups[section.id];
      return html`
        <div class="nav-group">
          <button
            class="nav-group-header"
            @click=${() => this._toggleGroup(section.id)}
            title="${this._sidebarCollapsed ? section.title : ''}"
          >
            ${this._renderIcon(section.iconKey, section.title)}
            <span class="nav-expand-icon">${isExpanded ? '▼' : '▶'}</span>
            ${!this._sidebarCollapsed ? html`<span class="nav-title">${section.title}</span>` : nothing}
          </button>
          ${isExpanded && section.children && !this._sidebarCollapsed ? html`
            <div class="nav-group-children">
              ${section.children.map((child) => html`
                <button
                  class="nav-item nav-item-child ${this._currentSection === child.id ? 'active' : ''}"
                  @click=${() => this._handleNavClick(child.id)}
                  title="${this._sidebarCollapsed ? child.title : ''}"
                >
                  ${this._renderIcon(child.iconKey, child.title)}
                  ${!this._sidebarCollapsed ? html`<span class="nav-title">${child.title}</span>` : nothing}
                </button>
              `)}
            </div>
          ` : nothing}
        </div>
      `;
    }
    // Fallback for non-grouped items (backward compatibility)
    return html`
      <button
        class="nav-item ${this._currentSection === section.id ? 'active' : ''}"
        @click=${() => this._handleNavClick(section.id)}
        title="${this._sidebarCollapsed ? section.title : ''}"
      >
        ${this._renderIcon(section.iconKey, section.title)}
        ${!this._sidebarCollapsed ? html`<span class="nav-title">${section.title}</span>` : nothing}
      </button>
    `;
  }

  _renderWelcome() {
    const hasOrg = this._org && this._state === 'ready';
    const hasSite = hasOrg && this._site;

    return html`
      <div class="welcome-container">
        <div class="welcome-hero">
          <p class="welcome-eyebrow">Configuration Console</p>
          <h1 class="welcome-title">Set up and manage your ${hasSite ? 'site' : 'sites'}</h1>
          <p class="welcome-body">Choose an organization${hasSite ? ' and site' : ''} to manage permissions, authoring library items, and integrations for your authoring experience.</p>

          ${!hasOrg ? html`
            <div class="welcome-actions">
              <button class="welcome-cta-primary" @click=${() => {
    const input = this.shadowRoot.querySelector('.console-toolbar sl-input');
    input?.focus();
  }}>Select organization</button>
              <a
                href="https://docs.da.live"
                target="_blank"
                rel="noopener noreferrer"
                class="welcome-cta-secondary"
              >DA documentation</a>
            </div>
          ` : nothing}
        </div>

        ${hasOrg ? html`
          <div class="welcome-cards">
            <div class="welcome-card">
              <div class="welcome-card-header">
                <div class="welcome-card-icon">
                  ${this._renderIcon('permissions')}
                </div>
                <h3 class="welcome-card-title">Permissions & Sites</h3>
              </div>
              <p class="welcome-card-body">Control user access to repositories and configure Multi-Site Manager for enterprise content workflows.</p>
              <div class="welcome-card-actions">
                <button
                  class="welcome-card-action"
                  @click=${() => this._handleNavClick('permissions')}
                >Manage access</button>
              </div>
            </div>

            <div class="welcome-card">
              <div class="welcome-card-header">
                <div class="welcome-card-icon">
                  ${this._renderIcon('library')}
                </div>
                <h3 class="welcome-card-title">${hasSite ? 'Library Setup' : 'Editor Configuration'}</h3>
              </div>
              <p class="welcome-card-body">Configure blocks, templates, icons, and placeholders${hasSite ? ' that authors use while creating pages' : ' at organization or site level'}.</p>
              <div class="welcome-card-actions">
                <button
                  class="welcome-card-action"
                  @click=${() => this._handleNavClick(hasSite ? 'blocks' : 'editor-config')}
                >${hasSite ? 'Review library' : 'Configure editor'}</button>
              </div>
            </div>

            <div class="welcome-card">
              <div class="welcome-card-header">
                <div class="welcome-card-icon">
                  ${this._renderIcon('universal-editor')}
                </div>
                <h3 class="welcome-card-title">Authoring & Integrations</h3>
              </div>
              <p class="welcome-card-body">Configure Experience Workspace for AI-powered authoring and connect services like AEM Assets${hasSite ? ' and Translation' : ''}.</p>
              <div class="welcome-card-actions">
                <button
                  class="welcome-card-action"
                  @click=${() => this._handleNavClick('experience-workspace')}
                >Configure authoring</button>
                <button
                  class="welcome-card-action"
                  @click=${() => this._handleNavClick('aem-assets')}
                >Configure integrations</button>
              </div>
            </div>
          </div>
        ` : html`
          <div class="welcome-empty-state">
            <p>Select an organization and site above to view available configuration options.</p>
          </div>
        `}
      </div>
    `;
  }

  _renderMain() {
    if (this._state === 'idle') {
      return html`
        <div class="empty-state">
          <h2>Welcome to Configuration Console</h2>
          <p>Enter an organization and optional site above to get started.</p>
        </div>
      `;
    }

    // Show loading only if we don't have a section loaded yet
    if (this._state === 'loading' && !this._sectionComponent) {
      return html`
        <div class="loading-container">
          <div class="spectrum-loading-indicator"></div>
          <p class="loading-label">Loading Configuration Console...</p>
        </div>
      `;
    }

    if (this._state === 'error') {
      return html`
        <div class="error-container">
          <p class="error-message">${this._error}</p>
        </div>
      `;
    }

    if (!this._currentSection) {
      return this._renderWelcome();
    }

    // Don't block section rendering just because there's an error
    // (e.g., site invalid but org valid - should still show org sections)
    // Errors are already displayed in the toolbar

    if (!this._sectionComponent) {
      return html`
        <div class="loading-container">
          <div class="spectrum-loading-indicator"></div>
          <p class="loading-label">Loading section...</p>
        </div>
      `;
    }

    // Render a container for the section component
    // The actual component will be created imperatively in updated()
    return html`<div class="section-container"></div>`;
  }

  updated(changedProperties) {
    super.updated(changedProperties);

    // If section component changed, create and attach the custom element
    if (changedProperties.has('_sectionComponent') && this._sectionComponent) {
      const container = this.shadowRoot.querySelector('.section-container');
      if (container) {
        // Clear previous content
        container.innerHTML = '';

        // Create the section element
        const sectionEl = document.createElement(this._sectionComponent);
        sectionEl.org = this._org;
        sectionEl.site = this._site;
        sectionEl.token = this.token;
        sectionEl.context = this.context;

        // Append to container
        container.appendChild(sectionEl);
      }
    } else if ((changedProperties.has('_org') || changedProperties.has('_site'))
        && this._sectionComponent) {
      // If org/site changed and we have a section loaded, update the section element
      const container = this.shadowRoot.querySelector('.section-container');
      const sectionEl = container?.querySelector(this._sectionComponent);

      if (sectionEl) {
        sectionEl.org = this._org;
        sectionEl.site = this._site;
        sectionEl.token = this.token;
        sectionEl.context = this.context;

        // Trigger loadData if the section has it
        if (typeof sectionEl.loadData === 'function') {
          sectionEl.loadData();
        }
      }
    }
  }

  render() {
    return html`
      <div class="console-layout">
        ${this._renderToolbar()}
        <aside class="console-nav ${this._sidebarCollapsed ? 'collapsed' : ''}">
          ${this._renderNav()}
        </aside>
        <main class="console-main">
          ${this._renderMain()}
        </main>
      </div>
    `;
  }
}

customElements.define('config-console-app', ConfigConsoleApp);

// Initialize app
const app = document.createElement('config-console-app');
document.body.appendChild(app);
