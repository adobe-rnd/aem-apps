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
import { buttons, shared, loadStyle } from '../shared/styles.js';
import { deriveSchemaName } from '../../core/model/keys.js';
import { checkNewName, parseImport } from '../../core/catalog.js';
import '../fields/input.js';
import '../fields/textarea.js';

await import('https://da.live/nx2/blocks/shared/dialog/dialog.js');

const style = await loadStyle(import.meta.url);

const JSON_PLACEHOLDER = `{
  "type": "object",
  "properties": {
    "title": { "type": "string" }
  }
}`;

/** Asks for a new schema's title / name (and JSON for imports); open it via `schemaDialog()`. */
class SeDialog extends LitElement {
  static properties = {
    heading: { type: String },
    confirmLabel: { type: String },
    withTitle: { type: Boolean },
    withJson: { type: Boolean },
    existingNames: { attribute: false },
    initialTitle: { type: String },
    initialName: { type: String },
    _title: { state: true },
    _name: { state: true },
    _json: { state: true },
    _nameEdited: { state: true },
    _submitted: { state: true },
    _busy: { state: true },
    _error: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
    this._title = this.initialTitle ?? '';
    this._name = this.initialName
      ?? deriveSchemaName(this._title || 'untitled', this.existingNames ?? []);
  }

  get _nameError() {
    return checkNewName(this._name ?? '', this.existingNames ?? []);
  }

  get _jsonResult() {
    if (!this.withJson) return {};
    if (!this._json?.trim()) return { error: 'Paste the JSON Schema to start from.' };
    return parseImport(this._json);
  }

  _setTitle(title) {
    this._title = title;
    if (!this._nameEdited) this._name = deriveSchemaName(title, this.existingNames ?? []);
  }

  _onJson(text) {
    this._json = text;
    const { json } = parseImport(text);
    if (json?.title && !this._title) this._setTitle(String(json.title));
  }

  resolve(value) {
    if (this._resolved) return;
    this._resolved = true;
    this.onResolve?.(value);
    this.shadowRoot.querySelector('nx-dialog')?.close();
    this.remove();
  }

  async _submit(event) {
    event.preventDefault();
    if (this._busy) return;
    this._submitted = true;
    const { json, error: jsonError } = this._jsonResult;
    if (this._nameError || jsonError) return;

    this._busy = true;
    this._error = '';
    const result = await this.onSubmit({ title: this._title?.trim(), name: this._name, json });
    this._busy = false;
    if (result?.ok) this.resolve(true);
    else this._error = result?.error ?? 'Something went wrong.';
  }

  render() {
    const showErrors = this._submitted || this._nameEdited;
    const jsonError = this._submitted ? this._jsonResult.error : '';
    return html`
      <nx-dialog class=${this.withJson ? 'is-wide' : nothing} title=${this.heading}
        ?busy=${this._busy} @close=${() => this.resolve(false)}>
        <form id="schema-form" @submit=${this._submit} novalidate>
          ${this.withJson ? html`
            <se-textarea class="json" label="JSON Schema" required
              description="The schema definition (type, properties, …), not sample content."
              placeholder=${JSON_PLACEHOLDER}
              .value=${this._json ?? ''} .error=${jsonError || ''}
              @input=${(e) => this._onJson(e.target.value)}></se-textarea>
          ` : nothing}
          ${this.withTitle ? html`
            <se-input label="Title" ?autofocus=${!this.withJson}
              description="Shown to authors in the form editor."
              .value=${this._title ?? ''}
              @input=${(e) => this._setTitle(e.target.value)}></se-input>
          ` : nothing}
          <se-input label="Name" required ?autofocus=${!this.withTitle}
            description="The file name documents reference. Can't be changed later."
            .value=${this._name ?? ''} .error=${showErrors ? this._nameError ?? '' : ''}
            @input=${(e) => { this._name = e.target.value.trim(); this._nameEdited = true; }}></se-input>
          ${this._error ? html`<p class="error-text" role="alert">${this._error}</p>` : nothing}
        </form>
        <button type="button" slot="actions" class="nx-action-btn"
          ?disabled=${this._busy} @click=${() => this.resolve(false)}>Cancel</button>
        <button type="submit" slot="actions" form="schema-form" class="nx-btn-accent"
          ?disabled=${this._busy} @click=${this._submit}>
          ${this._busy ? 'Creating…' : this.confirmLabel}
        </button>
      </nx-dialog>
    `;
  }
}

if (!customElements.get('se-dialog')) customElements.define('se-dialog', SeDialog);

/**
 * `onSubmit({ title?, name, json? })` performs the operation and resolves `{ ok, error? }`; on
 * failure the dialog stays open showing the error. Resolves whether the operation succeeded.
 */
export function schemaDialog({
  title,
  confirmLabel,
  existingNames,
  onSubmit,
  withTitle = true,
  withJson = false,
  initialTitle = '',
  initialName,
}) {
  return new Promise((resolve) => {
    const el = document.createElement('se-dialog');
    Object.assign(el, {
      heading: title,
      confirmLabel,
      existingNames,
      onSubmit,
      withTitle,
      withJson,
      initialTitle,
      initialName,
      onResolve: resolve,
    });
    document.body.append(el);
  });
}
