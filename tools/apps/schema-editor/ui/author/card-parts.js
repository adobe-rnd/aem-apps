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

// Stateless templates for the parts of a canvas card; `<se-canvas>` composes them into rows.

import { html, nothing } from 'da-lit';
import { worstSeverity } from '../../core/model/lint.js';
import { labelOf, refUsages } from '../../core/model/query.js';
import { icon } from '../shared/icons.js';
import { SEVERITY_NAME, usageLabel, usedIn } from '../shared/format.js';
import { kindLabel, compactChips } from './card-info.js';

/** The card's label, then the component name, field key or "(item)" it goes by. */
export function renderTitle(model, node, parent, def) {
  const title = labelOf(model, node) || 'Untitled';
  return html`
    <span class="card-title">${title}</span>
    ${def && def.name !== title ? html`<span class="card-key muted">${def.name}</span>` : nothing}
    ${parent?.kind === 'object' ? html`<span class="card-key muted">${node.key}</span>` : nothing}
    ${parent?.kind === 'array' ? html`<span class="card-key muted">(item)</span>` : nothing}
  `;
}

/**
 * The kind column. A component use names its component (a narrow canvas hides the usage count,
 * `.card-kind-more`); a component's top counts its uses.
 */
export function renderKind(model, node, { parent, def, use }) {
  if (use) {
    const used = refUsages(model, use.id).length;
    return html`<span class="card-kind is-use-kind muted">Component: ${use.name}<span class="card-kind-more"> · used ${usedIn(used)}</span></span>`;
  }
  const usage = !parent && def ? ` · ${usageLabel(refUsages(model, def.id).length)}` : '';
  return html`<span class="card-kind muted">${kindLabel(model, node)}${usage}</span>`;
}

/** All the chips, and the compact set a narrow canvas shows instead. */
export function renderChips(node, chips) {
  const chip = (text) => html`<span class="chip">${text}</span>`;
  return html`
    <span class="card-chips">${chips.map(chip)}</span>
    <span class="card-chips is-compact" title=${chips.join(' · ')}>
      ${compactChips(node).map(chip)}</span>
  `;
}

/** The node's worst issues, as an icon with their messages; info issues show nothing. */
export function renderIssue(issues) {
  const severity = worstSeverity(issues);
  if (!severity || severity === 'info') return nothing;
  const text = issues.filter((i) => i.severity === severity).map((i) => i.message).join('\n');
  return html`<span class="card-issue is-${severity}" title=${text}>
    ${icon('alert')}<span class="sr-only">${SEVERITY_NAME[severity]}: ${text}</span></span>`;
}

export function renderToggle(expanded, onToggle) {
  const label = expanded ? 'Collapse' : 'Expand';
  return html`
    <button type="button" class=${`tree-toggle${expanded ? ' is-expanded' : ''}`} tabindex="-1"
      aria-label=${label} title=${label}
      @click=${(e) => { e.stopPropagation(); onToggle(); }}>
      ${icon('chevronRight')}</button>
  `;
}

/** In place of a preview row's actions, so it reads as locked, not just grey. */
export function renderLock(partOf) {
  return html`<span class="card-lock" aria-hidden="true"
    title=${`Part of the ${partOf.name} component`}>${icon('lock')}</span>`;
}

/** Why a component use refuses a drop. The title repeats the text, as the pill truncates it. */
export function renderBlockedNote(def) {
  const text = `${def.name} is a component. Edit it on the Components page.`;
  return html`<span class="drop-reason" role="status" title=${text}>${text}</span>`;
}

/** The head's tooltip on a component use or preview row: where to edit it. */
export function headTitle(open, partOf) {
  if (partOf) return `Part of the ${partOf.name} component. Double-click to edit it on the Components page.`;
  if (open?.def) return `Uses the ${open.def.name} component. Double-click to edit it on the Components page.`;
  return nothing;
}
