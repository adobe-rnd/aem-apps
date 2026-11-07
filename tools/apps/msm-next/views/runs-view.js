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
  runProgress, runStatus, canRetry, translatingItems, summaryChips, groupRun, itemNotes,
  itemState, runTitle,
} from '../data/run-view.js';
import { formatRelative, OPTION_LABELS } from '../data/display.js';
import { badge, langBadge, spinner } from './common.js';

function progressBar(progress, label) {
  return html`
    <div class="run-progress" role="progressbar" aria-label=${label}
      aria-valuemin="0" aria-valuemax="100" aria-valuenow=${progress.percent}>
      <span class="run-progress-fill" style="width: ${progress.percent}%"></span>
      ${progress.translating ? html`<span class="run-progress-wait" style="width: ${Math.round((progress.translating / Math.max(progress.total, 1)) * 100)}%"></span>` : nothing}
    </div>`;
}

function renderListEntry(run, ctx) {
  const busy = ctx.runBusy.has(run.id);
  const status = runStatus(run, busy);
  const progress = runProgress(run);
  const active = run.id === ctx.activeRunId;
  return html`
    <li>
      <button type="button" class="run-entry ${active ? 'active' : ''}" aria-current=${active ? 'true' : 'false'}
        @click=${() => ctx.onOpen(run)}>
        <span class="run-entry-head">
          <strong>${runTitle(run)}</strong>
          ${busy ? spinner('Running') : nothing}
        </span>
        <span class="run-entry-meta">
          ${badge(status.label, status.tone)}
          <span class="muted">${progress.settled}/${progress.total} · ${formatRelative(run.updatedAt ?? run.createdAt)}</span>
        </span>
        ${progressBar(progress, `${runTitle(run)} progress`)}
      </button>
    </li>`;
}

function renderItem(item, ctx) {
  const display = itemState(item.viewState ?? item.state);
  const notes = itemNotes(item);
  const node = ctx.nodeOf(item.key);
  return html`
    <li class="run-item ${display.tone}">
      <span class="state-icon ${display.tone}" aria-hidden="true">${item.state === 'running' ? spinner('Running') : display.icon}</span>
      <span class="run-item-text">
        ${node ? html`<button type="button" class="link" @click=${() => ctx.onReveal(node)}>${item.path}</button>` : html`<span>${item.path}</span>`}
        ${notes.map((note) => html`<span class="run-note ${note.tone}">${note.text}</span>`)}
      </span>
      <span class="run-item-state">${badge(display.label, display.tone)}${item.action && item.state === 'done' ? html`<span class="muted small-text">${item.action}</span>` : nothing}</span>
    </li>`;
}

function renderGroup(group, ctx) {
  return html`
    <section class="run-group">
      <header class="run-group-head">
        <h4>${group.label}</h4>
        <span class="muted">${group.progress.settled} of ${group.progress.total} settled</span>
      </header>
      ${group.locations.map((entry) => html`
        <div class="run-location">
          <div class="run-location-head">
            ${entry.location ? langBadge(entry.location) : nothing}
            <strong>${entry.location?.label ?? entry.locationId}</strong>
            <span class="page-path">${entry.locationId}</span>
          </div>
          <ul class="run-items">${entry.items.map((item) => renderItem(item, ctx))}</ul>
        </div>`)}
    </section>`;
}

function renderDetail(run, ctx) {
  if (!run) return html`<div class="detail-empty"><p>Select a run to see its progress.</p></div>`;
  const busy = ctx.runBusy.has(run.id);
  const status = runStatus(run, busy);
  const progress = runProgress(run);
  const translating = translatingItems(run);
  const checkedAt = ctx.runChecked.get(run.id);
  return html`
    <header class="run-head">
      <div>
        <h2>${runTitle(run)}</h2>
        <p class="muted">
          Started ${formatRelative(run.createdAt)}
          · ${run.pages?.length ?? 0} source page${run.pages?.length === 1 ? '' : 's'}
          ${run.option ? html`· ${OPTION_LABELS[run.option] ?? run.option}` : nothing}
          ${run.targets?.length ? html`· ${run.targets.length} selected targets` : html`· all targets`}
        </p>
      </div>
      <div class="run-actions">
        ${translating.length && ctx.canResume ? html`
          <button type="button" class="btn" ?disabled=${busy} @click=${() => ctx.onResume(run)}>Check status</button>` : nothing}
        ${canRetry(run) ? html`
          <button type="button" class="btn accent" ?disabled=${busy} @click=${() => ctx.onRetry(run)}>Retry</button>` : nothing}
      </div>
    </header>
    <div class="run-overview">
      <div class="run-overview-line">
        ${badge(status.label, status.tone)}
        <span>${progress.settled} of ${progress.total} pages settled</span>
        ${busy ? spinner('Running') : nothing}
      </div>
      ${progressBar(progress, 'Run progress')}
      <div class="badge-row">${summaryChips(run).map((chip) => badge(`${chip.count} ${chip.label.toLowerCase()}`, chip.tone))}</div>
      ${translating.length ? html`<p class="muted small-text">
        ${translating.length} page${translating.length === 1 ? ' is' : 's are'} at the translation service.
        Pages below ${translating.length === 1 ? 'it continue' : 'them continue'} once the translation is saved.
        ${checkedAt ? html`Checked ${formatRelative(checkedAt)}.` : nothing}</p>` : nothing}
      ${run.saveError ? html`<p class="error-text">This run could not be saved: ${run.saveError}</p>` : nothing}
    </div>
    ${groupRun(run, ctx).map((group) => renderGroup(group, ctx))}`;
}

export default function renderRunsView(ctx) {
  const active = ctx.runs.find((run) => run.id === ctx.activeRunId) ?? null;
  return html`
    <div class="runs-layout">
      <section class="runs-list" aria-label="Recent runs">
        <header class="runs-list-head">
          <h2>Runs</h2>
          <button type="button" class="btn small quiet" ?disabled=${ctx.loading} @click=${ctx.onReload}>Refresh</button>
        </header>
        ${ctx.starting ? html`<p class="loading-text">${spinner('Planning')} Planning ${ctx.starting}…</p>` : nothing}
        ${ctx.loading ? html`<p class="loading-text">${spinner('Loading')} Loading runs…</p>` : nothing}
        ${ctx.error ? html`<p class="error-text">${ctx.error}</p>` : nothing}
        ${!ctx.loading && !ctx.runs.length && !ctx.starting ? html`<p class="muted">No runs yet. Select source pages and choose Update / Create.</p>` : nothing}
        <ul class="run-entries">${ctx.runs.map((run) => renderListEntry(run, ctx))}</ul>
      </section>
      <section class="run-detail" aria-label="Run details">${renderDetail(active, ctx)}</section>
    </div>`;
}
