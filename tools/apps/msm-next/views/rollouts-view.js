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
  rolloutProgress, rolloutStatus, canRetry, translatingItems, summaryChips, groupRollout, itemNotes,
  itemState, rolloutTitle, canCancel, canArchive, isArchived,
} from '../data/rollout-view.js';
import { formatRelative, OPTION_LABELS } from '../data/display.js';
import { badge, langBadge, spinner } from './common.js';

function progressBar(progress, label) {
  return html`
    <div class="rollout-progress" role="progressbar" aria-label=${label}
      aria-valuemin="0" aria-valuemax="100" aria-valuenow=${progress.percent}>
      <span class="rollout-progress-fill" style="width: ${progress.percent}%"></span>
      ${progress.translating ? html`<span class="rollout-progress-wait" style="width: ${Math.round((progress.translating / Math.max(progress.total, 1)) * 100)}%"></span>` : nothing}
    </div>`;
}

function renderListEntry(run, ctx) {
  const busy = ctx.rolloutBusy.has(run.id);
  const status = rolloutStatus(run, busy);
  const progress = rolloutProgress(run);
  const active = run.id === ctx.activeRolloutId;
  return html`
    <li>
      <button type="button" class="rollout-entry ${active ? 'active' : ''}" aria-current=${active ? 'true' : 'false'}
        @click=${() => ctx.onOpen(run)}>
        <span class="rollout-entry-head">
          <strong>${rolloutTitle(run)}</strong>
          ${busy ? spinner('Running') : nothing}
        </span>
        <span class="rollout-entry-meta">
          ${badge(status.label, status.tone)}${isArchived(run) ? badge('Archived', 'neutral') : nothing}
          <span class="muted">${progress.settled}/${progress.total} · ${formatRelative(run.updatedAt ?? run.createdAt)}</span>
        </span>
        ${progressBar(progress, `${rolloutTitle(run)} progress`)}
      </button>
    </li>`;
}

function renderItem(item, ctx) {
  const display = itemState(item.viewState ?? item.state);
  const notes = itemNotes(item);
  const node = ctx.nodeOf(item.key);
  return html`
    <li class="rollout-item ${display.tone}">
      <span class="state-icon ${display.tone}" aria-hidden="true">${item.state === 'running' ? spinner('Running') : display.icon}</span>
      <span class="rollout-item-text">
        ${node ? html`<button type="button" class="link" @click=${() => ctx.onReveal(node)}>${item.path}</button>` : html`<span>${item.path}</span>`}
        ${notes.map((note) => html`<span class="rollout-note ${note.tone}">${note.text}</span>`)}
      </span>
      <span class="rollout-item-state">${badge(display.label, display.tone)}${item.action && item.state === 'done' ? html`<span class="muted small-text">${item.action}</span>` : nothing}</span>
    </li>`;
}

function renderGroup(group, ctx) {
  return html`
    <section class="rollout-group">
      <header class="rollout-group-head">
        <h4>${group.label}</h4>
        <span class="muted">${group.progress.settled} of ${group.progress.total} settled</span>
      </header>
      ${group.locations.map((entry) => html`
        <div class="rollout-location">
          <div class="rollout-location-head">
            ${entry.location ? langBadge(entry.location) : nothing}
            <strong>${entry.location?.label ?? entry.locationId}</strong>
            <span class="page-path">${entry.locationId}</span>
          </div>
          <ul class="rollout-items">${entry.items.map((item) => renderItem(item, ctx))}</ul>
        </div>`)}
    </section>`;
}

function renderDetail(run, ctx) {
  if (!run) return html`<div class="detail-empty"><p>Select a rollout to see its progress.</p></div>`;
  const busy = ctx.rolloutBusy.has(run.id);
  const status = rolloutStatus(run, busy);
  const progress = rolloutProgress(run);
  const translating = translatingItems(run);
  const checkedAt = ctx.rolloutChecked.get(run.id);
  return html`
    <header class="rollout-head">
      <div>
        <h2>${rolloutTitle(run)}</h2>
        <p class="muted">
          Started ${formatRelative(run.createdAt)}
          · ${run.pages?.length ?? 0} source page${run.pages?.length === 1 ? '' : 's'}
          ${run.option ? html`· ${OPTION_LABELS[run.option] ?? run.option}` : nothing}
          ${run.targets?.length ? html`· ${run.targets.length} selected targets` : html`· all targets`}
        </p>
      </div>
      <div class="rollout-actions">
        ${translating.length && ctx.canResume ? html`
          <button type="button" class="btn" ?disabled=${busy} @click=${() => ctx.onResume(run)}>Check status</button>` : nothing}
        ${canRetry(run) ? html`
          <button type="button" class="btn accent" ?disabled=${busy} @click=${() => ctx.onRetry(run)}>Retry</button>` : nothing}
        ${ctx.canCancel && canCancel(run, busy) ? html`
          <button type="button" class="btn destructive" @click=${() => ctx.onAskCancel(run)}>Cancel rollout</button>` : nothing}
        ${ctx.canArchive && canArchive(run, busy) && !isArchived(run) ? html`
          <button type="button" class="btn" @click=${() => ctx.onArchive(run, true)}>Archive</button>` : nothing}
        ${ctx.canArchive && isArchived(run) && !busy ? html`
          <button type="button" class="btn" @click=${() => ctx.onArchive(run, false)}>Unarchive</button>` : nothing}
      </div>
    </header>
    ${ctx.cancelConfirmId === run.id ? html`
      <div class="confirm" role="alertdialog" aria-label="Confirm cancel rollout">
        <p>Stops remaining steps. Completed pages stay as they are; pages waiting on translation go back to their previous state.</p>
        <div class="confirm-actions">
          <button type="button" class="btn" @click=${() => ctx.onDismissCancel()}>Keep running</button>
          <button type="button" class="btn destructive" @click=${() => ctx.onCancel(run)}>Cancel rollout</button>
        </div>
      </div>` : nothing}
    <div class="rollout-overview">
      <div class="rollout-overview-line">
        ${badge(status.label, status.tone)}
        <span>${progress.settled} of ${progress.total} pages settled</span>
        ${busy ? spinner('Running') : nothing}
      </div>
      ${progressBar(progress, 'Rollout progress')}
      <div class="badge-row">${summaryChips(run).map((chip) => badge(`${chip.count} ${chip.label.toLowerCase()}`, chip.tone))}</div>
      ${translating.length ? html`<p class="muted small-text">
        ${translating.length} page${translating.length === 1 ? ' is' : 's are'} at the translation service.
        Pages below ${translating.length === 1 ? 'it continue' : 'them continue'} once the translation is saved.
        ${checkedAt ? html`Checked ${formatRelative(checkedAt)}.` : nothing}</p>` : nothing}
      ${run.saveError ? html`<p class="error-text">This rollout could not be saved: ${run.saveError}</p>` : nothing}
    </div>
    ${groupRollout(run, ctx).map((group) => renderGroup(group, ctx))}`;
}

export default function renderRolloutsView(ctx) {
  const active = ctx.allRollouts.find((run) => run.id === ctx.activeRolloutId) ?? null;
  return html`
    <div class="rollouts-layout">
      <section class="rollouts-list" aria-label="Rollouts">
        <header class="rollouts-list-head">
          <h2>Rollouts</h2>
          <button type="button" class="btn small quiet" ?disabled=${ctx.loading} @click=${ctx.onReload}>Refresh</button>
        </header>
        <label class="rollout-filter">
          <input type="checkbox" .checked=${ctx.showCompleted} @change=${(event) => ctx.onToggleCompleted(event.target.checked)}>
          Show completed &amp; archived
        </label>
        ${ctx.starting ? html`<p class="loading-text">${spinner('Planning')} Planning ${ctx.starting}…</p>` : nothing}
        ${ctx.loading ? html`<p class="loading-text">${spinner('Loading')} Loading rollouts…</p>` : nothing}
        ${ctx.error ? html`<p class="error-text">${ctx.error}</p>` : nothing}
        ${!ctx.loading && !ctx.rollouts.length && !ctx.starting ? html`<p class="muted">${ctx.allRollouts.length
    ? 'Nothing in progress and nothing needs your attention.'
    : 'No rollouts yet. Select source pages and choose Update / Create.'}</p>` : nothing}
        <ul class="rollout-entries">${ctx.rollouts.map((run) => renderListEntry(run, ctx))}</ul>
      </section>
      <section class="rollout-detail" aria-label="Rollout details">${renderDetail(active, ctx)}</section>
    </div>`;
}
