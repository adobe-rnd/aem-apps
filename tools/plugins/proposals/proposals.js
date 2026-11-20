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
import { loadTargets, buildPrompt, sendToChat } from './create.js';
import { togglePick } from '../msm-next/model.js';
import {
  pagePathFrom, isDraftPath, involvement, groupByProposal, cardKey, pageState, mergeCheck,
  typeLabel, roleSummary, changeSummary,
  formatDate, canvasUrl,
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

const messageOf = (error) => error?.message || String(error);

function renderChanges(item) {
  if (!item.changes.length) return nothing;
  const { label, skipped } = changeSummary(item.changes);
  return html`
    <details class="changes-details" ?open=${skipped > 0}>
      <summary>${label}</summary>
      <ul class="changes">
        ${item.changes.map((change) => html`
          <li class=${change.type === 'skipped' ? 'skipped' : ''}>
            <span class="change-type">${typeLabel(change.type)}</span>
            <span class="change-why">${change.rationale}</span>
          </li>`)}
      </ul>
    </details>`;
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
    creating: { state: true },
    actions: { attribute: false },
  };

  constructor() {
    super();
    this.phase = 'loading';
    this.open = [];
    this.closed = [];
    this.cards = new Map();
    this.creating = null;
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
    const key = cardKey(proposal, page);
    this.patchCard(key, { check: 'running', checkError: null });
    try {
      const result = await this.merger.check({
        draftPath: page.draftPath, target: page.target, baseVersionId: page.baseVersionId,
      });
      this.patchCard(key, { check: 'done', result });
    } catch (error) {
      this.patchCard(key, { check: 'failed', checkError: messageOf(error) });
    }
  }

  async showDiff(item) {
    const { proposal, page } = item;
    const key = cardKey(proposal, page);
    this.patchCard(key, { busy: 'diff', message: null });
    try {
      const result = await this.merger.preview({
        draftPath: page.draftPath, target: page.target, baseVersionId: page.baseVersionId,
      });
      if (result.unchanged) {
        this.patchCard(key, { busy: null, message: { tone: 'neutral', text: 'The proposal adds nothing to this page.' } });
        return;
      }
      await this.store.savePreview(proposal.id, page.target, result.html);
      const url = canvasUrl(this.org, this.site, previewPath(proposal.id, page.target));
      window.open(url, '_blank', 'noopener');
      this.patchCard(key, {
        busy: null,
        diffUrl: url,
        message: { tone: 'positive', text: `Opened the diff view with ${result.differences} marked ${result.differences === 1 ? 'difference' : 'differences'}.` },
      });
    } catch (error) {
      this.patchCard(key, { busy: null, message: { tone: 'negative', text: messageOf(error) } });
    }
  }

  async approve(item) {
    const {
      proposal, page, raw, etag,
    } = item;
    const key = cardKey(proposal, page);
    this.patchCard(key, { busy: 'approve', message: null });
    try {
      const result = await this.merger.merge({
        draftPath: page.draftPath, target: page.target, baseVersionId: page.baseVersionId,
      });
      const next = applyMerged(raw, [{ target: page.target, mode: 'smart' }], new Date().toISOString());
      await this.store.saveRecord(proposal.id, next, etag);
      const text = result.unchanged
        ? `${page.target} already had these changes. It is marked as merged.`
        : `Merged into ${page.target}. Preview and publish are not done yet.`;
      await this.load();
      this.notice = { tone: 'positive', text: `${proposal.title}: ${text}` };
    } catch (error) {
      this.patchCard(key, { busy: null, confirm: null, message: { tone: 'negative', text: messageOf(error) } });
    }
  }

  async reject(group, reason) {
    const { proposal, raw, etag } = group;
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

  async openCreate() {
    this.creating = { phase: 'loading', rows: [], picked: new Set() };
    try {
      const rows = await loadTargets({
        org: this.org, site: this.site, path: this.path, daFetch: this.actions.daFetch,
      });
      this.creating = { phase: 'ready', rows, picked: new Set() };
    } catch (error) {
      this.creating = {
        phase: 'error', error: messageOf(error), rows: [], picked: new Set(),
      };
    }
  }

  pickTarget(id, checked) {
    const { rows, picked } = this.creating;
    this.creating = { ...this.creating, picked: togglePick(rows, picked, id, checked) };
  }

  async sendCreate() {
    const { rows, picked } = this.creating;
    const targets = rows.filter((row) => picked.has(row.id));
    const text = buildPrompt({ source: this.path, targets });
    const outcome = await sendToChat(this.actions, text);
    if (outcome === 'unsupported') {
      this.creating = { ...this.creating, prompt: text };
      return;
    }
    this.creating = null;
    this.notice = {
      tone: 'positive',
      text: outcome === 'copied'
        ? 'The request was copied. Paste it into the chat to create the proposal.'
        : 'Sent to the chat. The agent will create the proposal and report back. Refresh to see it here.',
    };
  }

  renderCreate() {
    const form = this.creating;
    if (!form) return nothing;
    const count = form.picked.size;
    return html`
      <section class="card create" aria-label="Create a content proposal">
        <div class="card-head"><h2>Create a content proposal</h2></div>
        <p class="muted">The agent compares this page with its last saved version and adapts the changes for the pages you pick. Nothing is written to the target pages.</p>
        ${form.phase === 'loading' ? html`<p class="muted">Loading target pages…</p>` : nothing}
        ${form.phase === 'error' ? html`<p class="check negative">Could not load the target pages: ${form.error}</p>` : nothing}
        ${form.phase === 'ready' && !form.rows.length ? html`<p class="muted">This page has no target pages. Open the source page to create a proposal.</p>` : nothing}
        ${form.rows.length ? html`
          <ul class="targets">
            ${form.rows.map((row) => html`
              <li style="--indent: ${row.depth}">
                <label>
                  <input type="checkbox" .checked=${form.picked.has(row.id)}
                    @change=${(event) => this.pickTarget(row.id, event.target.checked)}>
                  <span class="target-name">${row.label}</span>
                  <span class="muted">${row.path}</span>
                </label>
              </li>`)}
          </ul>` : nothing}
        ${form.prompt ? html`
          <p class="check notice">This host cannot send to the chat. Copy this request into the chat:</p>
          <textarea rows="6" readonly .value=${form.prompt}></textarea>` : nothing}
        <div class="actions">
          <button type="button" class="btn accent" ?disabled=${!count}
            @click=${() => this.sendCreate()}>Send to chat</button>
          <button type="button" class="btn" @click=${() => { this.creating = null; }}>Cancel</button>
        </div>
      </section>`;
  }

  renderApproveConfirm(item, card) {
    const { proposal, page } = item;
    const key = cardKey(proposal, page);
    const check = mergeCheck(card.result);
    return html`
      <div class="confirm">
        <p>Merge this proposal into <strong>${page.target}</strong>? ${check.tone === 'notice' ? check.label : ''}</p>
        <div class="actions">
          <button type="button" class="btn accent" ?disabled=${card.busy}
            @click=${() => this.approve(item)}>${card.busy === 'approve' ? 'Merging…' : 'Merge now'}</button>
          <button type="button" class="btn" ?disabled=${card.busy}
            @click=${() => this.patchCard(key, { confirm: null })}>Cancel</button>
        </div>
      </div>`;
  }

  renderRejectConfirm(group, card) {
    const { proposal } = group;
    const { id } = proposal;
    return html`
      <div class="confirm">
        <p>Reject this proposal${proposal.pages.length > 1 ? ` for all ${proposal.pages.length} pages` : ''}? Nothing is merged. The drafts are kept.</p>
        <label class="field">Reason (optional)
          <textarea rows="2" .value=${card.reason ?? ''}
            @input=${(event) => this.patchCard(id, { reason: event.target.value })}></textarea>
        </label>
        <div class="actions">
          <button type="button" class="btn destructive-fill" ?disabled=${card.busy}
            @click=${() => this.reject(group, card.reason ?? '')}>${card.busy === 'reject' ? 'Rejecting…' : 'Reject proposal'}</button>
          <button type="button" class="btn" ?disabled=${card.busy}
            @click=${() => this.patchCard(id, { confirm: null })}>Cancel</button>
        </div>
      </div>`;
  }

  renderLinks(item) {
    const { proposal, role, page } = item;
    const link = (path, label) => html`<a href=${canvasUrl(this.org, this.site, path)} target="_blank" rel="noopener">${label}</a>`;
    const parts = [];
    if (role !== 'target') parts.push(link(page.target, `Open ${page.label || page.target}`));
    if (role !== 'draft') parts.push(link(page.draftPath, 'Open proposed draft'));
    if (role !== 'source') parts.push(link(proposal.source.path, 'Open source page'));
    return html`<p class="related-links">${parts.map((part, index) => html`${index ? ' · ' : ''}${part}`)}</p>`;
  }

  renderPageActions(item, card, withReject) {
    const { proposal, page } = item;
    const key = cardKey(proposal, page);
    const mergeable = card.check === 'done';
    if (card.confirm === 'approve') return this.renderApproveConfirm(item, card);
    return html`
      <div class="actions">
        <button type="button" class="btn" ?disabled=${!mergeable || card.busy}
          @click=${() => this.showDiff(item)}>${card.busy === 'diff' ? 'Preparing…' : 'Review changes'}</button>
        <button type="button" class="btn accent" ?disabled=${!mergeable || card.busy}
          @click=${() => this.patchCard(key, { confirm: 'approve' })}>Approve</button>
        ${withReject ? html`
          <button type="button" class="btn" ?disabled=${card.busy}
            @click=${() => this.patchCard(proposal.id, { confirm: 'reject' })}>Reject</button>` : nothing}
      </div>`;
  }

  renderPage(item, many, withReject) {
    const { proposal, page } = item;
    const card = this.cards.get(cardKey(proposal, page)) ?? {};
    const state = pageState(proposal, page);
    return html`
      <section class="page-block">
        ${many ? html`
          <div class="page-head">
            <strong>${page.label || page.target}</strong>
            <span class="pill small ${STATE_TONES[state]}">${STATE_LABELS[state]}</span>
          </div>` : nothing}
        ${renderChanges(item)}
        ${this.renderLinks(item)}
        ${item.actionable ? html`
          ${renderCheck(card)}
          ${card.message ? html`<p class="check ${card.message.tone}">${card.message.text}</p>` : nothing}
          ${card.diffUrl ? html`<p class="legend"><a href=${card.diffUrl} target="_blank" rel="noopener">Open the diff view again</a>. <strong>Upstream</strong> is the proposed change. <strong>Local</strong> is the page as it is now. Only read the markers; do not accept or reject them there.</p>` : nothing}
          ${this.renderPageActions(item, card, withReject)}` : renderHistory(item)}
      </section>`;
  }

  renderGroup(group) {
    const { proposal, items } = group;
    const first = items[0];
    const many = items.length > 1;
    const actionable = items.filter((item) => item.actionable);
    const single = actionable.length === 1 && items.length === 1;
    const proposalCard = this.cards.get(proposal.id) ?? {};
    const state = proposal.status === 'partially-merged' && first.state === 'open' ? 'partial' : first.state;
    const label = proposal.status === 'merged' || proposal.status === 'rejected' ? proposal.status : state;
    return html`
      <article class="card" aria-label=${proposal.title}>
        <div class="card-head">
          <h2>${proposal.title}</h2>
          <span class="pill small ${STATE_TONES[label]}">${STATE_LABELS[label]}</span>
        </div>
        <p class="muted">${roleSummary(first.role, proposal)}${proposal.createdAt ? ` · ${formatDate(proposal.createdAt)}` : ''}</p>
        ${proposal.summary ? html`<p>${proposal.summary}</p>` : nothing}
        ${items.map((item) => this.renderPage(item, many, single))}
        ${actionable.length && !single ? html`
          ${proposalCard.confirm === 'reject' ? nothing : html`
            <div class="actions">
              <button type="button" class="btn" ?disabled=${proposalCard.busy}
                @click=${() => this.patchCard(proposal.id, { confirm: 'reject' })}>Reject proposal</button>
            </div>`}` : nothing}
        ${proposalCard.confirm === 'reject' ? this.renderRejectConfirm({ ...first, proposal }, proposalCard) : nothing}
      </article>`;
  }

  renderReady() {
    return html`
      ${this.open.length ? groupByProposal(this.open).map((group) => this.renderGroup(group)) : html`<p class="muted">${this.closed.length ? 'No open content proposals involve this page.' : 'No content proposals involve this page.'}</p>`}
      ${this.closed.length ? html`
        <details class="closed">
          <summary>Closed (${groupByProposal(this.closed).length})</summary>
          ${groupByProposal(this.closed).map((group) => this.renderGroup(group))}
        </details>` : nothing}`;
  }

  render() {
    return html`
      <div class="top">
        <span class="panel-name">Content proposals</span>
        ${this.phase === 'ready' && this.open.length ? html`<span class="pill small informative">${groupByProposal(this.open).length}</span>` : nothing}
        ${isDraftPath(this.path) || this.creating ? nothing : html`
          <button type="button" class="btn small create-btn" @click=${() => this.openCreate()}>Create proposal…</button>`}
        <button type="button" class="link-btn refresh" @click=${() => this.load()}>Refresh</button>
      </div>
      ${this.notice ? html`<p class="check ${this.notice.tone}" role="status">${this.notice.text}</p>` : nothing}
      ${this.renderCreate()}
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
    actions,
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
