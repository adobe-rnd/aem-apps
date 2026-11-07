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
  pageKey, pagePathFrom, header, sourceRows, targetTree, targetRows, targetSummary,
  pageActions, canPropagate, rolloutOptions, runSummary, translatingPages, describeFailure,
  jobMessage, jobsWorthNoting, doneMessage,
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

const badge = (entry, extra = '') => (entry
  ? html`<span class="badge ${entry.tone ?? 'neutral'} ${extra}">${entry.label}</span>`
  : nothing);

const overridden = (flag) => (flag
  ? html`<span class="badge outline" title="This page has local edits since it was last synced">Overridden</span>`
  : nothing);

const lang = (location) => (location?.language
  ? html`<span class="lang" title=${location.label ?? ''}>${location.language.toUpperCase()}</span>`
  : nothing);

const spinner = (label = 'Working') => html`<span class="spinner" role="img" aria-label=${label}></span>`;

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
  };

  constructor() {
    super();
    this.phase = 'loading';
    this.results = new Map();
    this.tree = [];
    this.busy = new Set();
    this.targetsPhase = 'loading';
  }

  connectedCallback() {
    super.connectedCallback();
    if (styles) this.shadowRoot.adoptedStyleSheets = [styles];
    this.unsubscribe = this.localization.subscribe?.(() => this.reload());
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
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
    const ancestors = this.result.chain.slice(1).map(({ ref }) => this.loadPage(ref));
    await Promise.all([...ancestors, this.loadTargets()]);
    if (autoCheck) this.autoCheck();
  }

  async loadTargets() {
    this.targetsPhase = 'loading';
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
        const partial = result?.partial ? ' Content was partly written; run Update again to repair.' : '';
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

  propagate() {
    const option = this.runOption ?? rolloutOptions(targetRows(this.tree), this.results)[0];
    return this.withBusy('propagate', async () => {
      this.run = { items: [] };
      const run = await this.localization.propagate({
        pages: [this.page],
        option,
        title: `Update all from ${this.path}`,
        onProgress: (progress) => { this.run = { ...progress, items: [...progress.items] }; },
      });
      this.run = { ...run, items: [...run.items] };
      await this.reload();
    });
  }

  review(page) {
    if (this.localization.resolveReview) {
      return this.withBusy(pageKey(page), async () => {
        await this.localization.resolveReview(page.site, page.path);
        this.say('Mock: changes reviewed and accepted', 'positive');
        await this.reload();
      });
    }
    window.open(editUrl(this.org, page.site, page.path), '_blank', 'noopener');
    return null;
  }

  pressButton(button) {
    this.confirm = null;
    if (button.kind === 'execute') return this.execute(this.page, button);
    if (button.kind === 'check') return this.checkJobs([this.page]);
    if (button.kind === 'preview') return this.publish(this.page, { live: false });
    if (button.kind === 'publish') return this.publish(this.page, { live: true });
    return null;
  }

  appLink() {
    const params = new URLSearchParams({ org: this.org, site: this.site, path: this.path });
    const ref = appRef();
    if (ref) params.set('ref', ref);
    return `${APP_URL}?${params.toString()}`;
  }

  renderHeader() {
    const publishState = this.localization.publishState?.(this.site, this.path);
    const info = header(this.result, { ...this.page, publishState });
    return html`
      <header class="head">
        <div class="head-title">
          <h1>${info.title}</h1>
          <a class="quiet-link" href=${this.appLink()} target="_blank" rel="noopener">Open MSM app ↗</a>
        </div>
        <p class="path">${info.site}:${info.path}</p>
        <p class="where">${info.location}${info.level && info.level !== info.location ? html` · ${info.level}` : nothing}</p>
        <div class="badges">
          ${lang(this.result.location)}
          <span class="badge type">${info.type.label}${info.type.detail ? html` · ${info.type.detail}` : nothing}</span>
          ${badge(info.sync)}
          ${overridden(info.overridden)}
          ${badge(info.publish)}
          ${this.mode === 'mock' ? html`<span class="badge informative">Mock data</span>` : nothing}
        </div>
      </header>`;
  }

  renderMessage() {
    if (!this.message) return nothing;
    return html`
      <div class="message ${this.message.tone}" role="status">
        <span>${this.message.text}</span>
        <button type="button" class="dismiss" aria-label="Dismiss" @click=${() => { this.message = null; }}>×</button>
      </div>`;
  }

  renderButton(button) {
    const busy = this.busy.has(pageKey(this.page)) || this.busy.has(button.kind);
    if (this.confirm === button.id) {
      return html`
        <div class="confirm ${button.destructive ? 'destructive' : ''}" role="alertdialog" aria-label="Confirm ${button.label}">
          <p>${button.confirm}</p>
          <div class="row">
            <button type="button" class="btn" @click=${() => { this.confirm = null; }}>Cancel</button>
            <button type="button" class="btn ${button.destructive ? 'destructive' : 'accent'}" @click=${() => this.pressButton(button)}>${button.label}</button>
          </div>
        </div>`;
    }
    const tone = [button.primary ? 'accent' : '', button.destructive ? 'destructive' : ''].join(' ');
    return html`
      <span class="action">
        <button type="button" class="btn ${tone}" aria-disabled=${String(!button.enabled || busy)}
          title=${button.reason || nothing}
          @click=${() => {
    if (!button.enabled || busy) return;
    if (button.confirm) this.confirm = button.id;
    else this.pressButton(button);
  }}>${button.label}</button>
        ${button.enabled ? nothing : html`<span class="reason">${button.reason}</span>`}
      </span>`;
  }

  renderActions() {
    const { review, groups } = pageActions(this.result);
    const busy = this.busy.has(pageKey(this.page)) || this.busy.has('check');
    return html`
      <section aria-labelledby="actions-h">
        <h2 id="actions-h">This page ${busy ? spinner() : nothing}</h2>
        ${groups.length || review ? html`<dl class="groups">
          ${review ? html`<div class="group"><dt>Review</dt><dd><span class="action">
            <button type="button" class="btn accent" @click=${() => this.review(this.page)}>Review changes</button>
            <span class="reason">Accept or reject the merged changes first</span></span></dd></div>` : nothing}
          ${groups.map((group) => html`
            <div class="group">
              <dt>${group.title}</dt>
              <dd>${group.buttons.map((button) => this.renderButton(button))}</dd>
            </div>`)}
        </dl>` : html`<p class="muted">No actions available for this page.</p>`}
      </section>`;
  }

  renderSources() {
    const rows = sourceRows(this.result, this.results);
    if (!rows.length) return nothing;
    return html`
      <section aria-labelledby="source-h">
        <h2 id="source-h">Source</h2>
        <ol class="list">
          ${rows.map((row) => html`
            <li class="item">
              ${lang(row.location)}
              <span class="item-text">
                <span class="item-name">${row.location.label}<span class="muted"> · ${row.level}${row.direct ? ' · source page' : ''}</span></span>
                <span class="path">${row.site === this.site ? row.path : `${row.site}:${row.path}`}</span>
              </span>
              <span class="item-status">
                ${row.type ? html`<span class="badge type">${row.type.label}</span>` : spinner('Loading')}
                ${badge(row.sync)}
                ${overridden(row.overridden)}
              </span>
              ${row.exists ? html`<a class="btn small quiet" href=${editUrl(this.org, row.site, row.path)} target="_blank" rel="noopener">Open</a>` : html`<span class="btn-spacer"></span>`}
            </li>`)}
        </ol>
      </section>`;
  }

  renderTargetRow(row) {
    const page = { site: row.site, path: row.path };
    const busy = this.busy.has(row.key);
    const next = row.next && html`<button type="button" class="btn small ${row.next.kind === 'review' ? '' : 'accent'}"
      aria-disabled=${String(busy)} @click=${() => {
  if (busy) return;
  if (row.next.kind === 'review') this.review(page);
  else this.execute(page, row.next);
}}>${row.next.label}</button>`;
    return html`
      <li class="item" style="--depth: ${row.depth}">
        ${lang(row.location)}
        <span class="item-text">
          <span class="item-name">${row.location.label}</span>
          <span class="path">${row.site === this.site ? row.path : `${row.site}:${row.path}`}</span>
        </span>
        <span class="item-status">
          ${row.type ? html`<span class="badge type" title=${row.type.detail ?? ''}>${row.type.label}</span>` : spinner('Loading')}
          ${badge(row.sync)}
          ${overridden(row.overridden)}
        </span>
        ${busy ? spinner() : next || html`<span class="btn-spacer"></span>`}
      </li>`;
  }

  renderRun() {
    const summary = runSummary(this.run);
    if (!summary) return nothing;
    return html`
      <div class="run" role="status" aria-live="polite">
        <p class="run-head">
          ${summary.finished ? html`<strong>Update finished</strong>` : html`${spinner()} <strong>Updating…</strong>`}
          <span class="muted">${summary.total} page${summary.total === 1 ? '' : 's'}</span>
          ${summary.finished ? html`<button type="button" class="dismiss" aria-label="Dismiss" @click=${() => { this.run = null; }}>×</button>` : nothing}
        </p>
        <div class="badges">${summary.counts.map((entry) => html`<span class="badge ${entry.tone}">${entry.label} ${entry.count}</span>`)}</div>
        ${summary.issues.length ? html`<ul class="issues">
          ${summary.issues.map((issue) => html`<li><span class="path">${issue.site === this.site ? issue.path : `${issue.site}:${issue.path}`}</span> ${issue.label}${issue.reason ? html`: ${issue.reason}` : nothing}</li>`)}
        </ul>` : nothing}
      </div>`;
  }

  renderTargets() {
    if (this.targetsPhase === 'loading') {
      return html`<section><h2>Pages that use this as their source</h2><p class="muted">${spinner('Loading')} Finding pages…</p></section>`;
    }
    if (this.targetsPhase === 'error') {
      return html`<section><h2>Pages that use this as their source</h2><p class="error-text">Could not load the pages that use this page.</p></section>`;
    }
    const rows = targetRows(this.tree, this.results);
    if (!rows.length) return nothing;
    const summary = targetSummary(rows);
    const options = rolloutOptions(rows, this.results);
    const option = this.runOption ?? options[0];
    const propagating = this.busy.has('propagate');
    const cascading = this.busy.has('cascade');
    const allowed = canPropagate(this.result, rows);
    return html`
      <section aria-labelledby="targets-h">
        <h2 id="targets-h">Pages that use this as their source
          <span class="muted">${summary.total} · ${summary.needsAction} need action</span></h2>
        <div class="row bulk">
          <button type="button" class="btn accent" aria-disabled=${String(!allowed || propagating)}
            title=${allowed ? 'Updates every page below, level by level' : 'This page has no content yet'}
            @click=${() => { if (allowed && !propagating) this.propagate(); }}>Update all</button>
          <label class="option">Changes:
            <select .value=${option} @change=${(event) => { this.runOption = event.target.value; }}>
              ${options.map((each) => html`<option value=${each} ?selected=${each === option}>${OPTION_LABELS[each] ?? each}</option>`)}
            </select>
          </label>
          <button type="button" class="btn" aria-disabled=${String(!allowed || cascading)}
            title="Publishes this page and every inherited page below it"
            @click=${() => { if (allowed && !cascading) this.publish(this.page, { cascade: true }); }}>Publish with inherited pages</button>
          ${propagating || cascading ? spinner() : nothing}
        </div>
        ${this.renderRun()}
        <ul class="list tree">${rows.map((row) => this.renderTargetRow(row))}</ul>
      </section>`;
  }

  renderBody() {
    if (this.phase === 'loading') return html`<p class="muted state">${spinner('Loading')} Loading page status…</p>`;
    if (this.phase === 'error') return html`<p class="error-text state" role="alert">Could not load: ${this.error}</p>`;
    if (this.phase === 'none') {
      return html`<p class="muted state"><strong>${this.site}:${this.path}</strong> is not in any configured location.</p>`;
    }
    return html`
      ${this.renderHeader()}
      ${this.renderMessage()}
      ${this.renderActions()}
      ${this.renderSources()}
      ${this.renderTargets()}`;
  }

  render() {
    return html`
      ${this.notice ? html`<p class="notice">${this.notice}</p>` : nothing}
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
  return {
    mode: 'real',
    org: context.org,
    site,
    path: pagePathFrom(context.path),
    localization: createRealLocalization({ org: context.org, actions }),
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
