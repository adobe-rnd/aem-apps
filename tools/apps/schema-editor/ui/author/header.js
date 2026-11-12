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
import { LitElement, html, nothing } from 'da-lit';
import { icon } from '../shared/icons.js';
import { routeHash } from '../../core/routes.js';
import { labelOf } from '../../core/model/query.js';
import { buttons, shared, loadStyle } from '../shared/styles.js';
import { modKey, plural } from '../shared/format.js';

await import('https://da.live/nx2/blocks/shared/segmented-btn/segmented.js');

const style = await loadStyle(import.meta.url);

const MODE_ITEMS = [
  { value: 'build', label: 'Build' },
  { value: 'components', label: 'Components' },
];

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function saveStatus({ saveState = {}, dirty }) {
  if (saveState.state === 'saving') return { text: 'Saving…', tone: 'muted' };
  if (saveState.state === 'error') return { text: saveState.error || 'Save failed', tone: 'error' };
  if (dirty) return { text: 'Unsaved changes', tone: 'dirty' };
  if (saveState.state === 'saved' && saveState.savedAt) {
    return { text: `Saved ${timeFormat.format(saveState.savedAt)}`, tone: 'muted' };
  }
  return { text: '', tone: 'muted' };
}

/**
 * `<se-header>`: the authoring screen's bar, laid out like the da.live canvas header so nothing
 * moves when the chat or tool panel opens. Renders what `<se-author>` passes and calls the store.
 */
class SeHeader extends LitElement {
  static properties = {
    store: { attribute: false },
    state: { attribute: false },
    saveState: { attribute: false },
    mode: { type: String },
    chatAvailable: { type: Boolean },
    chatOpen: { type: Boolean },
    panelOpen: { type: Boolean },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
  }

  _selectRoot(model) {
    if (!model) return;
    this.store.select(model.root.id, { reveal: true });
  }

  /** The Components panel picks the component, so arriving on that page brings it forward. */
  _setMode(mode) {
    this.store.setMode(mode);
    if (mode === 'components') this.store.bus.panelRequest.emit({ view: 'components' });
  }

  _renderIssues(counts) {
    const total = counts.error + counts.warning;
    if (!total) return nothing;
    const tone = counts.error ? 'is-error' : 'is-warning';
    return html`
      <button type="button" class="nx-action-btn-quiet issues ${tone}"
        title=${`${plural(counts.error, 'error')}, ${plural(counts.warning, 'warning')}`}
        @click=${() => this.store.bus.panelRequest.emit({ view: 'issues', open: true })}>
        ${icon('alert')} ${total}<span class="sr-only">issues — show</span>
      </button>
    `;
  }

  _renderChatToggle() {
    if (!this.chatAvailable || this.chatOpen) return nothing;
    return html`
      <button type="button" class="nx-action-btn-icon" part="btn toggle-chat"
        aria-label="Open chat" title="Ask the assistant about this schema"
        @click=${() => this.store.bus.chatRequest.emit({ intent: 'ask' })}>${icon('chat')}</button>
      <span class="divider" aria-hidden="true"></span>
    `;
  }

  _renderPanelToggle() {
    if (this.panelOpen) return nothing;
    return html`
      <button type="button" class="nx-action-btn-icon" part="btn toggle-panel"
        aria-label="Open panel" title="Open panel"
        @click=${() => this.store.bus.panelRequest.emit({ open: true })}>${icon('panel')}</button>
    `;
  }

  render() {
    const { store, state = {}, saveState = {} } = this;
    const { model, counts = { error: 0, warning: 0 }, dirty } = state;
    const status = saveStatus({ saveState, dirty });
    const saving = saveState.state === 'saving';
    const blocked = counts.error > 0;
    const saveTitle = blocked
      ? `Fix ${plural(counts.error, 'error')} to save`
      : `Save (${modKey()}S)`;
    const title = model ? labelOf(model, model.root) : '';

    return html`
      <header class="bar">
        <div class="group group-start">
          ${this._renderChatToggle()}
          <a class="nx-action-btn-icon back" title="All schemas"
            aria-label="Back to all schemas" href=${routeHash({ org: store.org, site: store.site })}>
            ${icon('chevronLeft')}</a>
          <button type="button" class="title" title="Select the schema root"
            @click=${() => this._selectRoot(model)}>${title || store.name}</button>
          <span class="key">${store.name}</span>
          ${this._renderIssues(counts)}
          <span class="status is-${status.tone}" role="status" title=${status.text}>
            ${status.tone === 'dirty' ? html`<span class="dot" aria-hidden="true"></span>` : nothing}
            <span class="status-text">${status.text}</span>
            ${saveState.state === 'error' ? html`
              <button type="button" class="nx-action-btn-quiet nx-btn-sm"
                @click=${() => store.save()}>Retry</button>` : nothing}
          </span>
        </div>
        <div class="group group-center">
          <nx-segmented-btn label="View" .items=${MODE_ITEMS} .value=${this.mode}
            @change=${(e) => this._setMode(e.detail.value)}></nx-segmented-btn>
        </div>
        <div class="group group-end">
          <button type="button" class="nx-action-btn-icon"
            ?disabled=${!state.canUndo}
            title=${state.undoLabel ? `Undo ${state.undoLabel} (${modKey()}Z)` : 'Undo'}
            aria-label="Undo" @click=${() => store.undo()}>${icon('undo')}</button>
          <button type="button" class="nx-action-btn-icon"
            ?disabled=${!state.canRedo}
            title=${state.redoLabel ? `Redo ${state.redoLabel} (⇧${modKey()}Z)` : 'Redo'}
            aria-label="Redo" @click=${() => store.redo()}>${icon('redo')}</button>
          <button type="button" class="nx-btn-accent save" title=${saveTitle}
            ?disabled=${!dirty || blocked || saving} @click=${() => store.save()}>
            ${saving ? 'Saving…' : 'Save'}
          </button>
          ${this._renderPanelToggle()}
        </div>
      </header>
    `;
  }
}

if (!customElements.get('se-header')) customElements.define('se-header', SeHeader);
