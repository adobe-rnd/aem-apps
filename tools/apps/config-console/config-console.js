// External imports from da.live CDN and importmap - unresolved at lint time
/* eslint-disable import/no-unresolved */
// Lit Element uses underscore prefix for private/reactive properties (_state, _org, etc)
/* eslint-disable no-underscore-dangle */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';

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

// Section definitions
const SECTIONS = {
  ORG: [
    {
      id: 'permissions',
      title: 'Permissions',
      icon: '🔒',
      scope: 'org',
      inheritable: false,
    },
  ],

  SITE: [
    {
      id: 'library',
      title: 'Library Settings',
      icon: '⚙️',
      scope: 'site',
      inheritable: true,
    },
    {
      id: 'blocks',
      title: 'Blocks',
      icon: '🧱',
      scope: 'site',
      inheritable: false,
    },
    {
      id: 'templates',
      title: 'Templates',
      icon: '📄',
      scope: 'site',
      inheritable: false,
    },
    {
      id: 'icons',
      title: 'Icons',
      icon: '🎨',
      scope: 'site',
      inheritable: false,
    },
    {
      id: 'placeholders',
      title: 'Placeholders',
      icon: '🏷️',
      scope: 'site',
      inheritable: false,
    },
    {
      id: 'aem-assets',
      title: 'AEM Assets',
      icon: '📦',
      scope: 'both',
      inheritable: true,
    },
    {
      id: 'translation',
      title: 'Translation',
      icon: '🌐',
      scope: 'both',
      inheritable: true,
    },
    {
      id: 'universal-editor',
      title: 'Universal Editor',
      icon: '✏️',
      scope: 'both',
      inheritable: true,
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
    // Try DA SDK first
    try {
      const { context, token } = await Promise.race([
        DA_SDK,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('DA SDK timeout')), 2000);
        }),
      ]);

      if (context?.org) {
        this.context = context;
        this.token = token;
        this._org = context.org;
        this._site = context.repo || '';
        this._orgInput = this._org;
        this._siteInput = this._site;
        this._state = 'ready';
        sampleRUM('config-console-load', { org: this._org, site: this._site, source: 'sdk' });
        return;
      }
    } catch {
      // DA SDK failed or timed out, fall back to URL params
    }

    // Fall back to URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const org = (urlParams.get('org') || '').trim();
    const site = (urlParams.get('site') || '').trim();

    if (org) {
      this._orgInput = org;
      this._siteInput = site;
      this._loadContext(org, site);
    } else {
      // No context available - show manual entry
      this._state = 'idle';
    }
  }

  _loadContext(org, site = '') {
    this._state = 'loading';
    this._org = org;
    this._site = site;
    this._error = null;

    // Update URL
    this._updateURL(org, site);

    // Track load
    sampleRUM('config-console-load', { org, site, source: 'manual' });

    this._state = 'ready';

    // eslint-disable-next-line no-console
    console.log('[DEBUG] Context loaded:', { org, site, availableSections: this._availableSections.length });

    // Re-process hash navigation now that context is loaded
    this._handleRouteChange();
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

  _handleLoadClick() {
    const org = this._orgInput.trim();
    const site = this._siteInput.trim();

    if (!org) {
      this._error = 'Please enter an organization';
      return;
    }

    this._loadContext(org, site);
  }

  _handleRouteChange() {
    const hash = window.location.hash.slice(1); // Remove #

    // eslint-disable-next-line no-console
    console.log('[DEBUG] Route change:', {
      hash,
      currentSection: this._currentSection,
      willNavigate: hash && hash !== this._currentSection,
      availableSections: this._availableSections.map((s) => s.id),
    });

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
    // Validate section exists and is available
    const section = this._availableSections.find((s) => s.id === sectionId);

    // eslint-disable-next-line no-console
    console.log('[DEBUG] Navigate to section:', { sectionId, found: !!section });

    if (!section) {
      return;
    }

    this._currentSection = sectionId;
    this._sectionComponent = null;

    // Track section view
    sampleRUM('config-section', {
      section: sectionId,
      org: this._org,
      site: this._site,
    });

    // Dynamic import
    try {
      // eslint-disable-next-line no-console
      console.log('[DEBUG] Loading module:', `./sections/${sectionId}/${sectionId}.js`);
      await import(`./sections/${sectionId}/${sectionId}.js`);
      // Store the tag name instead of the class reference
      this._sectionComponent = `${sectionId}-section`;
      // eslint-disable-next-line no-console
      console.log('[DEBUG] Module loaded successfully, tag:', this._sectionComponent);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[DEBUG] Failed to load module:', err);
      this._error = `Failed to load ${section.title} section. Please try again.`;
    }
  }

  // Navigation handler doesn't need instance state
  // eslint-disable-next-line class-methods-use-this
  _handleNavClick(sectionId) {
    window.location.hash = sectionId;
  }

  _renderToolbar() {
    return html`
      <div class="console-toolbar">
        <div class="console-toolbar-fields">
          <sl-input
            type="text"
            placeholder="Organization"
            .value=${this._orgInput}
            @input=${(e) => { this._orgInput = e.target.value; }}
            @keydown=${(e) => { if (e.key === 'Enter') this._handleLoadClick(); }}
          ></sl-input>
          <sl-input
            type="text"
            placeholder="Site (optional)"
            .value=${this._siteInput}
            @input=${(e) => { this._siteInput = e.target.value; }}
            @keydown=${(e) => { if (e.key === 'Enter') this._handleLoadClick(); }}
          ></sl-input>
          <sl-button
            @click=${this._handleLoadClick}
            ?disabled=${!this._orgInput.trim()}
          >
            Load
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
        <h1 class="console-title">Configuration Console</h1>
        <div class="console-context">
          ${this._org ? html`<span class="context-org">${this._org}</span>` : nothing}
          ${this._site ? html`<span class="context-separator">/</span><span class="context-site">${this._site}</span>` : nothing}
        </div>
      </div>

      <nav class="console-nav-items">
        ${this._availableSections.length === 0 ? html`
          <p class="nav-empty">No sections available. Please select an org/site.</p>
        ` : nothing}

        ${this._availableSections.map((section) => html`
          <button
            class="nav-item ${this._currentSection === section.id ? 'active' : ''}"
            @click=${() => this._handleNavClick(section.id)}
          >
            <span class="nav-icon">${section.icon}</span>
            <span class="nav-title">${section.title}</span>
          </button>
        `)}
      </nav>
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

    if (this._state === 'loading') {
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
      return html`
        <div class="empty-state">
          <h2>Welcome to Configuration Console</h2>
          <p>Select a section from the navigation to get started.</p>
        </div>
      `;
    }

    if (this._error && this._currentSection) {
      return html`
        <div class="section-error">
          <p>${this._error}</p>
          <button @click=${() => { this._error = null; this._navigateToSection(this._currentSection); }}>
            Retry
          </button>
        </div>
      `;
    }

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

        // eslint-disable-next-line no-console
        console.log('[DEBUG] Section element created and attached:', this._sectionComponent);
      }
    }
  }

  render() {
    // eslint-disable-next-line no-console
    console.log('[DEBUG] Render:', {
      state: this._state,
      org: this._org,
      site: this._site,
      currentSection: this._currentSection,
      hasComponent: !!this._sectionComponent,
    });

    return html`
      <div class="console-layout">
        ${this._renderToolbar()}
        <aside class="console-nav">
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

// eslint-disable-next-line no-console
console.log('[DEBUG] App initialized and appended to body');
