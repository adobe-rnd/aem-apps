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
  impliedIds, effectiveTargets, targetState, levelGroups, groupState, filterTargets,
  kindSections, flattenSection,
} from '../data/targets.js';
import {
  planPreview, countOutcomes, byLocation, outcomeChips, summaryText, primaryLabel,
} from '../data/plan-preview.js';
import { OPTION_LABELS } from '../data/display.js';
import { badge, langBadge, spinner } from './common.js';

const OPTION_HELP = {
  merge: 'Keep local changes. Conflicts are marked for review.',
  overwrite: 'Replace each page with its source. Local changes are lost.',
};

export function drawerModel(drawer, results) {
  const { tree, selected } = drawer;
  const implied = impliedIds(tree, selected);
  const effective = effectiveTargets(tree, selected);
  const items = planPreview(drawer.sources, effective, results);
  return {
    implied,
    items,
    counts: countOutcomes(items),
    perLocation: byLocation(planPreview(drawer.sources, null, results)),
    levels: levelGroups(tree),
    sections: kindSections(tree),
    visible: filterTargets(tree, drawer.query),
  };
}

const where = (location, rootSite) => (location.site === rootSite
  ? location.path
  : `${location.site}:${location.path}`);

function renderSources(drawer, ctx) {
  return html`
    <section class="sheet-section" aria-labelledby="sheet-pages">
      <h3 id="sheet-pages">Source pages <span class="count-pill">${drawer.sources.length}</span></h3>
      <ul class="chip-list">
        ${drawer.sources.map((node) => html`
          <li class="chip">
            <span class="chip-text"><strong>${node.title}</strong> <span class="page-path">${where({ site: node.site, path: node.path }, ctx.rootSite)}</span></span>
            ${drawer.sources.length > 1 ? html`
              <button type="button" class="chip-remove" aria-label="Remove ${node.path}"
                @click=${() => ctx.onRemoveSource(node.key)}>×</button>` : nothing}
          </li>`)}
      </ul>
    </section>`;
}

function renderLevels(model, drawer, ctx) {
  return html`
    <div class="level-toggles" role="group" aria-label="Select by level">
      ${model.levels.map((group) => {
    const state = groupState(drawer.selected, group.ids);
    const pressed = { all: 'true', some: 'mixed', none: 'false' }[state];
    return html`
          <button type="button" class="level-chip ${state}" aria-pressed=${pressed}
            @click=${() => ctx.onLevel(group.ids, state !== 'all')}>
            All ${group.label} <span class="muted">(${group.ids.length})</span>
          </button>`;
  })}
    </div>`;
}

function renderTargetRow(row, model, drawer, ctx) {
  const node = drawer.tree.nodes.get(row.id);
  const state = targetState(drawer.selected, model.implied, row.id);
  const chips = outcomeChips(model.perLocation.get(row.id));
  const { location } = node;
  return html`
    <li class="target-row ${state}" style="--indent: ${row.indent}">
      <label class="target-label">
        <input type="checkbox" .checked=${state === 'checked'} .indeterminate=${state === 'implied'}
          @change=${(event) => ctx.onToggle(row.id, event.target.checked)}>
        ${langBadge(location)}
        <span class="target-text">
          <span class="target-name">${location.label}</span>
          <span class="page-path">${node.level} · ${where(location, ctx.rootSite)}</span>
          ${state === 'implied' ? html`<span class="implied-note">Included as the source of selected targets</span>` : nothing}
        </span>
      </label>
      <span class="target-outcomes">
        ${chips.length ? chips.map((chip) => badge(drawer.sources.length > 1 || chip.count > 1 ? `${chip.count} ${chip.label.toLowerCase()}` : chip.label, chip.tone)) : html`<span class="muted">No pages</span>`}
      </span>
    </li>`;
}

function renderTargets(model, drawer, ctx) {
  const total = drawer.tree.nodes.size;
  return html`
    <section class="sheet-section" aria-labelledby="sheet-targets">
      <div class="sheet-section-head">
        <h3 id="sheet-targets">Targets <span class="count-pill">${drawer.selected.size} of ${total}</span></h3>
        <span class="spacer"></span>
        <button type="button" class="btn small quiet" @click=${() => ctx.onAll(true)}>Select all</button>
        <button type="button" class="btn small quiet" @click=${() => ctx.onAll(false)}>Clear</button>
      </div>
      <label class="search">
        <span class="visually-hidden">Filter targets</span>
        <input type="search" placeholder="Filter by name, language or path" .value=${drawer.query}
          @input=${(event) => ctx.onQuery(event.target.value)}>
      </label>
      ${renderLevels(model, drawer, ctx)}
      ${model.sections.map((section) => {
    const rows = flattenSection(section, model.visible);
    if (!rows.length) return nothing;
    return html`
          <div class="target-section">
            <h4>${section.label}</h4>
            <ul class="target-list">${rows.map((row) => renderTargetRow(row, model, drawer, ctx))}</ul>
          </div>`;
  })}
      ${!total ? html`<p class="muted">These pages have no target locations.</p>` : nothing}
    </section>`;
}

function renderOptions(drawer, ctx) {
  return html`
    <section class="sheet-section" aria-labelledby="sheet-options">
      <h3 id="sheet-options">Local changes</h3>
      <div class="option-list" role="radiogroup" aria-labelledby="sheet-options">
        ${['merge', 'overwrite'].map((option) => html`
          <label class="option ${drawer.option === option ? 'active' : ''}">
            <input type="radio" name="sheet-option" .checked=${drawer.option === option}
              @change=${() => ctx.onOption(option)}>
            <span><strong>${option === 'merge' ? 'Merge (keep local changes)' : OPTION_LABELS[option]}</strong>
              <span class="option-help">${OPTION_HELP[option]}</span></span>
          </label>`)}
      </div>
      <p class="muted small-text">Applied where the location allows it. Translations always go through the translation service first.</p>
    </section>`;
}

export default function renderActionDrawer(drawer, ctx) {
  if (!drawer) return nothing;
  const model = drawerModel(drawer, ctx.results);
  const { counts } = model;
  const disabled = drawer.busy || !model.items.length;
  return html`
    <div class="sheet-backdrop" @click=${ctx.onClose}></div>
    <aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"
      @keydown=${(event) => { if (event.key === 'Escape') ctx.onClose(); }}>
      <header class="sheet-header">
        <div>
          <h2 id="sheet-title">Update and create pages</h2>
          <p class="muted">Choose target locations. Each level runs after its source level is done.</p>
        </div>
        <button type="button" class="btn quiet icon" aria-label="Close" @click=${ctx.onClose}>×</button>
      </header>
      <div class="sheet-body">
        ${renderSources(drawer, ctx)}
        ${renderTargets(model, drawer, ctx)}
        ${renderOptions(drawer, ctx)}
      </div>
      <footer class="sheet-footer">
        <p class="sheet-summary" role="status">
          ${counts.unknown ? spinner('Checking') : nothing}
          ${summaryText(counts)}
        </p>
        <div class="sheet-actions">
          <button type="button" class="btn" @click=${ctx.onClose}>Cancel</button>
          <button type="button" class="btn accent" ?disabled=${disabled} @click=${() => ctx.onRun(model)}>
            ${drawer.busy ? spinner('Starting') : nothing}${primaryLabel(counts)}
          </button>
        </div>
      </footer>
    </aside>`;
}
