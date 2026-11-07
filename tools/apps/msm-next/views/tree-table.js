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
  pageType, primarySync, nextStep, SYNC_DISPLAY,
} from '../data/display.js';
import { rollup } from '../data/tree.js';
import {
  syncBadge, overriddenBadge, langBadge, pageLabel, pageSubLabel, spinner,
} from './common.js';

const PUBLISH_LABELS = { live: 'Live', preview: 'Previewed' };

function renderStatus(row, ctx) {
  const { node } = row;
  const result = ctx.results.get(node.key);
  const error = ctx.errors.get(node.key);
  if (error) return html`<span class="badge negative" title=${error}>Error</span>`;
  if (!result) return html`<span class="loading-text">${spinner('Checking status')} Checking…</span>`;
  const sync = primarySync(result);
  const summary = node.children.length && !row.expanded ? rollup(node, ctx.results) : null;
  const own = sync || result.status?.overridden;
  return html`
    <div class="status-cell">
      ${syncBadge(sync)}
      ${overriddenBadge(result)}
      ${!own && !summary?.needsAction ? html`<span class="muted">—</span>` : nothing}
      ${summary?.needsAction ? html`
        <span class="rollup ${SYNC_DISPLAY[summary.worst]?.tone ?? ''}"
          title="Most urgent below: ${SYNC_DISPLAY[summary.worst]?.label ?? ''}">
          ${summary.needsAction} below need action
        </span>` : nothing}
    </div>`;
}

function renderNext(node, ctx) {
  const result = ctx.results.get(node.key);
  if (ctx.busy.has(node.key) || ctx.refreshing.has(node.key)) return spinner('Updating');
  const step = nextStep(result);
  if (!step) return html`<span class="muted">—</span>`;
  const name = `${step.label} ${pageLabel(node)} (${node.site}:${node.path})`;
  return html`
    <button type="button" class="btn small" tabindex="-1" aria-label=${name}
      @click=${(event) => { event.stopPropagation(); ctx.onNext(node, step); }}>${step.label}</button>`;
}

function renderRow(row, ctx) {
  const { node } = row;
  const result = ctx.results.get(node.key);
  const type = result ? pageType(result) : null;
  const selected = node.key === ctx.selectedKey;
  const context = ctx.matches && !ctx.matches.has(node.key);
  const publish = PUBLISH_LABELS[ctx.publishState?.(node.site, node.path)];
  return html`
    <tr role="row" class="${selected ? 'selected' : ''} ${context ? 'context' : ''}"
      data-key=${node.key}
      aria-label="${pageLabel(node)}, ${node.site}:${node.path}"
      aria-level=${row.level}
      aria-posinset=${row.posinset}
      aria-setsize=${row.setsize}
      aria-expanded=${row.hasChildren ? String(row.expanded) : nothing}
      aria-selected=${String(selected)}
      tabindex=${node.key === ctx.focusKey ? '0' : '-1'}
      @click=${() => ctx.onSelect(node)}>
      <td role="gridcell">
        <div class="page-cell" style="--indent: ${row.level - 1}">
          ${row.hasChildren ? html`
            <button type="button" class="twisty ${row.expanded ? 'open' : ''}" tabindex="-1"
              aria-label="${row.expanded ? 'Collapse' : 'Expand'} ${pageLabel(node)}"
              @click=${(event) => { event.stopPropagation(); ctx.onToggle(node); }}></button>`
    : html`<span class="twisty-space"></span>`}
          ${langBadge(node.location)}
          <div class="page-text">
            <span class="page-name">${pageLabel(node)}</span>
            <span class="page-path">${pageSubLabel(node, ctx.rootSite)}</span>
          </div>
        </div>
      </td>
      <td role="gridcell">
        ${type ? html`
          <span class="type-label">${type.label}</span>
          ${type.detail ? html`<span class="type-detail">${type.detail}</span>` : nothing}`
    : nothing}
      </td>
      <td role="gridcell">${renderStatus(row, ctx)}</td>
      <td role="gridcell">${publish ? html`<span class="badge positive">${publish}</span>` : html`<span class="muted">—</span>`}</td>
      <td role="gridcell" class="next-cell">${renderNext(node, ctx)}</td>
    </tr>`;
}

export default function renderTreeTable(rows, ctx) {
  if (!rows.length) {
    return html`<div class="empty-table">${ctx.emptyMessage}</div>`;
  }
  return html`
    <table class="tree-table" role="treegrid" aria-label="Pages and their copies">
      <thead>
        <tr role="row">
          <th role="columnheader" class="col-page">Page</th>
          <th role="columnheader" class="col-type">Type</th>
          <th role="columnheader" class="col-status">Status</th>
          <th role="columnheader" class="col-publish">Publish</th>
          <th role="columnheader" class="col-next">Next step</th>
        </tr>
      </thead>
      <tbody @keydown=${ctx.onKeydown}>
        ${rows.map((row) => renderRow(row, ctx))}
      </tbody>
    </table>`;
}
