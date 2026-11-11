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
import { html, nothing } from 'da-lit';
import { updateNode } from '../../core/model/commands.js';
import {
  findNode, labelOf, breadcrumb, refUsages,
} from '../../core/model/query.js';
import { icon, iconHref } from '../shared/icons.js';
import { usesPhrase } from '../shared/format.js';
import { kindLabel, nodeIcon } from '../author/card-info.js';
import { applyFix } from '../shared/actions.js';
import { loadStyle } from '../shared/styles.js';
import { sectionsFor } from './inspector.js';
import { SECTIONS } from './sections/index.js';
import { PanelView } from './panel-view.js';
import { renderNodeJson } from './node-json.js';

await import('https://da.live/nx2/blocks/shared/segmented-btn/segmented.js');

const style = await loadStyle(import.meta.url);

// A view switch, so it sits icon-only in the header corner, not among the element's settings.
const VIEWS = [
  {
    value: 'settings', label: 'Show settings', icon: iconHref('properties'), iconOnly: true,
  },
  {
    value: 'json', label: 'Show JSON', icon: iconHref('code'), iconOnly: true,
  },
];

const SEVERITY_ICON = { error: 'alert', warning: 'alert', info: 'info' };

/**
 * The inspector: the selected node as Settings (laid out by `sectionsFor`) or JSON. Owns the
 * sections' context, per-node UI state and the issue callout; outside Build mode it is read-only.
 */
class SeProperties extends PanelView {
  static properties = {
    ...PanelView.properties,
    _tab: { state: true },
  };

  static sheets = [style];

  constructor() {
    super();
    this._tab = 'settings';
    // Per-node UI state that isn't part of the model (pattern sample, drafts…).
    this._viewState = new Map();
  }

  applyRequest({ tab }) {
    if (VIEWS.some((item) => item.value === tab)) this._tab = tab;
  }

  _viewFor(nodeId) {
    if (!this._viewState.has(nodeId)) this._viewState.set(nodeId, {});
    const state = this._viewState.get(nodeId);
    return {
      get: (key) => state[key],
      set: (key, value, { silent = false } = {}) => {
        state[key] = value;
        if (!silent) this.requestUpdate();
      },
      bump: (id) => {
        state[`picker:${id}`] = (state[`picker:${id}`] ?? 0) + 1;
        this.requestUpdate();
      },
    };
  }

  _context(entry) {
    const { node } = entry;
    const issues = this.issues.filter((issue) => issue.nodeId === node.id);
    const consumed = new Set();
    const { store } = this;
    return {
      store,
      model: this.model,
      entry,
      node,
      issues,
      consumed,
      view: this._viewFor(node.id),
      error(field) {
        const issue = issues.find((i) => i.field === field && i.severity === 'error');
        if (!issue) return '';
        consumed.add(issue);
        return issue.message;
      },
      update: (patch) => store.dispatch(updateNode, { nodeId: node.id, patch }),
      dispatch: (command, args) => store.dispatch(command, args),
    };
  }

  updated() {
    this._applyPendingFocus();
  }

  _applyPendingFocus() {
    if (!this.selection) return;
    const view = this._viewFor(this.selection);
    const index = view.get('focusChoice');
    if (index === undefined) return;
    view.set('focusChoice', undefined, { silent: true });
    this.shadowRoot.querySelector(`[data-choice-index="${index}"]`)?.focus();
  }

  _renderHeader(entry) {
    const { node } = entry;
    const trail = breadcrumb(this.model, node.id).slice(0, -1);
    return html`
      <header class="panel-header inspector-head">
        <span class="node-icon ${node.kind === 'ref' ? 'is-ref' : ''}">${icon(nodeIcon(node))}</span>
        <div class="inspector-title">
          <h2>${labelOf(this.model, node) || 'Untitled'}</h2>
          <p class="hint">${kindLabel(this.model, node)}</p>
        </div>
        <nx-segmented-btn class="view-switch" label="View as" .items=${VIEWS} .value=${this._tab}
          @change=${(e) => { this._tab = e.detail.value; }}></nx-segmented-btn>
      </header>
      ${trail.length ? html`<p class="hint trail" title=${trail.join(' › ')}>In ${trail.join(' › ')}</p>` : nothing}
    `;
  }

  _renderComponentNote({ def, parent }) {
    if (!def || !parent) return nothing;
    const used = refUsages(this.model, def.id).length;
    return html`
      <p class="notice is-info component-note">${icon('component')}
        <span>Part of the <strong>${def.name}</strong> component.
          Changes apply to ${usesPhrase(used)}.</span>
      </p>
    `;
  }

  _renderCallout(ctx) {
    const rest = ctx.issues.filter((issue) => !ctx.consumed.has(issue));
    if (!rest.length) return nothing;
    return html`
      <ul class="list callout" aria-label="Issues">
        ${rest.map((issue) => html`
          <li class="notice is-${issue.severity}">
            ${icon(SEVERITY_ICON[issue.severity] ?? 'info')}
            <span class="notice-text">${issue.message}</span>
            ${issue.fix ? html`
              <button type="button" class="nx-action-btn nx-btn-sm"
                @click=${() => applyFix(this.store, issue)}>${issue.fix.label}</button>` : nothing}
          </li>
        `)}
      </ul>
    `;
  }

  _renderSettings(entry) {
    const ctx = this._context(entry);
    // Sections first: they mark the issues they show inline as consumed.
    const sections = sectionsFor(entry).map((id) => SECTIONS[id]?.(ctx) ?? nothing);
    return html`
      <div class="settings">
        ${this._renderComponentNote(entry)}
        ${this._renderCallout(ctx)}
        ${sections}
      </div>
    `;
  }

  render() {
    if (!this.ready) return this.renderNotReady();
    const entry = findNode(this.model, this.selection);
    if (!entry) {
      return html`<div class="empty"><p>Select an element to edit its properties.</p></div>`;
    }
    return html`
      <div class="panel">
        ${this._renderHeader(entry)}
        ${this._tab === 'json'
    ? renderNodeJson({ store: this.store, model: this.model, node: entry.node })
    : this._renderSettings(entry)}
      </div>
    `;
  }
}

if (!customElements.get('se-properties')) customElements.define('se-properties', SeProperties);
