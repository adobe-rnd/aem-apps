/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable no-underscore-dangle, import/no-unresolved, no-console */
/* eslint-disable class-methods-use-this, indent */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import {
  readConfig, writeConfig, checkSiteExists, getRegistration, saveRegistration,
  getWorkflowConfig, saveWorkflowConfig,
} from './api.js';
import {
  RULES, STEPS, SETTINGS, GROUPS, emptyConfig, rowsOf, toList,
  detectVersion, installState, rowsToReplace, applyInstall, tabsToConfig,
  readRules, rulesToRows, readWorkflows, workflowsToRows, readGroups, groupsToRows,
  missingGroups, emailAddresses, suggestDomains, describeProblem,
  readSettings, settingsValues, guidanceItems, settingsToRows,
} from './model.js';

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

const PROVIDER_LABELS = { default: 'Default (Adobe)', 'custom-api': 'Custom API', gmail: 'Gmail' };
const CUSTOM_API_FIELDS = ['apiUrl', 'apiKey', 'fromAddress', 'fromName'];
const UNAVAILABLE = "The publish requests service didn't answer.";
const VERSION_LABELS = { v1: 'Request publish v1', v2: 'Request publish v2' };
const VERSION_DOCS = {
  v1: 'https://www.aem.live/docs/ew/administering/request-publish',
  v2: 'https://www.aem.live/docs/ew/administering/request-publish-v2',
};
const NO_ACCESS = 'You need config admin rights for this site to change its setup. Ask a config admin.';

const ok = (text) => ({ tone: 'positive', text });
const todo = (text) => ({ tone: 'negative', text });
const info = (text) => ({ tone: 'neutral', text });

const blankRule = () => ({
  pattern: '', workflow: '', approvers: '', cc: '',
});
const blankStep = () => ({
  title: '', description: '', approvers: '', cc: '', ccCanApprove: false,
});

function parseOrgSite(raw) {
  const parts = (raw || '').trim().split('/').filter(Boolean);
  return parts.length === 2 ? { org: parts[0], site: parts[1] } : null;
}

class PublishRequestsSetup extends LitElement {
  static properties = {
    _org: { state: true },
    _site: { state: true },
    _orgSiteValue: { state: true },
    _state: { state: true },
    _registration: { state: true },
    _siteConfig: { state: true },
    _orgConfig: { state: true },
    _workflow: { state: true },
    _workflowError: { state: true },
    _readOnly: { state: true },
    _open: { state: true },
    _draft: { state: true },
    _saving: { state: true },
    _message: { state: true },
  };

  constructor() {
    super();
    this._state = 'idle';
    this._orgSiteValue = '';
    this._open = null;
    this._draft = null;
    this._saving = false;
    this._message = null;
    this._readOnly = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);
    const params = new URLSearchParams(window.location.search);
    const org = params.get('org');
    const site = params.get('site');
    if (org && site) this.loadSite(org, site);
  }

  get version() {
    return detectVersion(this._siteConfig) || detectVersion(this._orgConfig);
  }

  get apiVersion() {
    return this.version === 'v1' ? 'v1' : 'v2';
  }

  get source() {
    return this._workflow?.active;
  }

  get activeConfig() {
    const tabs = this.source === 'org' ? this._workflow?.orgTabs : this._workflow?.siteTabs;
    return tabsToConfig(tabs) || {};
  }

  get workflowNames() {
    return readWorkflows(this.activeConfig).map((w) => w.name);
  }

  get canEdit() {
    return !this._readOnly && !this._saving;
  }

  updateUrl() {
    try {
      const current = new URLSearchParams(window.location.search);
      const params = new URLSearchParams({ org: this._org, site: this._site });
      ['env', 'ref'].forEach((key) => { if (current.has(key)) params.set(key, current.get(key)); });
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    } catch { /* cross-origin iframe */ }
  }

  async loadSite(org, site) {
    this._org = org;
    this._site = site;
    this._orgSiteValue = `/${org}/${site}`;
    this._state = 'loading';
    this._open = null;
    this._message = null;
    this._readOnly = false;
    const [exists, registration, siteRead, orgRead] = await Promise.all([
      checkSiteExists(org, site),
      getRegistration(org, site, this.token),
      readConfig(org, site),
      readConfig(org),
    ]);
    if (!exists) {
      this._state = 'site-not-found';
      return;
    }
    this._registration = registration;
    this._siteConfig = siteRead.config;
    this._orgConfig = orgRead.config;
    await this.loadWorkflow();
    this._readOnly = [401, 403].includes(siteRead.status)
      || registration.config?.canEdit === false
      || this._workflow?.canEdit === false;
    this._state = 'ready';
  }

  async loadWorkflow() {
    const { ok: loaded, data } = await getWorkflowConfig(
      this.apiVersion,
      this._org,
      this._site,
      this.token,
    );
    this._workflow = loaded ? data : null;
    this._workflowError = loaded ? '' : (data.error || UNAVAILABLE);
  }

  handleSiteSubmit(e) {
    e?.preventDefault();
    const parsed = parseOrgSite(this.shadowRoot.querySelector('#org-site')?.value);
    if (!parsed) {
      this._message = { section: null, type: 'error', text: 'Enter the organization and site as /org/site.' };
      return;
    }
    this.loadSite(parsed.org, parsed.site).then(() => this.updateUrl());
  }

  // ======== Section editing ========

  openSection(key) {
    this._message = null;
    this._open = key;
    this._draft = this.buildDraft(key);
  }

  closeSection() {
    this._open = null;
    this._draft = null;
  }

  buildDraft(key) {
    const config = this.activeConfig;
    const rules = readRules(config);
    const workflows = readWorkflows(config);
    const groups = readGroups(config);
    if (key === 'registration') {
      const current = this._registration.config;
      const providers = current.availableProviders || [];
      const domains = current.allowedEmailDomains?.length
        ? current.allowedEmailDomains
        : suggestDomains(emailAddresses(rules, workflows, groups));
      return {
        provider: providers.includes(current.emailProvider) ? current.emailProvider : providers[0],
        domains: domains.join(', '),
        acknowledged: false,
      };
    }
    if (key === 'install') {
      return { version: ['v1', 'v2'].includes(this.version) ? this.version : 'v2' };
    }
    if (key === 'rules') {
      const missing = missingGroups(rules, workflows, groups).map((group) => ({ group, email: '' }));
      return {
        rules: rules.length ? rules : [{ ...blankRule(), pattern: '/*' }],
        workflows,
        groups: [...groups, ...missing],
      };
    }
    const settings = readSettings(config);
    return {
      settings, values: settingsValues(settings), items: guidanceItems(settings).join('\n'),
    };
  }

  rerender() {
    this.requestUpdate();
  }

  moveRow(list, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.rerender();
  }

  removeRow(list, i) {
    list.splice(i, 1);
    this.rerender();
  }

  addRow(list, row) {
    list.push(row);
    this.rerender();
  }

  showResult(section, type, text) {
    this._message = { section, type, text };
  }

  async saveConfig(section, change, successText) {
    this._saving = true;
    const { config, status } = await readConfig(this._org, this._site);
    if (!config && status !== 404) {
      this._saving = false;
      if ([401, 403].includes(status)) this._readOnly = true;
      this.showResult(section, 'error', this._readOnly ? NO_ACCESS : `Couldn't read the site config (${status}).`);
      return;
    }
    const next = change(config || emptyConfig());
    const result = await writeConfig(this._org, this._site, next);
    this._saving = false;
    if (!result.ok) {
      if ([401, 403].includes(result.status)) this._readOnly = true;
      this.showResult(section, 'error', this._readOnly ? NO_ACCESS : `Couldn't save the site config (${result.status}).`);
      return;
    }
    this._siteConfig = next;
    this.closeSection();
    this.showResult(section, 'success', successText);
  }

  async saveWorkflowTabs(section, body, successText) {
    this._saving = true;
    const result = await saveWorkflowConfig(this.apiVersion, this._org, this._site, {
      version: this._workflow.version, ...body,
    }, this.token);
    this._saving = false;
    if (result.ok) {
      this._workflow = result.data;
      this.closeSection();
      this.showResult(section, 'success', successText);
      return;
    }
    if (result.status === 409) {
      await this.loadWorkflow();
      this.showResult(section, 'error', 'Someone changed these settings since you opened them. Your edits are still here: save again to replace their changes, or cancel to see them.');
      return;
    }
    if (result.data.code === 'config-write-required') this._readOnly = true;
    const { errors, error } = result.data;
    this.showResult(section, 'error', errors?.length ? errors.map(describeProblem) : error || `Couldn't save (${result.status}).`);
  }

  async saveInstall() {
    const { version } = this._draft;
    await this.saveConfig('install', (c) => applyInstall(c, version), `${VERSION_LABELS[version]} is installed.`);
    await this.loadWorkflow();
  }

  saveRules() {
    const { rules, workflows, groups } = this._draft;
    const tabs = {
      [RULES]: rulesToRows(rules),
      [GROUPS]: groups.length ? groupsToRows(groups) : null,
    };
    if (this.version === 'v2') tabs[STEPS] = workflows.length ? workflowsToRows(workflows) : null;
    this.saveWorkflowTabs('rules', { tabs }, 'Approval rules saved.');
  }

  saveSettings() {
    const { settings, values, items } = this._draft;
    const rows = settingsToRows(settings, values, items.split('\n'));
    this.saveWorkflowTabs('settings', { tabs: { [SETTINGS]: rows.length ? rows : null } }, 'Settings saved.');
  }

  useSiteRules() {
    this.saveWorkflowTabs('rules', { tabs: {}, copyFromOrg: true }, 'The org rules were copied to this site. Edit them here from now on.');
  }

  async saveRegistrationForm(e) {
    e.preventDefault();
    if (!this.canEdit) return;
    const { provider, acknowledged } = this._draft;
    const form = new FormData(e.target);
    const fields = provider === 'custom-api'
      ? Object.fromEntries(CUSTOM_API_FIELDS.map((key) => [key, String(form.get(key) || '').trim()])
        .filter(([, value]) => value))
      : {};
    const domains = toList(this._draft.domains);
    if (provider === 'custom-api' && !domains.length) {
      this.showResult('registration', 'error', 'Add at least one allowed email domain, or emails to your approvers will be blocked.');
      return;
    }
    if (provider === 'default' && !acknowledged) {
      this.showResult('registration', 'error', "Confirm you understand the default provider isn't for production.");
      return;
    }
    this._saving = true;
    const result = await saveRegistration(this._org, this._site, {
      ...fields,
      emailProvider: provider,
      allowedEmailDomains: domains,
      ...(provider === 'default' ? { acknowledgeNonProduction: true } : {}),
    }, this.token);
    this._saving = false;
    if (!result.ok) {
      if (result.data.code === 'config-write-required') this._readOnly = true;
      this.showResult('registration', 'error', result.data.error || `Registration failed (${result.status}).`);
      return;
    }
    this._registration = await getRegistration(this._org, this._site, this.token);
    await this.loadWorkflow();
    this.closeSection();
    this.showResult('registration', 'success', `${this._org}/${this._site} is registered.`);
  }

  // ======== Status ========

  registrationStatus() {
    const { status, config } = this._registration;
    if (status === 'registered') {
      return ok(`Registered · ${PROVIDER_LABELS[config.emailProvider] || config.emailProvider}`);
    }
    if (status === 'unregistered') return todo('Not registered');
    return info("Can't check right now");
  }

  installStatus() {
    const { version } = this;
    if (!version) return todo('Not installed');
    if (version === 'mixed') return todo('v1 and v2 are both installed');
    const site = installState(this._siteConfig, version);
    const org = installState(this._orgConfig, version);
    if (!(site.library || org.library)) return todo(`${version}: plugin missing`);
    if (!(site.apps || org.apps)) return todo(`${version}: inbox missing`);
    return ok(VERSION_LABELS[version]);
  }

  rulesStatus() {
    if (!this._workflow) return info("Can't check right now");
    const config = this.activeConfig;
    const rules = readRules(config);
    const workflows = readWorkflows(config);
    if (!rules.length) return todo('No rules');
    const errors = this._workflow.validation?.errors || [];
    if (errors.length) return todo(`${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}`);
    const missing = missingGroups(rules, workflows, readGroups(config));
    if (missing.length) return todo(`Missing list: ${missing.join(', ')}`);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return ok([
      plural(rules.length, 'rule'),
      this.version === 'v2' && workflows.length ? plural(workflows.length, 'workflow') : '',
      this.source === 'org' ? 'from org' : '',
    ].filter(Boolean).join(' · '));
  }

  settingsStatus() {
    if (!this._workflow) return info("Can't check right now");
    return rowsOf(this.activeConfig, SETTINGS).length ? ok('Customized') : info('Defaults');
  }

  // ======== Renders ========

  renderMessage(section) {
    if (!this._message || this._message.section !== section) return nothing;
    const { type, text } = this._message;
    return html`<div class="message ${type}" role="status">${Array.isArray(text)
      ? html`<ul class="notes">${text.map((t) => html`<li>${t}</li>`)}</ul>` : text}</div>`;
  }

  renderNotes(notes) {
    if (!notes.length) return nothing;
    return html`<ul class="notes">${notes.map((note) => html`<li>${note}</li>`)}</ul>`;
  }

  renderRowActions(list, i, label) {
    return html`
      <div class="row-actions">
        <sl-button class="pw-quiet-secondary pw-action-sm" aria-label="Move ${label} up" ?disabled=${i === 0} @click=${() => this.moveRow(list, i, -1)}>↑</sl-button>
        <sl-button class="pw-quiet-secondary pw-action-sm" aria-label="Move ${label} down" ?disabled=${i === list.length - 1} @click=${() => this.moveRow(list, i, 1)}>↓</sl-button>
        <sl-button class="pw-quiet-secondary pw-action-sm" aria-label="Remove ${label}" @click=${() => this.removeRow(list, i)}>Remove</sl-button>
      </div>
    `;
  }

  renderEditorActions(onSave) {
    return html`
      <div class="form-actions">
        <sl-button class="pw-fill-accent" ?disabled=${!this.canEdit} @click=${onSave}>
          ${this._saving ? 'Saving…' : 'Save'}
        </sl-button>
        <sl-button class="pw-quiet-secondary" ?disabled=${this._saving} @click=${() => this.closeSection()}>Cancel</sl-button>
      </div>
    `;
  }

  field(id, label, value, onInput, extra = {}) {
    return html`
      <sl-input id=${id} name=${id} label=${label} placeholder=${extra.placeholder || nothing}
        type=${extra.type || 'text'} autocomplete="off" .value=${value}
        @input=${(e) => onInput(e.target.value)}></sl-input>
    `;
  }

  renderSection({
    key, title, description, status, body, editable = true, notes = [],
  }) {
    const open = this._open === key;
    return html`
      <section class="setup-section ${open ? 'is-open' : ''}" aria-labelledby="title-${key}">
        <header class="section-header">
          <div class="section-heading">
            <h2 class="section-title" id="title-${key}">${title}</h2>
            <p class="section-description">${description}</p>
          </div>
          <span class="status-light status-light-${status.tone}">${status.text}</span>
          ${!open && editable ? html`
            <sl-button class="pw-quiet-secondary" ?disabled=${this._readOnly || !!this._open} @click=${() => this.openSection(key)}>Edit</sl-button>
          ` : nothing}
        </header>
        ${this.renderNotes(notes)}
        ${this.renderMessage(key)}
        ${open ? html`<div class="section-body">${body()}</div>` : nothing}
      </section>
    `;
  }

  renderRegistrationBody() {
    const { provider } = this._draft;
    const reg = this._registration;
    const current = reg.config;
    const providers = current.availableProviders || [];
    const registered = reg.status === 'registered';
    const submitLabel = registered ? 'Save' : 'Register site';
    const keepsUnavailable = registered && !providers.includes(current.emailProvider);
    return html`
      <form class="setup-form" @submit=${(e) => this.saveRegistrationForm(e)}>
        ${keepsUnavailable ? html`
          <div class="message info">This site uses ${PROVIDER_LABELS[current.emailProvider] || current.emailProvider}, which only Adobe staff can keep. To change its email settings, switch it to ${PROVIDER_LABELS[providers[0]] || providers[0]}.</div>
        ` : nothing}
        ${providers.length > 1 ? html`
          <div class="select-field">
            <label for="provider">Email provider</label>
            <select id="provider" class="field-select" @change=${(e) => { this._draft.provider = e.target.value; this.rerender(); }}>
              ${providers.map((p) => html`<option value=${p} ?selected=${p === provider}>${PROVIDER_LABELS[p] || p}</option>`)}
            </select>
          </div>
        ` : nothing}
        ${provider === 'default' ? html`
          <div class="message info">${current.providerWarnings?.default || "Adobe's default email provider is for proof-of-concept and non-production use only."}</div>
          <sl-checkbox name="acknowledge" ?checked=${this._draft.acknowledged}
            @change=${(e) => { this._draft.acknowledged = e.target.checked; }}>I understand this site's emails aren't for production use</sl-checkbox>
        ` : nothing}
        ${provider === 'custom-api' ? html`
          <sl-input name="apiUrl" id="apiUrl" label="API URL" placeholder="https://example.com/api/send-email" autocomplete="off" .value=${current.apiUrl || ''}></sl-input>
          <sl-input name="apiKey" id="apiKey" label="API key" type="password" autocomplete="off"
            placeholder=${current.apiKeyPresent ? 'Leave empty to keep the current key' : ''}></sl-input>
          <sl-input name="fromAddress" id="fromAddress" label="From address" placeholder="noreply@example.com" autocomplete="off" .value=${current.fromAddress || ''}></sl-input>
          <sl-input name="fromName" id="fromName" label="From name" placeholder="Example Web Team" autocomplete="off" .value=${current.fromName || ''}></sl-input>
        ` : nothing}
        <div>
          ${this.field('domains', 'Allowed email domains', this._draft.domains, (v) => { this._draft.domains = v; }, { placeholder: 'example.com, example.org' })}
          <p class="form-hint">Comma-separated. Emails only go to addresses in these domains.${provider === 'custom-api' ? '' : ' Leave empty for adobe.com only.'}</p>
        </div>
        <div class="form-actions">
          <sl-button type="submit" class="pw-fill-accent" ?disabled=${!this.canEdit}>
            ${this._saving ? 'Saving…' : submitLabel}
          </sl-button>
          <sl-button class="pw-quiet-secondary" ?disabled=${this._saving} @click=${() => this.closeSection()}>Cancel</sl-button>
        </div>
      </form>
    `;
  }

  renderRegistration() {
    const reg = this._registration;
    const description = {
      registered: 'Lets the publish requests service send approval emails for this site.',
      unregistered: 'Register the site so the publish requests service can send approval emails.',
      unknown: `${UNAVAILABLE} The other sections still work.`,
    }[reg.status];
    return this.renderSection({
      key: 'registration',
      title: 'Registration',
      description,
      status: this.registrationStatus(),
      body: () => this.renderRegistrationBody(),
      editable: reg.status !== 'unknown',
    });
  }

  renderInstallBody() {
    const { version } = this._draft;
    const replacing = rowsToReplace(this._siteConfig, version);
    return html`
      <fieldset class="choice-group">
        <legend>Version</legend>
        ${['v1', 'v2'].map((v) => html`
          <label class="choice">
            <input type="radio" name="version" value=${v} .checked=${version === v}
              @change=${() => { this._draft.version = v; this.rerender(); }}>
            <span>
              <strong>${VERSION_LABELS[v]}</strong>
              <span class="choice-hint">${v === 'v1'
                ? 'One approval: any approver on the matching rule publishes.'
                : 'Named workflows with ordered approval steps, shown in a side panel.'}
                ${VERSION_DOCS[v] ? html`<a href=${VERSION_DOCS[v]} target="_blank" rel="noopener">Docs</a>` : nothing}</span>
            </span>
          </label>
        `)}
      </fieldset>
      ${replacing.length ? html`
        <div class="message info">
          Saving replaces these ${VERSION_LABELS[version === 'v1' ? 'v2' : 'v1']} rows:
          <ul class="notes">${replacing.map((path) => html`<li><code>${path}</code></li>`)}</ul>
        </div>
      ` : nothing}
      <p class="form-hint">
        Adds the Request for Publish plugin to the library and the inbox to apps in the site config.
        Authors and approvers also need write access to <code>/.da/publish-workflow-requests.json</code>,
        set in the org's Experience Workspace permissions.
      </p>
      ${this.renderEditorActions(() => this.saveInstall())}
    `;
  }

  renderOrgRules() {
    return html`
      <div class="message info">
        This site uses the approval rules in the org config
        (<a href="https://da.live/config#/${this._org}/" target="_blank" rel="noopener">open it</a>).
        To give this site its own rules, copy them here. The site then stops following org changes.
      </div>
      <div class="form-actions">
        <sl-button class="pw-fill-accent" ?disabled=${!this.canEdit} @click=${() => this.useSiteRules()}>
          ${this._saving ? 'Copying…' : 'Use site-specific rules'}
        </sl-button>
        <sl-button class="pw-quiet-secondary" @click=${() => this.closeSection()}>Cancel</sl-button>
      </div>
    `;
  }

  renderRulesBody() {
    if (this.source === 'org') return this.renderOrgRules();
    const { rules, workflows, groups } = this._draft;
    const v2 = this.version === 'v2';
    const names = [...new Set(workflows.map((w) => w.name.trim()).filter(Boolean))];
    return html`
      <h3 class="subsection-title">Rules</h3>
      <p class="form-hint">
        Patterns: an exact path (<code>/about</code>), a folder and everything below it (<code>/products/*</code>),
        or every page (<code>/*</code>). The most specific match wins. Separate addresses with commas;
        a name without @ is a distribution list.
      </p>
      <ol class="row-list">
        ${rules.map((rule, i) => {
          const options = [...new Set([...names, rule.workflow].filter(Boolean))];
          return html`
            <li class="edit-row">
              ${this.field(`pattern-${i}`, 'Pattern', rule.pattern, (v) => { rule.pattern = v; }, { placeholder: '/products/*' })}
              ${v2 ? html`
                <div class="select-field">
                  <label for="workflow-${i}">Workflow</label>
                  <select id="workflow-${i}" class="field-select" @change=${(e) => { rule.workflow = e.target.value; this.rerender(); }}>
                    <option value="" ?selected=${!rule.workflow}>None</option>
                    ${options.map((n) => html`<option value=${n} ?selected=${rule.workflow === n}>${n}</option>`)}
                  </select>
                </div>
              ` : nothing}
              ${v2 && rule.workflow ? html`<p class="row-note">Approvers come from the workflow's steps.</p>` : html`
                ${this.field(`approvers-${i}`, 'Approvers', rule.approvers, (v) => { rule.approvers = v; }, { placeholder: 'web-team@example.com' })}
                ${this.field(`cc-${i}`, 'CC', rule.cc, (v) => { rule.cc = v; })}
              `}
              ${this.renderRowActions(rules, i, `rule ${i + 1}`)}
            </li>
          `;
        })}
      </ol>
      <sl-button class="pw-quiet-secondary" @click=${() => this.addRow(rules, blankRule())}>Add rule</sl-button>
      ${v2 ? this.renderWorkflowsEditor(workflows) : nothing}
      ${this.renderGroupsEditor(groups)}
      ${this.renderEditorActions(() => this.saveRules())}
    `;
  }

  renderWorkflowsEditor(workflows) {
    return html`
      <h3 class="subsection-title">Workflows</h3>
      <p class="form-hint">
        A workflow is an ordered list of approval steps. Each step completes when any one of its approvers approves.
        Name a workflow, then pick it on a rule.
      </p>
      ${workflows.map((workflow, w) => html`
        <fieldset class="workflow">
          <legend class="sr-only">Workflow ${w + 1}</legend>
          <div class="workflow-header">
            ${this.field(`workflow-name-${w}`, 'Workflow name', workflow.name, (v) => { workflow.name = v; }, { placeholder: 'legal-then-brand' })}
            <sl-button class="pw-quiet-secondary pw-action-sm" @click=${() => this.removeRow(workflows, w)}>Remove workflow</sl-button>
          </div>
          <ol class="row-list">
            ${workflow.steps.map((step, s) => {
              const id = `${w}-${s}`;
              return html`
                <li class="edit-row">
                  ${this.field(`title-${id}`, `Step ${s + 1} title`, step.title, (v) => { step.title = v; }, { placeholder: 'Legal review' })}
                  ${this.field(`description-${id}`, 'Description', step.description, (v) => { step.description = v; })}
                  ${this.field(`step-approvers-${id}`, 'Approvers', step.approvers, (v) => { step.approvers = v; })}
                  ${this.field(`step-cc-${id}`, 'CC', step.cc, (v) => { step.cc = v; })}
                  <sl-checkbox name="cc-approve-${id}" ?checked=${step.ccCanApprove}
                    @change=${(e) => { step.ccCanApprove = e.target.checked; }}>CC can approve</sl-checkbox>
                  ${this.renderRowActions(workflow.steps, s, `step ${s + 1}`)}
                </li>
              `;
            })}
          </ol>
          <sl-button class="pw-quiet-secondary pw-action-sm" @click=${() => this.addRow(workflow.steps, blankStep())}>Add step</sl-button>
        </fieldset>
      `)}
      <sl-button class="pw-quiet-secondary" @click=${() => this.addRow(workflows, { name: '', steps: [blankStep()] })}>Add workflow</sl-button>
    `;
  }

  renderGroupsEditor(groups) {
    return html`
      <h3 class="subsection-title">Distribution lists</h3>
      <p class="form-hint">Names used as approvers or CC that stand for several addresses. Lists your rules use but don't define are added here for you to fill in.</p>
      <ol class="row-list">
        ${groups.map((group, i) => html`
          <li class="edit-row">
            ${this.field(`group-${i}`, 'List name', group.group, (v) => { group.group = v; }, { placeholder: 'dl-legal' })}
            ${this.field(`group-email-${i}`, 'Emails', group.email, (v) => { group.email = v; }, { placeholder: 'a@example.com, b@example.com' })}
            <div class="row-actions">
              <sl-button class="pw-quiet-secondary pw-action-sm" aria-label="Remove list ${i + 1}" @click=${() => this.removeRow(groups, i)}>Remove</sl-button>
            </div>
          </li>
        `)}
      </ol>
      <sl-button class="pw-quiet-secondary" @click=${() => this.addRow(groups, { group: '', email: '' })}>Add list</sl-button>
    `;
  }

  renderSettingsBody() {
    const { values } = this._draft;
    const set = (key) => (v) => { values[key] = v; };
    const v2 = this.version === 'v2';
    return html`
      <div class="setup-form">
        <sl-checkbox name="comments-required" ?checked=${values.commentsRequired === 'true'}
          @change=${(e) => { values.commentsRequired = e.target.checked ? 'true' : ''; }}>Require a comment on every request</sl-checkbox>
        ${this.field('comments-length', 'Minimum comment length', values.commentsLength, set('commentsLength'), { type: 'number', placeholder: '10' })}
        ${this.field('support-contact', 'Support contact', values.supportContact, set('supportContact'), { placeholder: 'web-help@example.com' })}
        <sl-checkbox name="cc-can-approve" ?checked=${values.ccCanApprove === 'true'}
          @change=${(e) => { values.ccCanApprove = e.target.checked ? 'true' : ''; }}>
          CC recipients can approve${v2 ? ' (rules without a workflow)' : ''}
        </sl-checkbox>
        ${v2 ? html`
          ${this.field('guidance-title', 'Guidance title', values.guidanceTitle, set('guidanceTitle'), { placeholder: 'Before you submit' })}
          <sl-textarea name="guidance-text" id="guidance-text" label="Guidance text" .value=${values.guidanceText}
            @input=${(e) => { values.guidanceText = e.target.value; }}></sl-textarea>
          <div>
            <sl-textarea name="guidance-items" id="guidance-items" label="Guidance checklist" .value=${this._draft.items}
              @input=${(e) => { this._draft.items = e.target.value; }}></sl-textarea>
            <p class="form-hint">One item per line.</p>
          </div>
        ` : nothing}
        ${this.field('accent-color', 'Accent color', values.accentColor, set('accentColor'), { placeholder: '#3b63fb' })}
        ${this.field('accent-color-hover', 'Accent hover color', values.accentColorHover, set('accentColorHover'), { placeholder: '#274dea' })}
      </div>
      ${this.renderEditorActions(() => this.saveSettings())}
    `;
  }

  renderSections() {
    const hasVersion = ['v1', 'v2'].includes(this.version);
    const needsVersion = hasVersion ? '' : ' Choose a version under Plugin and inbox first.';
    const workflowReady = hasVersion && !!this._workflow;
    const unavailable = this._workflow ? '' : ` ${this._workflowError}`;
    const validation = this._workflow?.validation || {};
    const sections = [
      {
        key: 'install',
        title: 'Plugin and inbox',
        description: 'Which version this site uses. Adds the author plugin and the approver inbox.',
        status: this.installStatus(),
        body: () => this.renderInstallBody(),
      },
      {
        key: 'rules',
        title: 'Approval rules',
        description: `Who approves which pages${this.version === 'v2' ? ', in which steps' : ''}, and the distribution lists they use.${needsVersion}${unavailable}`,
        status: this.rulesStatus(),
        body: () => this.renderRulesBody(),
        editable: workflowReady,
        notes: [...(validation.errors || []), ...(validation.warnings || [])].map(describeProblem),
      },
      {
        key: 'settings',
        title: 'Settings',
        description: `Comment rules, support contact, guidance and colors.${needsVersion}${unavailable}`,
        status: this.settingsStatus(),
        body: () => this.renderSettingsBody(),
        editable: workflowReady && this.source !== 'org',
      },
    ];
    return html`
      ${this._readOnly ? html`<div class="message info" role="status">${NO_ACCESS}</div>` : nothing}
      ${this.renderRegistration()}
      ${sections.map((section) => this.renderSection(section))}
    `;
  }

  renderContent() {
    if (this._state === 'loading') {
      return html`
        <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
          <div class="spectrum-loading-indicator" aria-hidden="true"></div>
          <p class="loading-label">Loading…</p>
        </div>
      `;
    }
    if (this._state === 'site-not-found') {
      return html`<div class="message error">${this._org}/${this._site} doesn't exist. Check the organization and site names.</div>`;
    }
    if (this._state === 'ready') return this.renderSections();
    return html`<p class="section-description">Enter a site to set up publish requests for it.</p>`;
  }

  render() {
    return html`
      <div class="site-select-container">
        <h1 class="site-select-title">Request Publish Setup & Configuration</h1>
        <form class="site-select-toolbar" @submit=${(e) => this.handleSiteSubmit(e)}>
          <sl-input id="org-site" name="org-site" class="site-select-field" placeholder="/org/site" autocomplete="off"
            aria-label="Organization and site, as /org/site" .value=${this._orgSiteValue}></sl-input>
          <sl-button type="submit" class="pw-fill-accent">Load site</sl-button>
        </form>
        ${this.renderMessage(null)}
      </div>
      ${this.renderContent()}
    `;
  }
}

customElements.define('publish-requests-setup', PublishRequestsSetup);

(async function init() {
  const { token } = await DA_SDK;
  const cmp = document.createElement('publish-requests-setup');
  cmp.token = token;
  document.body.append(cmp);
}());
