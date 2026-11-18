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
import createStore from './store.js';
import createMerger from './merge.js';
import {
  pagePathFrom, proposalsForPage, isDraftPath, mergeCheck, typeLabel, formatDate, canvasUrl,
  applyMerged, applyRejected, previewPath, PROPOSALS_ROOT,
} from './model.js';

const NX = 'https://da.live/nx';
const SDK_TIMEOUT = 5000;
const ENGINE_URL = `${NX}/public/loc/regional-diff.js`;

let styles = null;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  styles = await getStyle(import.meta.url);
} catch (e) {
  console.warn('[Proposals plugin] Failed to load styles:', e);
}

const parse = (text) => new DOMParser().parseFromString(text, 'text/html');

const messageOf = (error) => error?.message || String(error);

function renderChanges(entry) {
  if (!entry.changes.length) return nothing;
  return html`
    <ul class="changes">
      ${entry.changes.map((change) => html`
        <li>
          <span class="change-type">${typeLabel(change.type)}</span>
          <span class="change-why">${change.rationale}</span>
        </li>`)}
    </ul>`;
}

function renderCheck(card) {
  if (!card?.check || card.check === 'running') return html`<p class="muted">Checking the merge…</p>`;
  if (card.check === 'failed') return html`<p class="check negative">${card.checkError}</p>`;
  const check = mergeCheck(card.result);
  return html`<p class="check ${check.tone}">${check.label}</p>`;
}

class ProposalsPlugin extends LitElement {
  static properties = {
    store: { attribute: false },
    merger: { attribute: false },
    org: { attribute: false },
    site: { attribute: false },
    path: { attribute: false },
    phase: { state: true },
    error: { state: true },
    entries: { state: true },
    sourceOf: { state: true },
    cards: { state: true },
    notice: { state: true },
    found: { state: true },
    problems: { state: true },
  };

  constructor() {
    super();
    this.phase = 'loading';
    this.entries = [];
    this.sourceOf = [];
    this.found = [];
    this.problems = [];
    this.cards = new Map();
  }

  connectedCallback() {
    super.connectedCallback();
    if (styles) this.shadowRoot.adoptedStyleSheets = [styles];
    this.load();
  }

  patchCard(id, patch) {
    const cards = new Map(this.cards);
    cards.set(id, { ...cards.get(id), ...patch });
    this.cards = cards;
  }

  async load() {
    this.phase = 'loading';
    this.error = null;
    this.notice = null;
    this.cards = new Map();
    if (isDraftPath(this.path)) {
      this.entries = [];
      this.sourceOf = [];
      this.phase = 'draft';
      return;
    }
    try {
      const { proposals: loaded, problems } = await this.store.listProposals();
      this.found = loaded.map((item) => item.proposal);
      this.problems = problems;
      const byId = new Map(loaded.map((item) => [item.proposal.id, item]));
      const { targeting, sourceOf } = proposalsForPage(
        loaded.map((item) => item.proposal),
        this.path,
      );
      this.entries = targeting.map((entry) => ({ ...entry, ...byId.get(entry.proposal.id) }));
      this.sourceOf = sourceOf;
      this.phase = 'ready';
      this.entries.forEach((entry) => this.runCheck(entry));
    } catch (error) {
      this.error = messageOf(error);
      this.phase = 'error';
    }
  }

  async runCheck(entry) {
    const { proposal, page } = entry;
    this.patchCard(proposal.id, { check: 'running', checkError: null });
    try {
      const result = await this.merger.check({
        draftPath: page.draftPath, target: page.target, baseVersionId: page.baseVersionId,
      });
      this.patchCard(proposal.id, { check: 'done', result });
    } catch (error) {
      this.patchCard(proposal.id, { check: 'failed', checkError: messageOf(error) });
    }
  }

  async showDiff(entry) {
    const { proposal, page } = entry;
    this.patchCard(proposal.id, { busy: 'diff', message: null });
    try {
      const result = await this.merger.preview({
        draftPath: page.draftPath, target: page.target, baseVersionId: page.baseVersionId,
      });
      if (result.unchanged) {
        this.patchCard(proposal.id, { busy: null, message: { tone: 'neutral', text: 'The proposal adds nothing to this page.' } });
        return;
      }
      await this.store.savePreview(proposal.id, page.target, result.html);
      const url = canvasUrl(this.org, this.site, previewPath(proposal.id, page.target));
      window.open(url, '_blank', 'noopener');
      this.patchCard(proposal.id, {
        busy: null,
        diffUrl: url,
        message: { tone: 'positive', text: `Opened the diff view with ${result.differences} marked ${result.differences === 1 ? 'difference' : 'differences'}.` },
      });
    } catch (error) {
      this.patchCard(proposal.id, { busy: null, message: { tone: 'negative', text: messageOf(error) } });
    }
  }

  async approve(entry) {
    const {
      proposal, page, raw, etag,
    } = entry;
    this.patchCard(proposal.id, { busy: 'approve', message: null });
    try {
      const result = await this.merger.merge({
        draftPath: page.draftPath, target: page.target, baseVersionId: page.baseVersionId,
      });
      const next = applyMerged(raw, [{ target: page.target, mode: 'smart' }], new Date().toISOString());
      await this.store.saveRecord(proposal.id, next, etag);
      const text = result.unchanged
        ? 'The page already had these changes. The proposal is marked as merged.'
        : 'Merged into this page. Preview and publish are not done yet.';
      await this.load();
      this.notice = { tone: 'positive', text: `${proposal.title}: ${text}` };
    } catch (error) {
      this.patchCard(proposal.id, { busy: null, confirm: null, message: { tone: 'negative', text: messageOf(error) } });
    }
  }

  async reject(entry, reason) {
    const { proposal, raw, etag } = entry;
    this.patchCard(proposal.id, { busy: 'reject', message: null });
    try {
      await this.store.saveRecord(
        proposal.id,
        applyRejected(raw, reason.trim(), new Date().toISOString()),
        etag,
      );
      await this.load();
      this.notice = { tone: 'neutral', text: `${proposal.title}: rejected. The drafts are kept.` };
    } catch (error) {
      this.patchCard(proposal.id, { busy: null, confirm: null, message: { tone: 'negative', text: messageOf(error) } });
    }
  }

  renderConfirm(entry, card) {
    const { proposal, page } = entry;
    const { id } = proposal;
    if (card.confirm === 'approve') {
      const check = mergeCheck(card.result);
      return html`
        <div class="confirm">
          <p>Merge this proposal into <strong>${page.target}</strong>? ${check.tone === 'notice' ? check.label : ''}</p>
          ${proposal.pages.length > 1 ? html`<p class="muted">The proposal also covers ${proposal.pages.length - 1} other ${proposal.pages.length === 2 ? 'page' : 'pages'}. They stay open.</p>` : nothing}
          <div class="actions">
            <button type="button" class="btn accent" ?disabled=${card.busy}
              @click=${() => this.approve(entry)}>${card.busy === 'approve' ? 'Merging…' : 'Merge now'}</button>
            <button type="button" class="btn" ?disabled=${card.busy}
              @click=${() => this.patchCard(id, { confirm: null })}>Cancel</button>
          </div>
        </div>`;
    }
    if (card.confirm === 'reject') {
      return html`
        <div class="confirm">
          <p>Reject this proposal${proposal.pages.length > 1 ? ` for all ${proposal.pages.length} pages` : ''}? Nothing is merged. The drafts are kept.</p>
          <label class="field">Reason (optional)
            <textarea rows="2" .value=${card.reason ?? ''}
              @input=${(event) => this.patchCard(id, { reason: event.target.value })}></textarea>
          </label>
          <div class="actions">
            <button type="button" class="btn destructive-fill" ?disabled=${card.busy}
              @click=${() => this.reject(entry, card.reason ?? '')}>${card.busy === 'reject' ? 'Rejecting…' : 'Reject proposal'}</button>
            <button type="button" class="btn" ?disabled=${card.busy}
              @click=${() => this.patchCard(id, { confirm: null })}>Cancel</button>
          </div>
        </div>`;
    }
    return nothing;
  }

  renderEntry(entry) {
    const { proposal, page } = entry;
    const card = this.cards.get(proposal.id) ?? {};
    const mergeable = card.check === 'done';
    return html`
      <article class="card" aria-label=${proposal.title}>
        <div class="card-head">
          <h2>${proposal.title}</h2>
          <span class="pill small ${proposal.status === 'partially-merged' ? 'informative' : 'notice'}">${proposal.status === 'partially-merged' ? 'Partly merged' : 'Open'}</span>
        </div>
        <p class="muted">${proposal.source.path} → ${page.label || page.target}${proposal.createdAt ? ` · ${formatDate(proposal.createdAt)}` : ''}</p>
        ${proposal.summary ? html`<p>${proposal.summary}</p>` : nothing}
        ${renderChanges(entry)}
        ${renderCheck(card)}
        ${card.message ? html`<p class="check ${card.message.tone}">${card.message.text}</p>` : nothing}
        ${card.diffUrl ? html`<p class="legend"><a href=${card.diffUrl} target="_blank" rel="noopener">Open the diff view again</a>. <strong>Upstream</strong> is the proposed change. <strong>Local</strong> is this page as it is now. Only read the markers; do not accept or reject them there.</p>` : nothing}
        ${card.confirm ? this.renderConfirm(entry, card) : html`
          <div class="actions">
            <button type="button" class="btn" ?disabled=${!mergeable || card.busy}
              @click=${() => this.showDiff(entry)}>${card.busy === 'diff' ? 'Preparing…' : 'Show diff view'}</button>
            <button type="button" class="btn accent" ?disabled=${!mergeable || card.busy}
              @click=${() => this.patchCard(proposal.id, { confirm: 'approve' })}>Approve</button>
            <button type="button" class="btn" ?disabled=${card.busy}
              @click=${() => this.patchCard(proposal.id, { confirm: 'reject' })}>Reject</button>
          </div>`}
      </article>`;
  }

  renderFound() {
    return html`
      <details class="found">
        <summary>What the panel looked at</summary>
        <p class="muted">This page: ${this.path}. It lists proposals whose target page is this page.</p>
        ${this.found.length ? html`<ul>${this.found.map((proposal) => html`
          <li><strong>${proposal.id}</strong>: ${proposal.status}, target${proposal.pages.length === 1 ? '' : 's'} ${proposal.pages.map((page) => page.target).join(', ')}</li>`)}</ul>`
    : html`<p class="muted">No proposals found in ${PROPOSALS_ROOT}.</p>`}
        ${this.problems.length ? html`<p class="muted">Could not use:</p><ul>${this.problems.map((item) => html`<li><strong>${item.id}</strong>: ${item.reason}</li>`)}</ul>` : nothing}
      </details>`;
  }

  renderEmpty() {
    const sourceOf = this.sourceOf.length ? html`
      <p class="muted">No open proposals target this page. It is the source of ${this.sourceOf.length === 1 ? 'a proposal' : `${this.sourceOf.length} proposals`}. Open the target page to act on ${this.sourceOf.length === 1 ? 'it' : 'them'}:</p>
      <ul class="source-of">${this.sourceOf.map((proposal) => html`<li>${proposal.title}: ${proposal.pages.map((page) => page.target).join(', ')}</li>`)}</ul>`
      : html`<p class="muted">No open content proposals for this page.</p>`;
    return html`${sourceOf}${this.renderFound()}`;
  }

  render() {
    return html`
      <div class="top">
        <span class="panel-name">Content proposals</span>
        ${this.phase === 'ready' && this.entries.length ? html`<span class="pill small informative">${this.entries.length}</span>` : nothing}
        <button type="button" class="link-btn refresh" @click=${() => this.load()}>Refresh</button>
      </div>
      ${this.notice ? html`<p class="check ${this.notice.tone}" role="status">${this.notice.text}</p>` : nothing}
      ${this.phase === 'loading' ? html`<p class="state muted">Loading proposals…</p>` : nothing}
      ${this.phase === 'error' ? html`<p class="state error-text">Could not load proposals: ${this.error}</p>` : nothing}
      ${this.phase === 'draft' ? html`<p class="state muted">Proposals are not shown for draft pages.</p>` : nothing}
      ${this.phase === 'ready' ? html`
        ${this.entries.length ? this.entries.map((entry) => this.renderEntry(entry)) : this.renderEmpty()}` : nothing}`;
  }
}

customElements.define('proposals-plugin', ProposalsPlugin);

const timeout = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function resolveSetup() {
  const sdk = await Promise.race([DA_SDK, timeout(SDK_TIMEOUT)]);
  if (!sdk?.actions?.daFetch) {
    throw new Error('Open this panel from the editor library. DA did not respond.');
  }
  const { context, actions } = sdk;
  const site = context.site || context.repo;
  const engine = await import(ENGINE_URL);
  const store = createStore({ org: context.org, site, fetch: actions.daFetch });
  return {
    org: context.org,
    site,
    path: pagePathFrom(context.path),
    store,
    merger: createMerger({
      engine, parse, store, site,
    }),
  };
}

(async function init() {
  try {
    const setup = await resolveSetup();
    const plugin = document.createElement('proposals-plugin');
    Object.assign(plugin, setup);
    document.body.append(plugin);
  } catch (error) {
    console.error('[Proposals plugin] Initialization error:', error);
    const pre = document.createElement('pre');
    pre.className = 'init-error';
    pre.textContent = `Failed to initialise the proposals panel: ${messageOf(error)}`;
    document.body.append(pre);
  }
}());
