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
/* eslint-disable import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import { editUrl, OPTION_LABELS } from '../../apps/msm-next/data/display.js';
import {
  pageKey, pagePathFrom, header, sourceInfo, detailRows, stateCard, menuItems, targetTree,
  targetRows, canPropagate, rolloutOptions, runSummary, translatingPages, describeFailure,
  jobMessage, jobsWorthNoting, doneMessage, pickerRows, togglePick, localeBadge,
} from './model.js';

const NX = 'https://da.live/nx';
const SDK_TIMEOUT = 5000;
const APP_URL = 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/msm-next/msm-next';
const MOCK_PATH = '/emea/hardware/console.html';

let styles = null;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  styles = await getStyle(import.meta.url);
} catch (e) {
  console.warn('[MSM next plugin] Failed to load styles:', e);
}

const pill = (entry, extra = '') => (entry
  ? html`<span class="pill ${entry.tone ?? 'neutral'} ${extra}">${entry.label}</span>`
  : nothing);

const locale = (language, title = '') => (language
  ? html`<span class="locale" title=${title}>${localeBadge(language)}</span>`
  : nothing);

const spinner = (label = 'Working') => html`<span class="spinner" role="img" aria-label=${label}></span>`;

const CARD_ICONS = {
  negative: '!', notice: 'i', informative: 'i', neutral: 'i',
};

function appRef() {
  try {
    const { hostname } = new URL(import.meta.url);
    if (hostname === 'localhost') return 'local';
    if (!hostname.endsWith('.aem.page') && !hostname.endsWith('.aem.live')) return null;
    const [branch] = hostname.split('--');
    return branch === 'main' ? null : branch;
  } catch {
    return null;
  }
}

class MsmNextPlugin extends LitElement {
  static properties = {
    localization: { attribute: false },
    org: { attribute: false },
    site: { attribute: false },
    path: { attribute: false },
    mode: { attribute: false },
    notice: { attribute: false },
    phase: { state: true },
    error: { state: true },
    result: { state: true },
    results: { state: true },
    tree: { state: true },
    busy: { state: true },
    message: { state: true },
    confirm: { state: true },
    run: { state: true },
    runOption: { state: true },
    targetsPhase: { state: true },
    menuOpen: { state: true },
    picking: { state: true },
    picked: { state: true },
  };

  constructor() {
    super();
    this.phase = 'loading';
    this.results = new Map();
    this.tree = [];
    this.busy = new Set();
    this.targetsPhase = 'loading';
    this.menuOpen = false;
    this.picking = false;
    this.picked = new Set();
    this.onDocumentClick = (event) => {
      if (this.menuOpen && !event.composedPath().includes(this.shadowRoot.querySelector('.menu-wrap'))) {
        this.menuOpen = false;
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    if (styles) this.shadowRoot.adoptedStyleSheets = [styles];
    this.unsubscribe = this.localization.subscribe?.(() => this.reload());
    document.addEventListener('click', this.onDocumentClick);
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    document.removeEventListener('click', this.onDocumentClick);
  }

  get page() { return { site: this.site, path: this.path }; }

  setResult(key, result) {
    const results = new Map(this.results);
    results.set(key, result);
    this.results = results;
  }

  async loadPage(page) {
    try {
      const result = await this.localization.page(page.site, page.path);
      this.setResult(pageKey(page), result);
      return result;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async load({ autoCheck = true } = {}) {
    this.error = '';
    try {
      this.result = await this.localization.page(this.site, this.path);
      this.phase = this.result?.location ? 'ready' : 'none';
    } catch (e) {
      console.error(e);
      this.error = e.message || String(e);
      this.phase = 'error';
      return;
    }
    if (this.phase !== 'ready') return;
    await this.loadTargets();
    if (autoCheck) this.autoCheck();
  }

  async loadTargets() {
    if (!this.tree.length) this.targetsPhase = 'loading';
    try {
      const model = await this.localization.orgModel();
      this.tree = targetTree(model, this.page);
      this.targetsPhase = 'ready';
      const rows = targetRows(this.tree);
      await Promise.all(rows.map((row) => this.loadPage(row)));
    } catch (e) {
      console.error(e);
      this.targetsPhase = 'error';
    }
  }

  reload() {
    this.localization.refresh?.();
    return this.load({ autoCheck: false });
  }

  autoCheck() {
    const pages = translatingPages(this.page, this.result, targetRows(this.tree), this.results);
    if (pages.length) this.checkJobs(pages, true);
  }

  async checkJobs(pages, quiet = false) {
    await this.withBusy('check', async () => {
      const jobs = this.localization.checkJobs
        ? await this.localization.checkJobs(pages)
        : [];
      await this.reload();
      if (!quiet || jobsWorthNoting(jobs)) this.say(jobMessage(jobs), 'informative');
    });
  }

  say(text, tone = 'neutral') {
    this.message = { text, tone };
  }

  async withBusy(key, task) {
    if (this.busy.has(key)) return;
    this.busy = new Set([...this.busy, key]);
    if (key !== 'check') this.message = null;
    try {
      await task();
    } catch (e) {
      console.error(e);
      this.say(e.message || String(e), 'negative');
    } finally {
      const busy = new Set(this.busy);
      busy.delete(key);
      this.busy = busy;
    }
  }

  execute(page, { action, option, label }) {
    return this.withBusy(pageKey(page), async () => {
      const result = await this.localization.execute({
        site: page.site, path: page.path, action, option,
      });
      if (result?.ok) {
        const warn = result.warnings?.length ? ` (warnings: ${result.warnings.join(', ')})` : '';
        this.say(`${doneMessage(action, label)}${warn}`, result.warnings?.length ? 'notice' : 'positive');
      } else {
        const partial = result?.partial ? ' Content was partly written; sync again to repair.' : '';
        this.say(`${label} failed. ${describeFailure(result)}.${partial}`, 'negative');
      }
      await this.reload();
    });
  }

  publish(page, { live = true, cascade = false } = {}) {
    const key = cascade ? 'cascade' : pageKey(page);
    return this.withBusy(key, async () => {
      const result = await this.localization.publish({
        site: page.site, path: page.path, live, cascade,
      });
      const count = result?.results?.length ?? 0;
      const verb = live ? 'Published' : 'Previewed';
      if (result?.ok) {
        this.say(`${verb} ${count} page${count === 1 ? '' : 's'}`, 'positive');
      } else {
        const failed = (result?.results ?? []).filter((entry) => !entry.ok);
        this.say(`${verb} failed for ${failed.length} of ${count}: ${failed[0]?.error ?? ''}`, 'negative');
      }
      this.requestUpdate();
    });
  }

  propagate(targets) {
    const option = this.runOption ?? rolloutOptions(targetRows(this.tree), this.results)[0];
    this.picking = false;
    return this.withBusy('propagate', async () => {
      this.run = { items: [] };
      const run = await this.localization.propagate({
        pages: [this.page],
        targets,
        option,
        title: `Update linked variations of ${this.path}`,
        onProgress: (progress) => { this.run = { ...progress, items: [...progress.items] }; },
      });
      this.run = { ...run, items: [...run.items] };
      await this.reload();
    });
  }

  resolveReview() {
    return this.withBusy(pageKey(this.page), async () => {
      await this.localization.resolveReview(this.site, this.path);
      this.say('Mock: changes reviewed and accepted', 'positive');
      await this.reload();
    });
  }

  openSource() {
    const source = sourceInfo(this.result);
    if (source) window.open(editUrl(this.org, source.site, source.path), '_blank', 'noopener');
  }

  press(item) {
    this.confirm = null;
    this.menuOpen = false;
    const handlers = {
      execute: () => this.execute(this.page, item),
      check: () => this.checkJobs([this.page]),
      preview: () => this.publish(this.page, { live: false }),
      publish: () => this.publish(this.page, { live: true }),
      cascade: () => this.publish(this.page, { cascade: true }),
      compare: () => this.openSource(),
      source: () => this.openSource(),
      resolve: () => this.resolveReview(),
    };
    return handlers[item.kind]?.() ?? null;
  }

  request(item) {
    if (!item.enabled || this.isBusy()) return;
    if (item.confirm) {
      this.menuOpen = false;
      this.confirm = item;
      this.updateComplete.then(() => this.shadowRoot.querySelector('.confirm .btn')?.focus());
      return;
    }
    this.press(item);
  }

  isBusy() {
    return this.busy.has(pageKey(this.page)) || this.busy.has('check');
  }

  appLink() {
    const params = new URLSearchParams({ org: this.org, site: this.site, path: this.path });
    const ref = appRef();
    if (ref) params.set('ref', ref);
    return `${APP_URL}?${params.toString()}`;
  }

  menu() {
    const source = sourceInfo(this.result);
    return menuItems(this.result, {
      hasTargets: this.tree.length > 0,
      sourceUrl: source ? editUrl(this.org, source.site, source.path) : null,
      appUrl: this.appLink(),
      canResolve: Boolean(this.localization.resolveReview),
    });
  }

  toggleMenu(open = !this.menuOpen) {
    this.menuOpen = open;
    if (open) {
      this.updateComplete.then(() => this.shadowRoot.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus());
    }
  }

  onMenuKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.menuOpen = false;
      this.shadowRoot.querySelector('.menu-trigger')?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...this.shadowRoot.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(this.shadowRoot.activeElement);
    const moves = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    items[moves[event.key]]?.focus();
  }

  renderMenuItem(item, index, items) {
    const separator = index > 0 && items[index - 1].group !== item.group
      ? html`<li role="separator" class="separator"></li>` : nothing;
    if (item.kind === 'link') {
      return html`${separator}<li role="none"><a role="menuitem" class="menu-item" href=${item.href}
        target="_blank" rel="noopener" @click=${() => { this.menuOpen = false; }}>${item.label} <span aria-hidden="true">↗</span></a></li>`;
    }
    return html`${separator}<li role="none"><button type="button" role="menuitem"
      class="menu-item ${item.destructive ? 'destructive' : ''}" aria-disabled=${String(!item.enabled)}
      title=${item.reason || nothing} @click=${() => this.request(item)}>
      <span>${item.label}</span>
      ${item.enabled ? nothing : html`<span class="menu-reason">${item.reason}</span>`}
    </button></li>`;
  }

  renderTop() {
    const items = this.phase === 'ready' ? this.menu() : [];
    return html`
      <div class="top">
        <span class="panel-name">Multi-site</span>
        ${this.mode === 'mock' ? html`<span class="mock">Mock data</span>` : nothing}
        ${items.length ? html`<div class="menu-wrap" @keydown=${this.onMenuKey}>
          <button type="button" class="menu-trigger" aria-label="More actions" aria-haspopup="menu"
            aria-expanded=${String(this.menuOpen)} @click=${() => this.toggleMenu()}>⋯</button>
          ${this.menuOpen ? html`<ul class="menu" role="menu" aria-label="More actions">
            ${items.map((item, index) => this.renderMenuItem(item, index, items))}
          </ul>` : nothing}
        </div>` : nothing}
      </div>`;
  }

  renderHeader() {
    const info = header(this.result, this.page);
    return html`
      <header class="head">
        <div class="title-row">
          <h1>${info.title}</h1>
          ${locale(this.result.location?.language, info.badgeTitle)}
        </div>
        <div class="status-row">
          ${pill(info.pill)}
          ${info.overridden ? html`<span class="pill outline" title="This page has local edits since it was last synced">Overridden</span>` : nothing}
          ${this.isBusy() ? spinner() : nothing}
          ${info.lastSynced ? html`<span class="synced">Last synced ${info.lastSynced}</span>` : nothing}
        </div>
      </header>`;
  }

  renderMessage() {
    if (!this.message) return nothing;
    return html`
      <div class="toast ${this.message.tone}" role="status">
        <span>${this.message.text}</span>
        <button type="button" class="dismiss" aria-label="Dismiss" @click=${() => { this.message = null; }}>×</button>
      </div>`;
  }

  renderConfirm() {
    const item = this.confirm;
    if (!item) return nothing;
    return html`
      <div class="confirm ${item.destructive ? 'destructive' : ''}" role="alertdialog" aria-label="Confirm ${item.label}"
        @keydown=${(event) => { if (event.key === 'Escape') this.confirm = null; }}>
        <p><strong>${item.label}?</strong> ${item.confirm}</p>
        <div class="row">
          <button type="button" class="btn" @click=${() => { this.confirm = null; }}>Cancel</button>
          <button type="button" class="btn ${item.destructive ? 'destructive-fill' : 'accent'}" @click=${() => this.press(item)}>${item.label}</button>
        </div>
      </div>`;
  }

  renderCardButton(button) {
    const disabled = !button.enabled || this.isBusy();
    const style = { primary: 'btn accent', secondary: 'btn', link: 'link-btn' }[button.style] ?? 'btn';
    return html`
      <span class="action">
        <button type="button" class=${style} aria-disabled=${String(disabled)} title=${button.reason || nothing}
          @click=${() => this.request(button)}>${button.label}</button>
        ${button.enabled ? nothing : html`<span class="reason">${button.reason}</span>`}
      </span>`;
  }

  renderCard(card) {
    if (!card) return nothing;
    return html`
      <div class="card ${card.tone}" role="region" aria-label=${card.title}>
        <div class="card-head">
          <span class="card-icon" aria-hidden="true">${CARD_ICONS[card.tone] ?? 'i'}</span>
          <h2>${card.title}</h2>
        </div>
        ${card.text ? html`<p>${card.text}</p>` : nothing}
        ${card.note ? html`<p class="card-note">${card.note}</p>` : nothing}
        ${card.buttons.length ? html`<div class="row">${card.buttons.map((button) => this.renderCardButton(button))}</div>` : nothing}
      </div>`;
  }

  renderVariation(row) {
    return html`
      <li class="variation" style="--depth: ${row.depth}">
        ${locale(row.location.language, row.location.label)}
        <span class="variation-name">
          <a href=${editUrl(this.org, row.site, row.path)} target="_blank" rel="noopener">${row.location.label}</a>
          ${row.site === this.site ? nothing : html`<span class="muted">${row.site}</span>`}
        </span>
        ${this.busy.has(row.key) ? spinner() : nothing}
        ${row.overridden ? html`<span class="pill outline small" title="Local edits since last sync">Overridden</span>` : nothing}
        ${row.pill ? pill(row.pill, 'small') : spinner('Loading')}
      </li>`;
  }

  renderRun() {
    const summary = runSummary(this.run);
    if (!summary) return nothing;
    return html`
      <div class="run" role="status" aria-live="polite">
        <p class="run-head">
          ${summary.finished ? html`<strong>Run finished</strong>` : html`${spinner()} <strong>Updating…</strong>`}
          <span class="muted">${summary.total} page${summary.total === 1 ? '' : 's'}</span>
          ${summary.finished ? html`<button type="button" class="dismiss" aria-label="Dismiss" @click=${() => { this.run = null; }}>×</button>` : nothing}
        </p>
        <div class="pills">${summary.counts.map((entry) => html`<span class="pill small ${entry.tone}">${entry.label} ${entry.count}</span>`)}</div>
        ${summary.issues.length ? html`<ul class="issues">
          ${summary.issues.map((issue) => html`<li><span class="path">${issue.site === this.site ? issue.path : `${issue.site}:${issue.path}`}</span> ${issue.label}${issue.reason ? html`: ${issue.reason}` : nothing}</li>`)}
        </ul>` : nothing}
      </div>`;
  }

  openPicker() {
    const rows = pickerRows(this.tree, Math.max((this.result.chain?.length ?? 1) - 1, 0));
    this.picked = new Set(rows.map((row) => row.id));
    this.picking = true;
  }

  renderPicker(rows) {
    const options = rolloutOptions(targetRows(this.tree), this.results);
    const option = this.runOption ?? options[0];
    const picks = pickerRows(this.tree, Math.max((this.result.chain?.length ?? 1) - 1, 0));
    const selected = picks.filter((row) => this.picked.has(row.id));
    return html`
      <div class="picker" role="group" aria-label="Choose locations">
        <p class="picker-head"><strong>Create or update in</strong>
          <span class="muted">${selected.length} of ${picks.length}</span>
          <button type="button" class="link-btn small" @click=${() => { this.picked = new Set(picks.map((row) => row.id)); }}>All</button>
          <button type="button" class="link-btn small" @click=${() => { this.picked = new Set(); }}>None</button></p>
        <ul class="picks">
          ${picks.map((row) => html`
            <li style="--depth: ${row.depth}">
              <label>
                <input type="checkbox" .checked=${this.picked.has(row.id)}
                  @change=${(event) => { this.picked = togglePick(picks, this.picked, row.id, event.target.checked); }} />
                <span>${row.label}</span>
                <span class="muted">${row.level}</span>
              </label>
            </li>`)}
        </ul>
        <fieldset class="options">
          <legend>Changes on existing pages</legend>
          ${options.map((each) => html`<label><input type="radio" name="run-option" .checked=${each === option}
            @change=${() => { this.runOption = each; }} /> ${OPTION_LABELS[each] ?? each}</label>`)}
        </fieldset>
        <div class="row">
          <button type="button" class="btn accent" aria-disabled=${String(!selected.length || !rows.length)}
            @click=${() => { if (selected.length) this.propagate(selected.map((row) => row.id)); }}>Run</button>
          <button type="button" class="btn" @click=${() => { this.picking = false; }}>Cancel</button>
        </div>
      </div>`;
  }

  renderVariations(card) {
    const locked = Boolean(card?.locksVariations);
    const head = html`
      <h2 id="variations-h">Linked variations</h2>
      <p class="sub">Linked variations inherit content from this page.</p>`;
    if (this.targetsPhase === 'loading') {
      return html`<section class="variations" aria-labelledby="variations-h">${head}<p class="muted">${spinner('Loading')} Finding linked variations…</p></section>`;
    }
    if (this.targetsPhase === 'error') {
      return html`<section class="variations" aria-labelledby="variations-h">${head}<p class="error-text">Could not load linked variations.</p></section>`;
    }
    const rows = targetRows(this.tree, this.results);
    const allowed = canPropagate(this.result, rows) && !locked;
    const propagating = this.busy.has('propagate');
    const cascading = this.busy.has('cascade');
    const why = locked ? 'Resolve the conflicts on this page first' : 'This page has no content yet';
    return html`
      <section class="variations ${locked ? 'locked' : ''}" aria-labelledby="variations-h" aria-disabled=${String(locked)}>
        ${head}
        ${locked ? html`<p class="lock-note">Resolve the conflicts on this page to work with its linked variations.</p>` : nothing}
        ${rows.length ? html`<ul class="variation-list">${rows.map((row) => this.renderVariation(row))}</ul>`
    : html`<p class="muted">No locations use this page's location as their source.</p>`}
        ${rows.length ? html`<div class="row">
          <button type="button" class="pill-btn" aria-disabled=${String(!allowed || propagating)}
            aria-expanded=${String(this.picking)} title=${allowed ? 'Choose locations to create or update' : why}
            @click=${() => { if (allowed && !propagating) this.openPicker(); }}>+ Create linked variation</button>
          <button type="button" class="link-btn" aria-disabled=${String(!allowed || cascading)}
            title="Publishes this page and every inherited page below it"
            @click=${() => { if (allowed && !cascading) this.publish(this.page, { cascade: true }); }}>Publish with inherited pages</button>
          ${propagating || cascading ? spinner() : nothing}
        </div>` : nothing}
        ${this.picking && allowed ? this.renderPicker(rows) : nothing}
        ${this.renderRun()}
      </section>`;
  }

  renderDetails() {
    const publishState = this.localization.publishState?.(this.site, this.path);
    const rows = detailRows(this.result, { site: this.site, publishState });
    return html`
      <details class="details" open>
        <summary>Page details</summary>
        <dl>
          ${rows.map((row) => html`
            <div class="detail">
              <dt>${row.label}</dt>
              <dd>${row.value}${row.detail ? html`<span class="muted">${row.detail}</span>` : nothing}</dd>
            </div>`)}
        </dl>
      </details>`;
  }

  renderBody() {
    if (this.phase === 'loading') return html`<p class="muted state">${spinner('Loading')} Loading page status…</p>`;
    if (this.phase === 'error') return html`<p class="error-text state" role="alert">Could not load: ${this.error}</p>`;
    if (this.phase === 'none') {
      return html`<p class="muted state"><strong>${this.site}:${this.path}</strong> is not in any configured location.</p>`;
    }
    const card = stateCard(this.result);
    return html`
      ${this.renderHeader()}
      ${this.renderConfirm()}
      ${this.renderCard(card)}
      ${this.renderMessage()}
      ${this.renderVariations(card)}
      ${this.renderDetails()}`;
  }

  render() {
    return html`
      ${this.renderTop()}
      ${this.notice ? html`<p class="banner">${this.notice}</p>` : nothing}
      ${this.renderBody()}`;
  }
}

customElements.define('msm-next-plugin', MsmNextPlugin);

const timeout = (ms) => new Promise((resolve) => { setTimeout(() => resolve(null), ms); });

async function mockSetup(params, notice) {
  const [{ default: createMockLocalization }, { MOCK_ORG, MOCK_SITE }] = await Promise.all([
    import('../../apps/msm-next/data/mock/mock-localization.js'),
    import('../../apps/msm-next/data/mock/fixture.js'),
  ]);
  return {
    mode: 'mock',
    org: MOCK_ORG,
    site: params.get('site') || MOCK_SITE,
    path: pagePathFrom(params.get('path') || MOCK_PATH),
    localization: createMockLocalization(),
    notice,
  };
}

async function resolveSetup() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mock') === '1') return mockSetup(params);
  const sdk = await Promise.race([DA_SDK, timeout(SDK_TIMEOUT)]);
  if (!sdk?.actions?.daFetch) return mockSetup(params, 'DA did not respond, so this shows mock data.');
  const { context, actions } = sdk;
  const site = context.site || context.repo;
  const { default: createRealLocalization } = await import('./real-localization.js');
  const translateDelay = Number(params.get('translateDelay')) || 0;
  const localization = await createRealLocalization({ org: context.org, actions, translateDelay });
  return {
    mode: 'real',
    org: context.org,
    site,
    path: pagePathFrom(context.path),
    localization,
    notice: localization.translationError
      ? `Translation is not available: ${localization.translationError}`
      : undefined,
  };
}

(async function init() {
  try {
    const setup = await resolveSetup();
    const plugin = document.createElement('msm-next-plugin');
    Object.assign(plugin, setup);
    document.body.append(plugin);
  } catch (error) {
    console.error('[MSM next plugin] Initialization error:', error);
    const pre = document.createElement('pre');
    pre.className = 'init-error';
    pre.textContent = `Failed to initialise MSM plugin: ${error.message}`;
    document.body.append(pre);
  }
}());
