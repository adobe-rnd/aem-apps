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
import { countIssues } from '../../core/model/lint.js';
import { findNode, labelOf } from '../../core/model/query.js';
import { icon } from '../shared/icons.js';
import { nodeIcon } from '../author/card-info.js';
import { applyFix } from '../shared/actions.js';
import { plural } from '../shared/format.js';
import { loadStyle } from '../shared/styles.js';
import { PanelView } from './panel-view.js';

const style = await loadStyle(import.meta.url);

const SEVERITY_ICON = { error: 'alert', warning: 'alert', info: 'info' };

/** Groups issues by node, keeping the linter's order; unknown nodes form one "Schema" group. */
export function groupIssues(model, issues) {
  const groups = new Map();
  issues.forEach((issue) => {
    const entry = issue.nodeId ? findNode(model, issue.nodeId) : null;
    const id = entry ? issue.nodeId : null;
    if (!groups.has(id)) {
      const label = entry
        ? (entry.def && !entry.parent ? entry.def.name : labelOf(model, entry.node)) || 'Untitled'
        : 'Schema';
      groups.set(id, {
        nodeId: id, label, node: entry?.node ?? null, issues: [],
      });
    }
    groups.get(id).issues.push(issue);
  });
  return [...groups.values()];
}

/** Problems found by the linter and the SDK, grouped by element. */
class SeIssues extends PanelView {
  static sheets = [style];

  _reveal(nodeId) {
    if (!nodeId) return;
    // Revealing picks Build or Components, whichever shows the element.
    this.store.select(nodeId, { reveal: true });
  }

  _renderIssue(issue) {
    return html`
      <li class="issue is-${issue.severity}">
        <span class="sev">${icon(SEVERITY_ICON[issue.severity] ?? 'info')}
          <span class="sr-only">${issue.severity}</span></span>
        <span class="issue-text">
          <span>${issue.message}</span>
          ${issue.schemaPath ? html`<span class="path">${issue.schemaPath}</span>` : nothing}
        </span>
        ${issue.fix ? html`
          <button type="button" class="nx-action-btn nx-btn-sm"
            @click=${() => applyFix(this.store, issue)}>${issue.fix.label}</button>` : nothing}
      </li>
    `;
  }

  render() {
    if (!this.ready) return this.renderNotReady();
    const counts = countIssues(this.issues);
    if (!this.issues.length) {
      return html`
        <div class="panel">
          <div class="empty">
            <span class="ok">${icon('check')}</span>
            <p>No issues. The schema is ready to save.</p>
          </div>
        </div>
      `;
    }
    return html`
      <div class="panel">
        <p class="summary" aria-live="polite">
          ${counts.error ? html`<span class="chip is-error">${plural(counts.error, 'error')}</span>` : nothing}
          ${counts.warning ? html`<span class="chip is-warning">${plural(counts.warning, 'warning')}</span>` : nothing}
          ${counts.info ? html`<span class="chip is-info">${plural(counts.info, 'note')}</span>` : nothing}
          ${this.chatAvailable && (counts.error || counts.warning) ? html`
            <button type="button" class="nx-action-btn nx-btn-sm fix-ai"
              title="Hand the issues to the assistant and let it fix the schema"
              @click=${() => this.bus.chatRequest.emit({ intent: 'fix' })}>
              ${icon('ai')} Fix with AI
            </button>` : nothing}
        </p>
        ${groupIssues(this.model, this.issues).map((group) => html`
          <section class="group">
            <button type="button" class="group-head" ?disabled=${!group.nodeId}
              aria-current=${group.nodeId && group.nodeId === this.selection ? 'true' : nothing}
              @click=${() => this._reveal(group.nodeId)}>
              <span class="node-icon ${group.node?.kind === 'ref' ? 'is-ref' : ''}">
                ${icon(group.node ? nodeIcon(group.node) : 'schema')}</span>
              <span class="group-label">${group.label}</span>
            </button>
            <ul class="list">${group.issues.map((issue) => this._renderIssue(issue))}</ul>
          </section>
        `)}
      </div>
    `;
  }
}

if (!customElements.get('se-issues')) customElements.define('se-issues', SeIssues);
