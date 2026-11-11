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
import { renameDef } from '../../core/model/commands.js';
import { validateDefName } from '../../core/model/keys.js';
import { refUsages } from '../../core/model/query.js';
import { icon, iconFile } from '../shared/icons.js';
import { usageLabel } from '../shared/format.js';
import { newComponent, deleteComponent, editComponent } from '../shared/actions.js';
import { loadStyle } from '../shared/styles.js';
import { PanelView } from './panel-view.js';

await import('https://da.live/nx2/blocks/shared/menu/menu.js');

const style = await loadStyle(import.meta.url);

const MENU = [
  { id: 'edit', label: 'Edit', icon: iconFile('edit') },
  { id: 'rename', label: 'Rename' },
  { divider: true },
  { id: 'delete', label: 'Delete', icon: iconFile('delete') },
];

/** The schema's components (`$defs`). Shown on the Components page; uses come from Elements. */
class SeComponents extends PanelView {
  static sheets = [style];

  static properties = {
    ...PanelView.properties,
    _renaming: { state: true },
    _draft: { state: true },
  };

  _startRename(def) {
    this._renaming = def.id;
    this._draft = def.name;
    this.updateComplete.then(() => this.shadowRoot.querySelector('.rename')?.select());
  }

  _renameError(def) {
    if (this._draft === def.name) return null;
    const others = this.model.defs.filter((d) => d.id !== def.id).map((d) => d.name);
    return validateDefName(this._draft, others);
  }

  _commitRename(def) {
    if (this._renaming !== def.id) return;
    const error = this._renameError(def);
    this._renaming = null;
    if (error || this._draft === def.name) return;
    this.store.dispatch(renameDef, { defId: def.id, name: this._draft });
  }

  _onRenameKey(event, def) {
    if (event.key === 'Enter') this._commitRename(def);
    if (event.key === 'Escape') this._renaming = null;
  }

  _onAction(def, id) {
    if (id === 'edit') editComponent(this.store, { defId: def.id });
    if (id === 'rename') this._startRename(def);
    if (id === 'delete') deleteComponent(this.store, def.id);
  }

  _renderSummary(def) {
    return html`
      <span class="node-icon is-ref">${icon('component')}</span>
      <span class="def-text">
        <span class="def-name">${def.name}</span>
        <span class="def-meta">${this._usage(def)}</span>
      </span>
    `;
  }

  _renderName(def) {
    if (this._renaming !== def.id) {
      return html`
        <button type="button" class="def-main"
          @click=${() => editComponent(this.store, { defId: def.id })}
          aria-current=${this._shown(def) ? 'true' : nothing}>
          ${this._renderSummary(def)}
        </button>
      `;
    }
    const error = this._renameError(def);
    return html`
      <div class="def-rename">
        <input class="rename" aria-label="Component name" .value=${this._draft}
          aria-invalid=${error ? 'true' : 'false'}
          @input=${(e) => { this._draft = e.target.value; }}
          @keydown=${(e) => this._onRenameKey(e, def)}
          @blur=${() => this._commitRename(def)}>
        ${error ? html`<p class="error-text">${error}</p>` : nothing}
      </div>
    `;
  }

  _shown(def) {
    return this.page.componentId === def.id;
  }

  _usage(def) {
    const used = refUsages(this.model, def.id).length;
    return usageLabel(used);
  }

  _renderActions(def) {
    return html`
      <nx-menu placement="below-end" .items=${MENU}
        @select=${(e) => this._onAction(def, e.detail.id)}>
        <button slot="trigger" type="button" class="nx-action-btn-quiet nx-action-btn-icon"
          aria-label="Actions for ${def.name}">${icon('more')}</button>
      </nx-menu>
    `;
  }

  _renderEmpty() {
    return html`<div class="empty">
      <p>No components yet.</p></div>`;
  }

  render() {
    if (!this.ready) return this.renderNotReady();
    const { defs } = this.model;
    return html`
      <div class="panel">
        <div class="panel-header">
          <h2>Components</h2>
          <button type="button" class="nx-btn-accent nx-btn-sm"
            @click=${() => newComponent(this.store)}>${icon('add')} New component</button>
        </div>
        <p class="hint">Reusable groups of fields. Change one and every usage follows.</p>
        ${defs.length ? html`
          <ul class="list">
            ${defs.map((def) => html`
              <li class="def ${this._shown(def) ? 'is-current' : ''}">
                ${this._renderName(def)}
                ${this._renderActions(def)}
              </li>
            `)}
          </ul>
        ` : this._renderEmpty()}
      </div>
    `;
  }
}

if (!customElements.get('se-components')) customElements.define('se-components', SeComponents);
