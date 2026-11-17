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
import { countIssues, issuePointer } from '../../core/model/lint.js';
import { findNode, breadcrumb } from '../../core/model/query.js';
import { icon } from '../shared/icons.js';
import { nodeIcon } from '../author/card-info.js';
import { applyFix } from '../shared/actions.js';
import { plural } from '../shared/format.js';
import { fixableIssues } from '../../core/prompts.js';
import { loadStyle } from '../shared/styles.js';
import { BusController } from '../shared/bus-controller.js';
import { PanelView } from './panel-view.js';

const style = await loadStyle(import.meta.url);

const SEVERITY_ICON = { error: 'alert', warning: 'alert', info: 'info' };

// The key of the group of the Schema page's text; node ids are strings.
const TEXT = Symbol('text');

function newGroup(model, issue) {
  if (issue.text) {
    return {
      key: TEXT, nodeId: null, text: issue.text, label: 'Schema JSON', icon: 'code', node: null,
    };
  }
  const entry = issue.nodeId ? findNode(model, issue.nodeId) : null;
  if (!entry) {
    return {
      key: null, nodeId: null, label: 'Schema', node: null,
    };
  }
  return {
    key: issue.nodeId,
    nodeId: issue.nodeId,
    pointer: entry.pointer,
    trail: breadcrumb(model, issue.nodeId).map((label) => label || 'Untitled'),
    node: entry.node,
  };
}

/**
 * Groups issues by node, keeping the linter's order; unknown nodes form one "Schema" group, and
 * the Schema page's text (issues with `text`) one "Schema JSON" group. A node's group has its
 * `pointer` in the schema and its `trail` of labels instead of a `label`.
 */
export function groupIssues(model, issues) {
  const groups = new Map();
  issues.forEach((issue) => {
    const group = newGroup(model, issue);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, issues: [] });
    groups.get(group.key).issues.push(issue);
  });
  return [...groups.values()];
}

/**
 * Problems found by the linter, the SDK and in the Schema page's text, grouped by element. On
 * the Schema page they point to their line in the text, and clicking one goes there.
 */
class SeIssues extends PanelView {
  static sheets = [style];

  static properties = {
    /** The Schema page's text, when it differs from the schema's; its lines locate issues. */
    jsonDraft: { state: true },
  };

  constructor() {
    super();
    this.jsonDraft = null;
    this._draftSubscription = new BusController(this, (bus) => [
      bus.modelState.subscribe((state) => { this.jsonDraft = state.jsonDraft ?? null; }),
    ]);
  }

  get _onSchemaPage() {
    return this.page.mode === 'schema';
  }

  /** Where `target` (an issue, or a group's `pointer`) is in the Schema page's text, or null. */
  _textAt({ text, pointer }) {
    if (text) return text;
    return this._onSchemaPage ? this.store.textAt(pointer) : null;
  }

  _reveal(group) {
    const at = this._textAt(group);
    if (!group.nodeId && !at) return;
    // On the Schema page Issues is only the fallback view; pick it so the list stays in front.
    this.store.bus.panelRequest.emit({ view: 'issues' });
    if (at) this.store.revealText(at);
    // Revealing picks Build or Components, whichever shows the element.
    else this.store.select(group.nodeId, { reveal: true });
  }

  /** An element by its place in the JSON on the Schema page, elsewhere by its labels. */
  _renderLabel(group) {
    if (!group.trail) return html`<span class="group-label">${group.label}</span>`;
    if (this._onSchemaPage) {
      if (!group.pointer) return html`<span class="group-label">/</span>`;
      // Long pointers wrap before a slash, between their tokens.
      const tokens = group.pointer.split('/').slice(1).map((token) => html`<wbr>/${token}`);
      return html`<span class="group-label">${tokens}</span>`;
    }
    const parents = group.trail.slice(0, -1).map((label) => `${label} › `).join('');
    return html`<span class="group-label"><span class="trail">${parents}</span>${group.trail.at(-1)}</span>`;
  }

  _renderLocation(issue, group) {
    const at = this._textAt({ text: issue.text, pointer: issuePointer(issue) });
    if (!at?.line) {
      // The group's label already locates its element; only a path past it adds anything.
      const path = issue.schemaPath !== group.pointer ? issue.schemaPath : '';
      return path ? html`<span class="path">${path}</span>` : nothing;
    }
    const label = `Line ${at.line}, column ${at.column}`;
    if (!this._onSchemaPage) return html`<span class="path">${label}</span>`;
    return html`
      <button type="button" class="path is-link" title="Go to this place in the JSON"
        @click=${() => this.store.revealText(at)}>${label}</button>
    `;
  }

  _renderIssue(issue, group) {
    return html`
      <li class="issue is-${issue.severity}">
        <span class="sev">${icon(SEVERITY_ICON[issue.severity] ?? 'info')}
          <span class="sr-only">${issue.severity}</span></span>
        <span class="issue-text">
          <span>${issue.message}</span>
          ${this._renderLocation(issue, group)}
        </span>
        ${issue.fix ? html`
          <button type="button" class="nx-action-btn"
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
          ${this.chatAvailable && fixableIssues(this.issues).length ? html`
            <button type="button" class="nx-action-btn fix-ai"
              title="Hand the issues to the assistant and let it fix the schema"
              @click=${() => this.bus.chatRequest.emit({ intent: 'fix' })}>
              ${icon('ai')} Fix with AI
            </button>` : nothing}
        </p>
        ${groupIssues(this.model, this.issues).map((group) => html`
          <section class="group">
            <button type="button" class="group-head" ?disabled=${!group.nodeId && !group.text}
              aria-current=${group.nodeId && group.nodeId === this.selection ? 'true' : nothing}
              @click=${() => this._reveal(group)}>
              <span class="node-icon ${group.node?.kind === 'ref' ? 'is-ref' : ''}">
                ${icon(group.icon ?? (group.node ? nodeIcon(group.node) : 'schema'))}</span>
              ${this._renderLabel(group)}
            </button>
            <ul class="list">${group.issues.map((issue) => this._renderIssue(issue, group))}</ul>
          </section>
        `)}
      </div>
    `;
  }
}

if (!customElements.get('se-issues')) customElements.define('se-issues', SeIssues);
