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
import { icon } from '../shared/icons.js';
import { getNode, labelOf } from '../../core/model/query.js';
import { topNode } from '../../core/session/modes.js';
import { insertionPoint } from '../../core/dnd/targets.js';
import { paletteSections, insertPaletteItem } from '../shared/palette.js';
import { startDrag, endDrag } from '../shared/drag-session.js';
import { loadStyle } from '../shared/styles.js';
import { PanelView } from './panel-view.js';

await import('https://da.live/nx2/blocks/shared/search/search.js');

const style = await loadStyle(import.meta.url);

/**
 * The element palette. Rows are drag sources and a click does nothing, so browsing never
 * changes the schema; Enter or Space adds a row at the insertion point (the keyboard's drag).
 */
class SeElements extends PanelView {
  static sheets = [style];

  static properties = {
    ...PanelView.properties,
    _query: { state: true },
  };

  constructor() {
    super();
    this._query = '';
  }

  get _top() {
    return topNode(this.model, this.editingDefId, this.page);
  }

  get _target() {
    return insertionPoint(this.model, this.selection, this._top);
  }

  /** Where Enter adds, for screen readers; the visible hint is about dragging. */
  _targetHint(target) {
    if (!target) {
      return 'Select a Group or List to add elements with Enter.';
    }
    const parent = getNode(this.model, target.parentId);
    const top = this._top;
    if (parent?.kind === 'array') return `Enter adds the item of "${labelOf(this.model, parent)}".`;
    const before = parent?.children?.[target.index - 1];
    if (before && target.index < parent.children.length) {
      return `Enter adds after "${labelOf(this.model, before)}".`;
    }
    if (parent === top) {
      return top === this.model.root ? 'Enter adds to the end of the schema.'
        : `Enter adds to the end of "${labelOf(this.model, top)}".`;
    }
    return `Enter adds inside "${labelOf(this.model, parent)}".`;
  }

  _onKeyDown(event, item) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Also keeps the button from turning the key into a click.
    event.preventDefault();
    if (this._target) insertPaletteItem(this.store, item);
  }

  _onDragStart(event, item) {
    const { type, id, label } = item;
    startDrag(this.store?.bus, { source: 'palette', item: { type, id, label } }, event.dataTransfer);
  }

  _renderRow(item) {
    return html`
      <li>
        <button type="button" class="element-row" draggable="true"
          data-palette-type=${item.type} data-palette-id=${item.id}
          title=${item.description ?? item.label} aria-describedby="palette-target"
          @keydown=${(e) => this._onKeyDown(e, item)}
          @dragstart=${(e) => this._onDragStart(e, item)}
          @dragend=${() => endDrag(this.store?.bus)}>
          <span class="node-icon ${item.type === 'component' ? 'is-ref' : ''}">${icon(item.icon)}</span>
          <span class="element-label">${item.label}</span>
          <span class="grip">${icon('drag')}</span>
        </button>
      </li>
    `;
  }

  render() {
    if (!this.ready) return this.renderNotReady();
    const target = this._target;
    const sections = paletteSections(this.model, {
      parentId: target?.parentId,
      query: this._query,
    });
    return html`
      <div class="panel">
        <nx-search placeholder="Search elements" label="Search elements" .value=${this._query}
          @input=${(e) => { this._query = e.target.value ?? ''; }}></nx-search>
        <p class="hint">Drag an element onto the ${this.page.mode === 'components' ? 'component' : 'schema'} to add it.</p>
        <p class="sr-only" id="palette-target" aria-live="polite">${this._targetHint(target)}</p>
        ${sections.map((section) => html`
          <section class="palette-section" aria-labelledby="ps-${section.id}">
            <h3 class="eyebrow" id="ps-${section.id}">${section.label}</h3>
            <ul class="element-rows">
              ${section.items.map((item) => this._renderRow(item))}
            </ul>
          </section>
        `)}
        ${sections.length ? nothing : html`<p class="empty">No elements match "${this._query}".</p>`}
      </div>
    `;
  }
}

if (!customElements.get('se-elements')) customElements.define('se-elements', SeElements);
