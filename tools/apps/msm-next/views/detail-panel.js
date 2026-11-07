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
/* eslint-disable import/no-unresolved */
import { html, nothing } from 'da-lit';
import {
  pageType, syncBadges, nextStep, actionButtons, editUrl, formatRelative, levelLabel, refLabel,
  isRealPage, primarySync,
} from '../data/display.js';
import {
  badge, overriddenBadge, langBadge, pageLabel, spinner, syncBadge,
} from './common.js';

const PUBLISHABLE = ['source', 'copies', 'independent', 'inherited'];

function renderFacts(node, result, ctx) {
  const type = pageType(result);
  const source = result?.status?.effectiveSource;
  const base = result?.chain?.[0]?.info?.base;
  const synced = base?.at ? formatRelative(base.at) : '';
  return html`
    <dl class="facts">
      <div><dt>Type</dt><dd>${type.label}${type.detail ? html`<span class="fact-detail">${type.detail}</span>` : nothing}</dd></div>
      <div><dt>Language</dt><dd>${node.location.language}<span class="fact-detail">${node.location.label}</span></dd></div>
      <div><dt>Source</dt><dd>${source ? refLabel(source, node.site) : '—'}</dd></div>
      <div><dt>Location</dt><dd>${node.location.label}<span class="fact-detail">${levelLabel(node.location, node.depth)} · ${node.location.kind === 'variation' ? 'Variation' : 'Localization'}</span></dd></div>
      ${node.site !== ctx.rootSite ? html`<div><dt>Site</dt><dd>${node.site}</dd></div>` : nothing}
      <div><dt>Last synced</dt><dd title=${base?.at ?? ''}>${synced || '—'}</dd></div>
    </dl>`;
}

function renderAttention(list, ctx) {
  if (!list.length) return nothing;
  return html`
    <section class="attention" aria-labelledby="attention-heading">
      <h3 id="attention-heading">Needs attention below (${list.length})</h3>
      <ul>
        ${list.map((child) => html`
          <li>
            <button type="button" class="link-row" @click=${() => ctx.onSelect(child, true)}>
              ${langBadge(child.location)}
              <span class="link-row-text">
                <span>${pageLabel(child)}</span>
                <span class="page-path">${child.site === ctx.rootSite ? child.path : `${child.site}:${child.path}`}</span>
              </span>
              ${syncBadge(primarySync(ctx.results.get(child.key)))}
            </button>
          </li>`)}
      </ul>
    </section>`;
}

function renderButton(node, button, ctx) {
  const confirming = ctx.confirm?.key === node.key && ctx.confirm?.action === button.action;
  const tone = [button.primary ? 'accent' : '', button.destructive ? 'destructive' : ''].join(' ');
  if (confirming) {
    return html`
      <div class="confirm" role="alertdialog" aria-label="Confirm ${button.label}">
        <p>${button.confirm}</p>
        <div class="confirm-actions">
          <button type="button" class="btn" @click=${() => ctx.onConfirm(null)}>Cancel</button>
          <button type="button" class="btn destructive" @click=${() => {
    ctx.onConfirm(null);
    ctx.onAction(node, button);
  }}>${button.label}</button>
        </div>
      </div>`;
  }
  return html`
    <button type="button" class="btn ${tone}"
      aria-disabled=${String(!button.enabled)}
      title=${button.enabled ? nothing : button.reason}
      @click=${() => {
    if (!button.enabled) return;
    if (button.confirm) ctx.onConfirm({ key: node.key, action: button.action });
    else ctx.onAction(node, button);
  }}>${button.label}</button>
    ${button.enabled ? nothing : html`<span class="reason">${button.reason}</span>`}`;
}

function renderActions(node, result, ctx) {
  const step = nextStep(result);
  const primaryAction = step?.kind === 'action' ? step.action : null;
  const buttons = actionButtons(result).map((button) => ({
    ...button, primary: button.primary && button.action === primaryAction,
  }));
  const busy = ctx.busy.has(node.key);
  const exists = Boolean(result?.chain?.[0]?.info?.exists);
  const publishable = PUBLISHABLE.includes(pageType(result).group);
  return html`
    <section class="actions" aria-labelledby="actions-heading" aria-busy=${String(busy)}>
      <h3 id="actions-heading">Actions ${busy ? spinner('Working') : nothing}</h3>
      ${step?.kind === 'review' ? html`
        <button type="button" class="btn accent" @click=${() => ctx.onNext(node, step)}>Review changes</button>` : nothing}
      <div class="action-list">
        ${buttons.map((button) => html`<div class="action-item">${renderButton(node, button, ctx)}</div>`)}
      </div>
      ${publishable || exists ? html`<div class="action-list secondary">
        ${publishable ? html`
          <div class="action-item"><button type="button" class="btn" @click=${() => ctx.onPublish(node, false)}>Publish</button></div>
          <div class="action-item"><button type="button" class="btn" title="Also publishes every inherited page below this one"
            @click=${() => ctx.onPublish(node, true)}>Publish with inherited pages</button></div>` : nothing}
        ${exists ? html`
          <div class="action-item"><a class="btn quiet" href=${editUrl(ctx.org, node.site, node.path)} target="_blank" rel="noopener">Open in editor</a></div>` : nothing}
      </div>` : nothing}
      ${!buttons.length && !publishable && !exists ? html`<p class="muted">No actions available for this page.</p>` : nothing}
    </section>`;
}

export default function renderDetailPanel(node, ctx) {
  if (!node) {
    return html`<div class="detail-empty"><p>Select a page to see its details and actions.</p></div>`;
  }
  const result = ctx.results.get(node.key);
  const error = ctx.errors.get(node.key);
  return html`
    <header class="detail-header">
      <h2>${pageLabel(node)}${node.parent ? html`<span class="detail-title-sub">${node.title}</span>` : nothing}</h2>
      <p class="page-path">${node.site}:${node.path}</p>
      <div class="badge-row">
        ${langBadge(node.location)}
        ${result ? badge(pageType(result).label, 'neutral') : nothing}
        ${syncBadges(result).map((entry) => badge(entry.label, entry.tone))}
        ${overriddenBadge(result)}
      </div>
    </header>
    ${error ? html`<p class="error-text">Could not load status: ${error}</p>` : nothing}
    ${!result && !error ? html`<p class="loading-text">${spinner('Loading')} Checking status…</p>` : nothing}
    ${result ? html`
      ${renderFacts(node, result, ctx)}
      ${renderAttention(ctx.attention, ctx)}
      ${renderActions(node, result, ctx)}
      ${!isRealPage(result) && !result.actions.length ? html`<p class="muted">Create the source page first.</p>` : nothing}
    ` : nothing}`;
}
