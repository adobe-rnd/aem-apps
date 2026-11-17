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
import { copyText } from '../shared/actions.js';
import { highlightJson } from '../shared/json-highlight.js';
import { buttons, shared, loadStyle } from '../shared/styles.js';
import { BusController } from '../shared/bus-controller.js';
import { lineBreakAt, offsetAt, parseSchemaText } from '../../core/json-text.js';
import { replaceSchema } from '../../core/model/commands.js';
import { stringifySchema } from '../../core/model/serialize.js';

const style = await loadStyle(import.meta.url);

// Invalid JSON is reported after a pause in typing (or on leaving the field), not per keystroke.
const REPORT_DELAY = 750;

/** Replaces the selection like typing does, so the textarea's own undo keeps the change. */
function typeText(area, text) {
  if (document.execCommand?.('insertText', false, text)) return;
  area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * `<se-schema-json>`: the Schema page, the whole schema file as JSON text. Valid edits apply as
 * they are typed (one undo step per burst); while the text is not valid JSON the schema keeps
 * its last valid version, and the problem is reported to the store (an issue that blocks
 * saving). The store keeps the text, so leaving the page loses nothing; a change made elsewhere
 * (undo, the assistant) replaces it.
 */
class SeSchemaJson extends LitElement {
  static properties = {
    store: { attribute: false },
    model: { attribute: false },
    _text: { state: true },
    /** The problem reported: `{ error, line?, column? }` (see json-text.js), or null. */
    _problem: { state: true },
  };

  constructor() {
    super();
    this._subscriptions = new BusController(this, (bus) => [
      bus.revealRequest.subscribe(({ text }) => {
        if (text) this._revealAt(text, { focus: true });
      }),
    ]);
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._report();
  }

  get _area() {
    return this.shadowRoot.querySelector('textarea');
  }

  willUpdate(changed) {
    if (!changed.has('model') || !this.model) return;
    const json = stringifySchema(this.model);
    if (json === this._json) return;
    // The first time, the text kept from an earlier visit (the store drops it on a change).
    const kept = this._json === undefined ? this.store.jsonDraft?.text : undefined;
    this._json = json;
    this._show(kept ?? json);
  }

  firstUpdated() {
    // Coming back to text that is not valid: show where, but leave focus on the page switch.
    if (this._problem) this._revealAt(this._problem, { focus: false });
  }

  updated() {
    const area = this._area;
    if (!area) return;
    if (area.value !== this._text) {
      const caret = Math.min(area.selectionStart, this._text.length);
      area.value = this._text;
      area.setSelectionRange(caret, caret);
    }
    if (this._pendingReveal) this._reveal(area);
  }

  /** Puts the caret at `{ line?, column? }` and scrolls it into view, once rendered. */
  _revealAt(at, { focus }) {
    this._pendingReveal = { at, focus };
    this.requestUpdate();
  }

  _reveal(area) {
    const { at, focus } = this._pendingReveal;
    this._pendingReveal = null;
    const caret = offsetAt(this._text, at);
    area.setSelectionRange(caret, caret);
    if (focus) area.focus({ preventScroll: true });
    const marker = this.shadowRoot.querySelector('.error-at');
    (marker ?? area).scrollIntoView({
      block: marker ? 'center' : 'nearest', inline: 'nearest', behavior: 'smooth',
    });
  }

  /** Shows `text` (the schema's, or a kept draft), reporting a problem in it right away. */
  _show(text) {
    clearTimeout(this._timer);
    const result = parseSchemaText(text);
    this._text = text;
    this._pending = result.error ? result : null;
    this._problem = this._pending;
    this.store.setJsonDraft({ text, problem: this._problem });
  }

  _onInput(event) {
    const text = event.target.value;
    const result = parseSchemaText(text);
    clearTimeout(this._timer);
    this._text = text;
    if (result.error) {
      this._pending = result;
      this._timer = setTimeout(() => this._report(), REPORT_DELAY);
    } else {
      this._pending = null;
      this._problem = null;
      this.store.dispatch(replaceSchema, { json: result.json });
      this._json = stringifySchema(this.store.model);
    }
    // A problem already reported stays until the new one is, after the pause.
    this.store.setJsonDraft({ text, problem: this._problem });
  }

  _report() {
    clearTimeout(this._timer);
    if (this._text === undefined) return;
    this._problem = this._pending;
    this.store.setJsonDraft({ text: this._text, problem: this._problem });
  }

  _onKeydown(event) {
    // ⌘S saves the text as it is: report its problem first, so the store blocks saving.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') this._report();
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const area = event.target;
    const edit = lineBreakAt(area.value, area.selectionStart, area.selectionEnd);
    area.setSelectionRange(edit.from, edit.to);
    typeText(area, edit.text);
    area.setSelectionRange(edit.caret, edit.caret);
  }

  _format() {
    const area = this._area;
    area.focus();
    area.select();
    typeText(area, this._json);
    area.setSelectionRange(0, 0);
  }

  /** One status element throughout, so assistive tech announces its changes. */
  _renderStatus() {
    const problem = this._problem;
    const at = problem?.line ? ` (line ${problem.line}, column ${problem.column})` : '';
    return html`
      <p id="json-status" class="status ${problem ? 'is-error' : 'muted'}" role="status">
        ${problem ? html`${icon('alert')}<span>${problem.error}${at}. Until it’s fixed, the schema
          keeps its last valid version.</span>` : 'Edits apply as you type.'}
      </p>
    `;
  }

  render() {
    if (this._text === undefined) return nothing;
    const lines = this._text.split('\n').length;
    const { line: errorLine, column = 1 } = this._problem ?? {};
    const canFormat = !this._pending && this._text !== this._json;
    return html`
      <div class="json-tools">
        ${this._renderStatus()}
        <button type="button" class="nx-action-btn" ?disabled=${!canFormat}
          title="Indent the JSON as it is saved" @click=${this._format}>Format</button>
        <button type="button" class="nx-action-btn-quiet nx-action-btn-icon"
          title="Copy JSON" aria-label="Copy JSON"
          @click=${() => copyText(this.store, this._text, 'Schema JSON')}>${icon('copy')}</button>
      </div>
      <div class="editor ${this._problem ? 'has-error' : ''}">
        <div class="gutter" aria-hidden="true">
          ${Array.from({ length: lines }, (_, i) => html`
            <span class=${i + 1 === errorLine ? 'is-error' : ''}>${i + 1}</span>`)}
        </div>
        <div class="code">
          <div class="layers">
            ${errorLine ? html`
              <div class="error-line" style="--line: ${errorLine}; --column: ${column}">
                <span class="error-at"></span>
              </div>` : nothing}
            <pre class="mirror" aria-hidden="true">${highlightJson(this._text)} </pre>
            <textarea aria-label="Schema JSON" aria-describedby="json-status"
              aria-invalid=${this._problem ? 'true' : 'false'} wrap="off" spellcheck="false"
              autocomplete="off" autocapitalize="off" autocorrect="off" translate="no"
              @input=${this._onInput} @keydown=${this._onKeydown} @focusout=${this._report}
              @scroll=${(e) => { e.target.scrollTop = 0; e.target.scrollLeft = 0; }}></textarea>
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get('se-schema-json')) customElements.define('se-schema-json', SeSchemaJson);
