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
  pagePathFrom, involvement, pageState, mergeCheck, typeLabel, formatDate, canvasUrl,
  applyMerged, applyRejected, previewPath,
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

const STATE_LABELS = {
  open: 'Open', partial: 'Partly merged', merged: 'Merged', rejected: 'Rejected', closed: 'Closed',
};

const STATE_TONES = {
  open: 'notice', partial: 'informative', merged: 'positive', rejected: 'negative', closed: '',
};

const ROLE_LABELS = {
  target: 'This page is the target',
  source: 'This page is the source',
  draft: 'This page is the draft',
  preview: 'This page is the diff view',
};

const messageOf = (error) => error?.message || String(error);

function renderChanges(item) {
  if (!item.changes.length) return nothing;
  return html`
    <ul class="changes">
      ${item.changes.map((change) => html`
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

function renderHistory(item) {
  const { proposal, raw, page } = item;
  if (proposal.status === 'rejected') {
    return html`<p class="check neutral">Rejected${raw?.rejectedAt ? ` on ${formatDate(raw.rejectedAt)}` : ''}${raw?.reason ? `: ${raw.reason}` : ''}.</p>`;
  }
  if (page?.mergeMode || proposal.status === 'merged') {
    return html`<p class="check positive">Merged${raw?.mergedAt ? ` on ${formatDate(raw.mergedAt)}` : ''}.</p>`;
  }
  return nothing;
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
    open: { state: true },
    closed: { state: true },
    cards: { state: true },
    notice: { state: true },
  };

  constructor() {
    super();
    this.phase = 'loading';
    this.open = [];
    this.closed = [];
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
    try {
      const { proposals: loaded } = await this.store.listProposals();
      const byId = new Map(loaded.map((item) => [item.proposal.id, item]));
      const { open, closed } = involvement(loaded.map((item) => item.proposal), this.path);
      const withRecord = (item) => ({
        ...item, ...byId.get(item.proposal.id), proposal: item.proposal,
      });
      this.open = open.map(withRecord);
      this.closed = closed.map(withRecord);
      this.phase = 'ready';
      this.open.filter((item) => item.actionable).forEach((item) => this.runCheck(item));
    } catch (error) {
      this.error = messageOf(error);
      this.phase = 'error';
    }
  }

  async runCheck(item) {
    const { proposal, page } = item;
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

  async showDiff(item) {
    const { proposal, page } = item;
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

  async approve(item) {
    const {
      proposal, page, raw, etag,
    } = item;
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

  async reject(item, reason) {
    const { proposal, raw, etag } = item;
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

  renderConfirm(item, card) {
    const { proposal, page } = item;
    const { id } = proposal;
    if (card.confirm === 'approve') {
      const check = mergeCheck(card.result);
      return html`
        <div class="confirm">
          <p>Merge this proposal into <strong>${page.target}</strong>? ${check.tone === 'notice' ? check.label : ''}</p>
          ${proposal.pages.length > 1 ? html`<p class="muted">The proposal also covers ${proposal.pages.length - 1} other ${proposal.pages.length === 2 ? 'page' : 'pages'}. They stay open.</p>` : nothing}
          <div class="actions">
            <button type="button" class="btn accent" ?disabled=${card.busy}
              @click=${() => this.approve(item)}>${card.busy === 'approve' ? 'Merging…' : 'Merge now'}</button>
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
              @click=${() => this.reject(item, card.reason ?? '')}>${card.busy === 'reject' ? 'Rejecting…' : 'Reject proposal'}</button>
            <button type="button" class="btn" ?disabled=${card.busy}
              @click=${() => this.patchCard(id, { confirm: null })}>Cancel</button>
          </div>
        </div>`;
    }
    return nothing;
  }

  renderRelated(item) {
    const { proposal, role, page } = item;
    const link = (path, label) => html`<a href=${canvasUrl(this.org, this.site, path)} target="_blank" rel="noopener">${label}</a>`;
    if (role === 'source') {
      return html`
        <ul class="related">${proposal.pages.map((entry) => html`
          <li>${link(entry.target, entry.label || entry.target)}
            <span class="pill small ${STATE_TONES[pageState(proposal, entry)]}">${STATE_LABELS[pageState(proposal, entry)]}</span></li>`)}
        </ul>
        <p class="muted">Open a target page to review, approve or reject.</p>`;
    }
    return html`
      <p class="related-links">
        ${role === 'target' ? nothing : html`Target page: ${link(page.target, page.label || page.target)} · `}
        Source page: ${link(proposal.source.path, proposal.source.path)}
      </p>`;
  }

  renderActions(item, card) {
    const { proposal } = item;
    const mergeable = card.check === 'done';
    return card.confirm ? this.renderConfirm(item, card) : html`
      <div class="actions">
        <button type="button" class="btn" ?disabled=${!mergeable || card.busy}
          @click=${() => this.showDiff(item)}>${card.busy === 'diff' ? 'Preparing…' : 'Show diff view'}</button>
        <button type="button" class="btn accent" ?disabled=${!mergeable || card.busy}
          @click=${() => this.patchCard(proposal.id, { confirm: 'approve' })}>Approve</button>
        <button type="button" class="btn" ?disabled=${card.busy}
          @click=${() => this.patchCard(proposal.id, { confirm: 'reject' })}>Reject</button>
      </div>`;
  }

  renderItem(item) {
    const { proposal, role } = item;
    const card = this.cards.get(proposal.id) ?? {};
    const state = proposal.status === 'partially-merged' && item.state === 'open' ? 'partial' : item.state;
    const label = proposal.status === 'merged' || proposal.status === 'rejected' ? proposal.status : state;
    return html`
      <article class="card" aria-label=${proposal.title}>
        <div class="card-head">
          <h2>${proposal.title}</h2>
          <span class="pill small ${STATE_TONES[label]}">${STATE_LABELS[label]}</span>
        </div>
        <p class="muted">${ROLE_LABELS[role]} · ${proposal.source.path} → ${proposal.pages.length === 1 ? (proposal.pages[0].label || proposal.pages[0].target) : `${proposal.pages.length} pages`}${proposal.createdAt ? ` · ${formatDate(proposal.createdAt)}` : ''}</p>
        ${proposal.summary ? html`<p>${proposal.summary}</p>` : nothing}
        ${renderChanges(item)}
        ${this.renderRelated(item)}
        ${item.actionable ? html`
          ${renderCheck(card)}
          ${card.message ? html`<p class="check ${card.message.tone}">${card.message.text}</p>` : nothing}
          ${card.diffUrl ? html`<p class="legend"><a href=${card.diffUrl} target="_blank" rel="noopener">Open the diff view again</a>. <strong>Upstream</strong> is the proposed change. <strong>Local</strong> is the page as it is now. Only read the markers; do not accept or reject them there.</p>` : nothing}
          ${this.renderActions(item, card)}` : renderHistory(item)}
      </article>`;
  }

  renderReady() {
    return html`
      ${this.open.length ? this.open.map((item) => this.renderItem(item)) : html`<p class="muted">${this.closed.length ? 'No open content proposals involve this page.' : 'No content proposals involve this page.'}</p>`}
      ${this.closed.length ? html`
        <details class="closed">
          <summary>Closed (${this.closed.length})</summary>
          ${this.closed.map((item) => this.renderItem(item))}
        </details>` : nothing}`;
  }

  render() {
    return html`
      <div class="top">
        <span class="panel-name">Content proposals</span>
        ${this.phase === 'ready' && this.open.length ? html`<span class="pill small informative">${this.open.length}</span>` : nothing}
        <button type="button" class="link-btn refresh" @click=${() => this.load()}>Refresh</button>
      </div>
      ${this.notice ? html`<p class="check ${this.notice.tone}" role="status">${this.notice.text}</p>` : nothing}
      ${this.phase === 'loading' ? html`<p class="state muted">Loading proposals…</p>` : nothing}
      ${this.phase === 'error' ? html`<p class="state error-text">Could not load proposals: ${this.error}</p>` : nothing}
      ${this.phase === 'ready' ? this.renderReady() : nothing}`;
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
