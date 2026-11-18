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
  readConfig, getSetup, saveRegistration, getWorkflowConfig, saveWorkflowConfig,
} from './api.js';
import {
  SETTINGS, rowsOf, toList, detectVersion, installState, rowsToReplace, tabsToConfig,
  suggestVersion, activeConfigOf, readRules, readWorkflows, readGroups,
  missingGroups, emailAddresses, suggestDomains, describeProblem, tabLabel,
  blankRule, draftFromConfig, draftToTabs, mergeTabs, readSetup, problemCode,
  parseOrgSite, siteFromParams, registrationForm, registrationBody, saveErrorText,
  permissionsModeOf, permissionsNotice, PERMISSIONS_DOCS, rulesDraftErrors, settingsFields,
  commentsLengthDefault,
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
const UNAVAILABLE = "The publish requests service didn't answer.";
// Worker codes that mean the site itself isn't ready, rather than an outage.
const SITE_PROBLEMS = {
  'site-not-found': 'Edge Delivery Services site does not exist. Please create it first.',
  'preview-write-required': 'You need at least the basic_author role on the Edge Delivery Services site.',
};
const ROLES_DOCS = 'https://www.aem.live/docs/authentication-setup-authoring#admin-roles';
const DEFAULT_PROVIDER_WARNING = "Adobe's default email provider is for proof-of-concept, demos and non-production use only. Production sites must use their own email provider (custom-api).";
const VERSION_LABELS = { v1: 'Request Publish - Single Step', v2: 'Request Publish - Multi Step' };
const VERSION_DOCS = {
  v1: 'https://www.aem.live/docs/ew/administering/request-publish',
  v2: 'https://www.aem.live/docs/ew/administering/request-publish-v2',
};
// The Settings tab, documented per version.
const SETTINGS_DOCS = {
  v1: `${VERSION_DOCS.v1}#publish-workflow-settings-tab-optional`,
  v2: `${VERSION_DOCS.v2}#publish-workflow-settings-tab-optional`,
};
const permissionsApp = (org, site) => `https://da.live/config/permissions#/${org}/${site}`;
// The workflow picker's "Add a workflow" option: not a workflow name (names are trimmed).
const ADD_WORKFLOW = ' add';
const NO_ACCESS = 'You need config admin rights for this site to change its setup. Ask a config admin.';
// Worker registration `field`s and the inputs that edit them.
const FIELD_INPUTS = {
  apiUrl: 'apiUrl',
  apiKey: 'apiKey',
  fromAddress: 'fromAddress',
  fromName: 'fromName',
  allowedEmailDomains: 'domains',
  emailProvider: 'provider',
};
const CODE_INPUTS = { 'acknowledgement-required': 'acknowledge', 'default-provider-staff-only': 'provider' };

const ok = (text) => ({ tone: 'positive', text });
const todo = (text) => ({ tone: 'negative', text });
const info = (text) => ({ tone: 'neutral', text });

const blankStep = () => ({
  title: '', description: '', approvers: '', cc: '', ccCanApprove: false,
});

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
    _conflict: { state: true },
    _fieldError: { state: true },
    _draftErrors: { state: true },
    _permissionsMode: { state: true },
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
    this._draftErrors = {};
    this._permissionsMode = 'unknown';
    // Counts workflow views, so an older read never replaces a newer save's view (and `version`).
    this._workflowSeq = 0;
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [nexter, sl, styles].filter(Boolean);
    const params = new URLSearchParams(window.location.search);
    const target = siteFromParams(params);
    if (!target) return;
    const lowered = target.org !== params.get('org') || target.site !== params.get('site');
    this.loadSite(target.org, target.site).then(() => { if (lowered) this.updateUrl(); });
  }

  // The worker's view wins: it is what the last save wrote, while a DA read can be a minute old.
  get version() {
    const installed = this._workflow?.installed;
    if (installed) return installed.version;
    return detectVersion(this._siteConfig) || detectVersion(this._orgConfig);
  }

  // Nothing installed: Single Step, unless the rules use workflows.
  get defaultVersion() {
    return suggestVersion(this._workflow
      ? this.activeConfig : activeConfigOf(this._siteConfig, this._orgConfig));
  }

  get apiVersion() {
    return ['v1', 'v2'].includes(this.version) ? this.version : this.defaultVersion;
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

  // Every worker response replaces the view whole: its `version` is the one the next save sends.
  setWorkflow(view) {
    this._workflowSeq += 1;
    this._workflow = view;
    this._permissionsMode = permissionsModeOf(view, this._permissionsMode);
  }

  // Reads the DA config (fast, in parallel) to pick the version, then makes one worker call.
  // The setup routes refuse uppercase org/site, so both are lowercased first.
  async loadSite(rawOrg, rawSite) {
    const { org, site } = parseOrgSite(`/${rawOrg}/${rawSite}`) || { org: rawOrg, site: rawSite };
    this._org = org;
    this._site = site;
    this._orgSiteValue = `/${org}/${site}`;
    this._state = 'loading';
    this.closeSection();
    this._message = null;
    this._readOnly = false;
    this._workflow = null;
    this._workflowSeq += 1;
    this._permissionsMode = 'unknown';
    const [siteRead, orgRead] = await Promise.all([readConfig(org, site), readConfig(org)]);
    this._siteConfig = siteRead.config;
    this._orgConfig = orgRead.config;
    let route = this.apiVersion;
    let setup = readSetup(await getSetup(route, org, site, this.token));
    // A DA read up to a minute old can pick the wrong route; the worker's `installed` is current.
    const installed = setup.workflow?.installed?.version;
    if (['v1', 'v2'].includes(installed) && installed !== route) {
      route = installed;
      setup = readSetup(await getSetup(route, org, site, this.token));
    }
    if (setup.problem === 'site-not-found') {
      this._state = 'site-not-found';
      return;
    }
    this._registration = setup.registration;
    this.setWorkflow(setup.workflow);
    this._permissionsMode = setup.permissionsMode;
    this._workflowError = setup.workflow ? '' : this.problemText(setup.problem, setup.registration.error);
    this._readOnly = [401, 403].includes(siteRead.status) || setup.canEdit === false;
    this._state = 'ready';
  }

  // Refreshes the workflow view (e.g. recipient-domain warnings after a registration save).
  // A save that lands while this read is in flight wins: its view is newer.
  async refreshWorkflow() {
    const { _org: org, _site: site } = this;
    const seq = this._workflowSeq;
    const { ok: loaded, data } = await getWorkflowConfig(this.apiVersion, org, site, this.token);
    if (loaded && seq === this._workflowSeq) this.setWorkflow(data);
    return loaded;
  }

  problemText(code, error) {
    if (code === 'preview-write-required') {
      return html`${SITE_PROBLEMS[code]} <a href=${ROLES_DOCS} target="_blank" rel="noopener">Admin roles</a>`;
    }
    if (SITE_PROBLEMS[code]) return SITE_PROBLEMS[code];
    if (code === 'unavailable' || !error) return UNAVAILABLE;
    return error;
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
    this._conflict = null;
    this._fieldError = null;
    this._draftErrors = {};
    this._open = key;
    this._draft = this.buildDraft(key);
    // What the draft started from, to re-apply only the user's changes after a 409.
    this._draftBase = ['rules', 'settings'].includes(key) ? this.draftTabs(key, this._draft) : null;
  }

  closeSection() {
    this._open = null;
    this._draft = null;
    this._draftBase = null;
    this._conflict = null;
    this._fieldError = null;
    this._draftErrors = {};
  }

  draftTabs(key, draft) {
    return draftToTabs(key, draft, { v2: this.apiVersion === 'v2' });
  }

  buildDraft(key) {
    const config = this.activeConfig;
    if (key === 'registration') {
      const current = this._registration.config;
      const providers = current.availableProviders || [];
      const used = [readRules(config), readWorkflows(config), readGroups(config)];
      const domains = current.allowedEmailDomains?.length
        ? current.allowedEmailDomains
        : suggestDomains(emailAddresses(...used));
      return {
        provider: providers.includes(current.emailProvider) ? current.emailProvider : providers[0],
        domains: domains.join(', '),
        acknowledged: false,
      };
    }
    if (key === 'install') {
      return { version: ['v1', 'v2'].includes(this.version) ? this.version : this.defaultVersion };
    }
    return draftFromConfig(key, config);
  }

  rerender() {
    this.revalidate();
    this.requestUpdate();
  }

  rulesErrors() {
    return rulesDraftErrors(this._draft, { v2: this.apiVersion === 'v2' });
  }

  // Once a save found problems, they update as the user fixes them.
  revalidate() {
    if (this._open === 'rules' && Object.keys(this._draftErrors).length) {
      this._draftErrors = this.rulesErrors();
    }
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

  // Shows the result next to the section's Save button (or its header once closed), in view.
  async showResult(section, type, text, focusId = null) {
    this._message = { section, type, text };
    await this.updateComplete;
    const fieldId = focusId || this._fieldError?.field;
    const target = (fieldId && this.shadowRoot.querySelector(`#${fieldId}`))
      || this.shadowRoot.querySelector(`#message-${section || 'site'}`);
    target?.scrollIntoView?.({ block: 'nearest' });
    target?.focus?.({ preventScroll: true });
  }

  async saveWorkflowTabs(section, body, successText, api = this.apiVersion) {
    this._saving = true;
    const result = await saveWorkflowConfig(api, this._org, this._site, {
      version: this._workflow.version, ...body,
    }, this.token);
    this._saving = false;
    if (result.ok) {
      // The response is the new view: its `version` changes with every save, the install included.
      this.setWorkflow(result.data);
      this.closeSection();
      this.showResult(section, 'success', successText);
      return;
    }
    if (result.status === 409) {
      await this.handleConflict(section, body.tabs);
      return;
    }
    const { error, code } = result.data;
    if (code === 'config-write-required') this._readOnly = true;
    const problems = saveErrorText(result, section);
    const definite = SITE_PROBLEMS[problemCode(result)];
    this.showResult(section, 'error', problems || definite || error || `Couldn't save (${result.status}).`);
  }

  // A 409 means the tabs changed since they loaded. Rebuild the draft from the fresh tabs and
  // re-apply only the user's changes; ask before replacing anything both sides changed.
  async handleConflict(section, mine) {
    const reloaded = await this.refreshWorkflow();
    if (!reloaded) {
      this.showResult(section, 'error', `Someone changed these settings since you opened them, and they couldn't be reloaded. ${UNAVAILABLE}`);
      return;
    }
    if (!this._draftBase || !mine) {
      this.showResult(section, 'error', 'The config changed since it loaded. It is reloaded now: save again.');
      return;
    }
    const theirs = this.draftTabs(section, draftFromConfig(section, this.activeConfig));
    const merged = mergeTabs(this._draftBase, mine, theirs);
    this._draftBase = theirs;
    if (!merged.ok) {
      this._conflict = { section, incoming: merged.incoming };
      this.showResult(section, 'error', [
        "Someone saved other changes to these settings while you were editing, and they can't be combined with yours automatically. Your edits are still here.",
        ...this.describeIncoming(merged.incoming),
        'Save again to replace their version with yours, or cancel to keep theirs.',
      ]);
      return;
    }
    const dropSteps = this._draft?.dropSteps;
    this._draft = {
      ...draftFromConfig(section, { ...this.activeConfig, ...tabsToConfig(merged.tabs) }),
      ...(dropSteps ? { dropSteps } : {}),
    };
    if (merged.conflicts.length) {
      this._conflict = { section, conflicts: merged.conflicts };
      this.showResult(section, 'error', [
        'Someone saved changes while you were editing. Theirs are now included, except where you both changed the same thing; there your version is kept:',
        ...merged.conflicts.map(({ tab, key, theirs: rows }) => `${tabLabel(tab)}: ${key}. Theirs: ${rows ? this.describeRows(rows) : 'removed'}`),
        'Save again to keep your version of these, or cancel to keep theirs.',
      ]);
      return;
    }
    this.showResult(section, 'info', 'Someone saved changes while you were editing. Theirs are now included with yours: check them and save again.');
  }

  describeRows(rows) {
    return rows.map((row) => Object.entries(row).filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}: ${v}`).join(', ')).join('; ');
  }

  describeIncoming(incoming) {
    return Object.entries(incoming).map(([tab, rows]) => `Their ${tabLabel(tab)}: ${rows?.length ? this.describeRows(rows) : 'none'}`);
  }

  async saveInstall() {
    const { version } = this._draft;
    // One worker write: the response is the view for the installed version, `installed` included.
    await this.saveWorkflowTabs('install', { install: true }, `${VERSION_LABELS[version]} is installed.`, version);
  }

  saveRules() {
    this._conflict = null;
    this._draftErrors = this.source === 'org' ? {} : this.rulesErrors();
    const ids = Object.keys(this._draftErrors);
    if (ids.length) {
      const text = ids.length === 1 ? 'Fix the highlighted field, then save.' : `Fix the ${ids.length} highlighted fields, then save.`;
      this.showResult('rules', 'error', text, ids[0]);
      return;
    }
    this.saveWorkflowTabs('rules', { tabs: this.draftTabs('rules', this._draft) }, 'Approval rules saved.');
  }

  saveSettings() {
    this._conflict = null;
    this.saveWorkflowTabs('settings', { tabs: this.draftTabs('settings', this._draft) }, 'Settings saved.');
  }

  useSiteRules() {
    this.saveWorkflowTabs('rules', { tabs: {}, copyFromOrg: true }, 'The org rules were copied to this site. Edit them here from now on.');
  }

  registrationError(field, text) {
    this._fieldError = field ? { field, text } : null;
    this.showResult('registration', 'error', text);
  }

  async saveRegistrationForm(e) {
    e.preventDefault();
    if (!this.canEdit) return;
    this._fieldError = null;
    const { provider, acknowledged } = this._draft;
    const form = Object.fromEntries(new FormData(e.target));
    const domains = toList(this._draft.domains);
    if (provider === 'custom-api' && !domains.length) {
      this.registrationError('domains', 'Add at least one allowed email domain, or emails to your approvers will be blocked.');
      return;
    }
    if (provider === 'default' && !acknowledged) {
      this.registrationError('acknowledge', "Confirm you understand the default provider isn't for production.");
      return;
    }
    this._saving = true;
    const body = registrationBody(provider, form, domains, this._registration.config);
    const result = await saveRegistration(this._org, this._site, body, this.token);
    this._saving = false;
    if (!result.ok) {
      const { code, error, field } = result.data;
      if (code === 'config-write-required') this._readOnly = true;
      const input = FIELD_INPUTS[/^[A-Za-z]+/.exec(field || '')?.[0]] || CODE_INPUTS[code];
      this.registrationError(input, saveErrorText(result, 'registration')
        || SITE_PROBLEMS[problemCode(result)] || error || `Registration failed (${result.status}).`);
      return;
    }
    this._permissionsMode = permissionsModeOf(result.data, this._permissionsMode);
    // The POST returns the saved registration; providers and their warnings don't change on a save.
    // apiUrl and apiUrlRedacted come from the response only, so a redaction never outlives it.
    const { apiUrl: _url, apiUrlRedacted: _redacted, ...kept } = this._registration.config;
    this._registration = { status: 'registered', config: { ...kept, ...result.data } };
    this.closeSection();
    this.showResult('registration', 'success', `${this._org}/${this._site} is registered.`);
    // Recipient-domain warnings depend on the registration: refresh them without waiting.
    this.refreshWorkflow().then(() => this.requestUpdate());
  }

  // ======== Status ========

  registrationStatus() {
    const { status, config } = this._registration;
    if (status === 'registered') {
      return ok(`Registered · ${PROVIDER_LABELS[config.emailProvider] || config.emailProvider}`);
    }
    if (status === 'unregistered') return todo('Not registered');
    if (this._registration.code === 'preview-write-required') return todo('No access to the site');
    return info("Can't check right now");
  }

  installStatus() {
    const { version } = this;
    if (!version) return todo('Not installed');
    if (version === 'mixed') return todo('Single Step and Multi Step are both installed');
    const installed = this._workflow?.installed;
    const has = installed
      ? (tab) => [installed.site?.[tab], installed.org?.[tab]].some((v) => v === version || v === 'mixed')
      : (tab) => [this._siteConfig, this._orgConfig]
        .some((config) => installState(config, version)[tab]);
    if (!has('library')) return todo(`${VERSION_LABELS[version]}: extension missing`);
    if (!has('apps')) return todo(`${VERSION_LABELS[version]}: app missing`);
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
    return html`<div class="message ${type}" id="message-${section || 'site'}" tabindex="-1"
      role=${type === 'error' ? 'alert' : 'status'}>${Array.isArray(text)
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

  // The section's result shows here, next to Save, while the editor is open.
  renderEditorActions(section, onSave) {
    const saveLabel = this._conflict?.section === section ? 'Save and replace theirs' : 'Save';
    return html`
      ${this.renderMessage(section)}
      <div class="form-actions">
        <sl-button class="pw-fill-accent" ?disabled=${!this.canEdit} @click=${onSave}>
          ${this._saving ? 'Saving…' : saveLabel}
        </sl-button>
        <sl-button class="pw-quiet-secondary" ?disabled=${this._saving} @click=${() => this.closeSection()}>Cancel</sl-button>
      </div>
    `;
  }

  field(id, label, value, onInput, extra = {}) {
    return html`
      <sl-input id=${id} name=${id} label=${label} placeholder=${extra.placeholder || nothing}
        type=${extra.type || 'text'} autocomplete="off" .value=${value}
        .error=${this.fieldError(id)}
        @input=${(e) => { this.clearFieldError(id); onInput(e.target.value); this.revalidate(); }}></sl-input>
    `;
  }

  fieldError(id) {
    if (this._fieldError?.field === id) return this._fieldError.text;
    return this._draftErrors?.[id] || '';
  }

  clearFieldError(id) {
    if (this._fieldError?.field === id) this._fieldError = null;
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
        ${open ? html`<div class="section-body">${body()}</div>` : this.renderMessage(key)}
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
    // Without config write the worker returns only the apiUrl origin: shown as set, not sent back.
    const apiUrl = registrationForm(current);
    return html`
      <form class="setup-form" @submit=${(e) => this.saveRegistrationForm(e)}>
        ${keepsUnavailable ? html`
          <div class="message info">This site uses ${PROVIDER_LABELS[current.emailProvider] || current.emailProvider}, which only Adobe staff can keep. To change its email settings, switch it to ${PROVIDER_LABELS[providers[0]] || providers[0]}.</div>
        ` : nothing}
        ${providers.length > 1 ? html`
          <div class="select-field">
            <label for="provider">Email provider</label>
            <select id="provider" class="field-select ${this.fieldError('provider') ? 'has-error' : ''}"
              aria-invalid=${this.fieldError('provider') ? 'true' : 'false'}
              @change=${(e) => { this._draft.provider = e.target.value; this._fieldError = null; this._message = null; this.rerender(); }}>
              ${providers.map((p) => html`<option value=${p} ?selected=${p === provider}>${PROVIDER_LABELS[p] || p}</option>`)}
            </select>
            ${this.fieldError('provider') ? html`<p class="field-error">${this.fieldError('provider')}</p>` : nothing}
          </div>
        ` : nothing}
        ${provider === 'default' ? html`
          <div class="message info">${current.providerWarnings?.default || DEFAULT_PROVIDER_WARNING}</div>
          <sl-checkbox name="acknowledge" id="acknowledge" ?checked=${this._draft.acknowledged}
            .error=${this.fieldError('acknowledge')}
            @change=${(e) => { this._draft.acknowledged = e.target.checked; this.clearFieldError('acknowledge'); }}><span class="checkbox-label">I understand this site's emails aren't for production use</span></sl-checkbox>
        ` : nothing}
        ${provider === 'custom-api' ? html`
          <div>
            <sl-input name="apiUrl" id="apiUrl" label="API URL" autocomplete="off" .value=${apiUrl.apiUrl}
              placeholder=${apiUrl.apiUrlSet ? 'Set. Leave empty to keep it' : 'https://example.com/api/send-email'}
              .error=${this.fieldError('apiUrl')} @input=${() => this.clearFieldError('apiUrl')}></sl-input>
            ${apiUrl.apiUrlHint ? html`<p class="form-hint">${apiUrl.apiUrlHint}</p>` : nothing}
          </div>
          <sl-input name="apiKey" id="apiKey" label="API key" type="password" autocomplete="off"
            placeholder=${current.apiKeyPresent ? 'Leave empty to keep the current key' : ''}
            .error=${this.fieldError('apiKey')} @input=${() => this.clearFieldError('apiKey')}></sl-input>
          <sl-input name="fromAddress" id="fromAddress" label="From address" placeholder="noreply@example.com" autocomplete="off" .value=${current.fromAddress || ''}
            .error=${this.fieldError('fromAddress')} @input=${() => this.clearFieldError('fromAddress')}></sl-input>
          <sl-input name="fromName" id="fromName" label="From name" placeholder="Example Web Team" autocomplete="off" .value=${current.fromName || ''}
            .error=${this.fieldError('fromName')} @input=${() => this.clearFieldError('fromName')}></sl-input>
        ` : nothing}
        <div>
          ${this.field('domains', 'Allowed email domains', this._draft.domains, (v) => { this._draft.domains = v; }, { placeholder: 'example.com, example.org' })}
          <p class="form-hint">Comma-separated. Emails only go to addresses in these domains.${provider === 'custom-api' ? '' : ' Leave empty for adobe.com only.'}</p>
        </div>
        ${this.renderMessage('registration')}
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
      unknown: SITE_PROBLEMS[reg.code] ? this.problemText(reg.code) : `${UNAVAILABLE} The other sections still work.`,
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
    const other = version === 'v1' ? 'v2' : 'v1';
    // The worker's `installed` is current; the DA read only names the rows and can be stale.
    const installed = this._workflow?.installed?.site;
    const otherOnSite = !installed
      || ['library', 'apps'].some((tab) => [other, 'mixed'].includes(installed[tab]));
    const replacing = otherOnSite ? rowsToReplace(this._siteConfig, version) : [];
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
          Saving replaces these ${VERSION_LABELS[other]} rows:
          <ul class="notes">${replacing.map((path) => html`<li><code>${path}</code></li>`)}</ul>
        </div>
      ` : nothing}
      ${otherOnSite && installed && !replacing.length ? html`
        <div class="message info">Saving replaces the ${VERSION_LABELS[other]} extension and app rows.</div>
      ` : nothing}
      <p class="form-hint">
        Adds the Request Publish extension and app to this site's Experience Workspace config.
        Authors and approvers also need write access to <code>/.da/publish-workflow-requests.json</code>
        in the org's <a href=${permissionsApp(this._org, this._site)} target="_blank" rel="noopener">Experience Workspace permissions</a>.
      </p>
      ${this.renderEditorActions('install', () => this.saveInstall())}
    `;
  }

  renderOrgRules() {
    return html`
      <div class="message info">
        This site uses the approval rules in the org config
        (<a href="https://da.live/config#/${this._org}/" target="_blank" rel="noopener">open it</a>).
        To give this site its own rules, copy them here. The site then stops following org changes.
      </div>
      ${this.renderMessage('rules')}
      <div class="form-actions">
        <sl-button class="pw-fill-accent" ?disabled=${!this.canEdit} @click=${() => this.useSiteRules()}>
          ${this._saving ? 'Copying…' : 'Use site-specific rules'}
        </sl-button>
        <sl-button class="pw-quiet-secondary" @click=${() => this.closeSection()}>Cancel</sl-button>
      </div>
    `;
  }

  // A bordered panel with a header bar, as the EW style guide frames its examples.
  renderPanel(key, title, count, hint, content) {
    return html`
      <section class="subsection" aria-labelledby="subsection-${key}">
        <header class="subsection-header">
          <h3 class="subsection-title" id="subsection-${key}">${title}</h3>
          <span class="subsection-count">${count}</span>
        </header>
        <div class="subsection-body">
          <p class="form-hint">${hint}</p>
          ${content}
        </div>
      </section>
    `;
  }

  renderRulesBody() {
    if (this.source === 'org') return this.renderOrgRules();
    const { rules, workflows, groups } = this._draft;
    const v2 = this.apiVersion === 'v2';
    const names = [...new Set(workflows.map((w) => w.name.trim()).filter(Boolean))];
    const rulesHint = html`
      Patterns: an exact path (<code>/about</code>), a folder and everything below it (<code>/products/*</code>),
      or every page (<code>/*</code>). The most specific match wins. Separate addresses with commas;
      a list name from Distribution lists stands for its addresses.
      ${v2 ? 'A rule without a workflow has one approval step, as in Single Step.' : ''}`;
    return html`
      ${this.renderPanel('rules', 'Rules', rules.length, rulesHint, html`
        <ol class="row-list">
          ${rules.map((rule, i) => this.renderRule(rule, i, { v2, names, workflows }))}
        </ol>
        <sl-button class="pw-quiet-secondary" @click=${() => this.addRow(rules, blankRule())}>Add rule</sl-button>
      `)}
      ${v2 ? this.renderWorkflowsEditor(workflows) : this.renderMultiStepWorkflows()}
      ${this.renderGroupsEditor(groups)}
      ${this.renderEditorActions('rules', () => this.saveRules())}
    `;
  }

  renderRule(rule, i, { v2, names, workflows }) {
    const options = [...new Set([...names, rule.workflow].filter(Boolean))];
    // No workflow to pick yet: offer to start one below.
    const offerAdd = !rule.workflow && !workflows.length;
    return html`
      <li class="edit-row">
        ${this.field(`pattern-${i}`, 'Pattern', rule.pattern, (v) => { rule.pattern = v; }, { placeholder: '/products/*' })}
        ${v2 ? html`
          <div class="select-field">
            <label for="workflow-${i}">Workflow</label>
            <select id="workflow-${i}" class="field-select" @change=${(e) => this.chooseWorkflow(rule, e.target)}>
              <option value="" ?selected=${!rule.workflow}>None (single step)</option>
              ${options.map((n) => html`<option value=${n} ?selected=${rule.workflow === n}>${n}</option>`)}
              ${offerAdd ? html`<option value=${ADD_WORKFLOW}>Add a workflow…</option>` : nothing}
            </select>
          </div>
        ` : nothing}
        ${rule.workflow && !v2 ? this.renderMultiStepRule(rule) : nothing}
        ${rule.workflow && v2 ? html`<p class="row-note">Approvers come from the workflow's steps.</p>` : nothing}
        ${rule.workflow ? nothing : html`
          ${this.field(`approvers-${i}`, 'Approvers', rule.approvers, (v) => { rule.approvers = v; }, { placeholder: 'web-team@example.com' })}
          ${this.field(`cc-${i}`, 'CC', rule.cc, (v) => { rule.cc = v; })}
        `}
        ${this.renderRowActions(this._draft.rules, i, `rule ${i + 1}`)}
      </li>
    `;
  }

  chooseWorkflow(rule, select) {
    if (select.value === ADD_WORKFLOW) {
      select.value = rule.workflow || '';
      this.addWorkflow();
      return;
    }
    rule.workflow = select.value;
    this.rerender();
  }

  // Adds an empty workflow and puts the cursor in its name.
  async addWorkflow() {
    const { workflows } = this._draft;
    workflows.push({ name: '', steps: [blankStep()] });
    this.rerender();
    await this.updateComplete;
    const input = this.shadowRoot.querySelector(`#workflow-name-${workflows.length - 1}`);
    await input?.updateComplete;
    input?.scrollIntoView?.({ block: 'center' });
    input?.focus?.();
  }

  // Single Step can't use a Multi Step rule: show it as an error with a way to convert it.
  renderMultiStepRule(rule) {
    return html`
      <div class="message error row-problem">
        This rule uses the ${VERSION_LABELS.v2} workflow <strong>${rule.workflow}</strong>, which ${VERSION_LABELS.v1} can't use.
        <sl-button class="pw-quiet-secondary pw-action-sm" @click=${() => { rule.workflow = ''; this.rerender(); }}>Use approvers instead</sl-button>
      </div>
    `;
  }

  renderMultiStepWorkflows() {
    const { workflows, dropSteps } = this._draft;
    if (!workflows.length) return nothing;
    const names = workflows.map((w) => w.name).join(', ');
    if (dropSteps) {
      return html`<div class="message info">Saving removes the ${VERSION_LABELS.v2} workflows: ${names}.
        <sl-button class="pw-quiet-secondary pw-action-sm" @click=${() => { this._draft.dropSteps = false; this.rerender(); }}>Keep them</sl-button></div>`;
    }
    return html`
      <div class="message error">
        This site defines ${VERSION_LABELS.v2} workflows (${names}), which ${VERSION_LABELS.v1} can't use. Remove them to save these rules.
        <sl-button class="pw-quiet-secondary pw-action-sm" @click=${() => { this._draft.dropSteps = true; this.rerender(); }}>Remove workflows</sl-button>
      </div>
    `;
  }

  renderWorkflowsEditor(workflows) {
    const hint = 'A workflow is an ordered list of approval steps. Each step completes when any one of its approvers approves. Name a workflow, then pick it on a rule.';
    return this.renderPanel('workflows', 'Workflows', workflows.length, hint, html`
      ${workflows.map((workflow, w) => html`
        <fieldset class="workflow">
          <legend class="sr-only">Workflow ${w + 1}</legend>
          <div class="workflow-header">
            ${this.field(`workflow-name-${w}`, 'Workflow name', workflow.name, (v) => { workflow.name = v; this.requestUpdate(); }, { placeholder: 'legal-then-brand' })}
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
                    @change=${(e) => { step.ccCanApprove = e.target.checked; }}><span class="checkbox-label">CC can approve</span></sl-checkbox>
                  ${this.renderRowActions(workflow.steps, s, `step ${s + 1}`)}
                </li>
              `;
            })}
          </ol>
          <sl-button class="pw-quiet-secondary pw-action-sm" @click=${() => this.addRow(workflow.steps, blankStep())}>Add step</sl-button>
        </fieldset>
      `)}
      <sl-button class="pw-quiet-secondary" @click=${() => this.addWorkflow()}>Add workflow</sl-button>
    `);
  }

  renderGroupsEditor(groups) {
    const hint = "Names used as approvers or CC that stand for several addresses. Lists your rules use but don't define are added here for you to fill in.";
    return this.renderPanel('lists', 'Distribution lists', groups.length, hint, html`
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
    `);
  }

  // Only the settings this version reads; the others are kept as they are.
  renderSettingsBody() {
    const { values } = this._draft;
    const set = (key) => (v) => { values[key] = v; };
    const version = this.apiVersion;
    const shown = new Set(settingsFields(version, this.activeConfig, values));
    const toggle = (key) => (e) => { values[key] = e.target.checked ? 'true' : ''; this.rerender(); };
    return html`
      <div class="setup-form">
        <fieldset class="settings-group">
          <legend>Request comments</legend>
          <sl-checkbox name="comments-required" ?checked=${values.commentsRequired === 'true'}
            @change=${toggle('commentsRequired')}><span class="checkbox-label">Require a comment on every request</span></sl-checkbox>
          ${values.commentsRequired === 'true' ? this.field('comments-length', 'Minimum comment length', values.commentsLength, set('commentsLength'), {
            type: 'number', placeholder: String(commentsLengthDefault(version)),
          }) : nothing}
        </fieldset>
        ${shown.has('ccCanApprove') ? html`
          <fieldset class="settings-group">
            <legend>CC approvals</legend>
            <sl-checkbox name="cc-can-approve" ?checked=${values.ccCanApprove === 'true'} @change=${toggle('ccCanApprove')}>
              <span class="checkbox-label">Let CC recipients approve</span>
            </sl-checkbox>
            <p class="form-hint">CC recipients are only notified unless this is on.${version === 'v2'
              ? " Applies to rules without a workflow; workflow steps have their own 'CC can approve'." : ''}</p>
          </fieldset>
        ` : nothing}
        ${shown.has('guidance') ? html`
          <fieldset class="settings-group">
            <legend>Guidance for authors</legend>
            <p class="form-hint">Shown in the request panel before an author submits.</p>
            ${this.field('guidance-title', 'Guidance title', values.guidanceTitle, set('guidanceTitle'), { placeholder: 'Before you submit' })}
            <sl-textarea name="guidance-text" id="guidance-text" label="Guidance text" .value=${values.guidanceText}
              @input=${(e) => { values.guidanceText = e.target.value; }}></sl-textarea>
            <div>
              <sl-textarea name="guidance-items" id="guidance-items" label="Guidance checklist" .value=${this._draft.items}
                @input=${(e) => { this._draft.items = e.target.value; }}></sl-textarea>
              <p class="form-hint">One item per line.</p>
            </div>
          </fieldset>
        ` : nothing}
        <fieldset class="settings-group">
          <legend>Support and colors</legend>
          <div>
            ${this.field('support-contact', 'Support contact', values.supportContact, set('supportContact'), { placeholder: 'web-help@example.com' })}
            <p class="form-hint">Shown to authors who need help with an approval.</p>
          </div>
          <div class="field-pair">
            ${this.field('accent-color', 'Accent color', values.accentColor, set('accentColor'), { placeholder: '#3b63fb' })}
            ${this.field('accent-color-hover', 'Accent hover color', values.accentColorHover, set('accentColorHover'), { placeholder: '#274dea' })}
          </div>
          <p class="form-hint">CSS colors for the buttons in the extension and app.</p>
        </fieldset>
      </div>
      ${this.renderEditorActions('settings', () => this.saveSettings())}
    `;
  }

  renderSections() {
    const hasVersion = ['v1', 'v2'].includes(this.version);
    const needsVersion = hasVersion ? '' : ' Choose a version under App Version first.';
    const workflowReady = hasVersion && !!this._workflow;
    const unavailable = this._workflow ? '' : html` ${this._workflowError}`;
    const validation = this._workflow?.validation || {};
    const sections = [
      {
        key: 'install',
        title: 'App Version',
        description: html`Which version this site uses. Configures Experience Workspace extension and app.${unavailable}`,
        status: this.installStatus(),
        body: () => this.renderInstallBody(),
        // The install goes through the worker, so it needs the workflow view (and its `version`).
        editable: !!this._workflow,
      },
      {
        key: 'rules',
        title: 'Approval rules',
        description: html`Who approves which pages${this.version === 'v2' ? ', in which steps' : ''}, and the distribution lists they use.${needsVersion}${unavailable}`,
        status: this.rulesStatus(),
        body: () => this.renderRulesBody(),
        editable: workflowReady,
        notes: [...(validation.errors || []), ...(validation.warnings || [])].map(describeProblem),
      },
      {
        key: 'settings',
        title: 'Settings',
        description: html`${this.version === 'v2' ? 'Comment rules, author guidance, support contact and colors.' : 'Comment rules, CC approvals, support contact and colors.'}
          ${hasVersion ? html`<a href=${SETTINGS_DOCS[this.version]} target="_blank" rel="noopener">What each setting does</a>` : nothing}${needsVersion}${unavailable}`,
        status: this.settingsStatus(),
        body: () => this.renderSettingsBody(),
        editable: workflowReady && this.source !== 'org',
      },
    ];
    const openPermissions = permissionsNotice(this._permissionsMode);
    return html`
      ${openPermissions ? html`<div class="message warning" role="status">${openPermissions}
        <a href=${PERMISSIONS_DOCS} target="_blank" rel="noopener">Set up DA permissions</a></div>` : nothing}
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
      // Every Request Publish call needs the EDS site, so nothing is offered here.
      return html`<div class="message error" role="alert"><strong>${this._org}/${this._site}</strong>: ${SITE_PROBLEMS['site-not-found']}</div>`;
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
