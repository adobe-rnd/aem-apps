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
/* eslint-disable no-underscore-dangle, import/no-unresolved */
import { html, LitElement, nothing } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { getColorScheme } from 'https://da.live/nx2/scripts/nx.js';
import { describeProblem } from '../utils/messages.js';
import { icon } from '../utils/icons.js';
import { listStyle } from '../shared/list/list.js';
import { inlineAlertStyle, renderInlineAlert } from '../shared/inline-alert/inline-alert.js';

const [buttonStyle, style] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

const EL_NAME = 'gql-sdl-panel';

// The GraphQL tab: a read-only CodeMirror view of `preview.sdl` with any generation problems.
// Without schemas it explains why, and its button emits `schemas-show`.
class SdlPanel extends LitElement {
  static properties = {
    preview: { attribute: false },
    hasSchemas: { type: Boolean },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttonStyle, listStyle, inlineAlertStyle, style];
  }

  get sdl() {
    return this.hasSchemas ? this.preview?.sdl ?? '' : '';
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unwatchScheme?.();
    this._editor?.destroy();
    this._editor = undefined;
  }

  async firstUpdated() {
    const cm = await import('https://da.live/nx/deps/codemirror/dist/index.js');
    const theme = new cm.Compartment();
    const getTheme = () => (getColorScheme() === 'dark-scheme' ? cm.oneDark : cm.githubLight);
    this._editor = new cm.EditorView({
      doc: this.sdl,
      extensions: [
        cm.basicSetup,
        cm.EditorView.editable.of(false),
        theme.of(getTheme()),
      ],
      parent: this.shadowRoot.querySelector('.sdl-editor'),
    });
    // The profile menu toggles the body class; the OS setting applies when none is stored.
    const onScheme = () => this._editor?.dispatch({ effects: theme.reconfigure(getTheme()) });
    const media = matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(onScheme);
    media.addEventListener('change', onScheme);
    observer.observe(document.body, { attributeFilter: ['class'] });
    this._unwatchScheme = () => {
      media.removeEventListener('change', onScheme);
      observer.disconnect();
    };
  }

  updated() {
    if (!this._editor) return;
    const doc = this.sdl;
    if (this._editor.state.doc.toString() === doc) return;
    this._editor.dispatch({ changes: { from: 0, to: this._editor.state.doc.length, insert: doc } });
  }

  renderEmpty() {
    return html`
      <div class="empty">
        ${icon({ name: 'code', className: 'empty-icon' })}
        <h2>No schemas selected</h2>
        <p>Select at least one Structured Content schema to generate the GraphQL schema.</p>
        <div class="empty-actions">
          <button type="button" class="nx-action-btn"
            @click=${() => this.dispatchEvent(new Event('schemas-show'))}>Select schemas</button>
        </div>
      </div>`;
  }

  renderProblems() {
    const errors = this.preview?.errors ?? [];
    if (!errors.length) return nothing;
    return renderInlineAlert({
      variant: 'negative',
      role: 'alert',
      heading: 'The GraphQL schema cannot be generated',
      content: html`<ul>${errors.map((error) => html`<li>${describeProblem(error)}</li>`)}</ul>`,
    });
  }

  // The editor's container is always rendered, so firstUpdated can mount CodeMirror into it.
  render() {
    return html`
      ${this.hasSchemas ? html`
        <p class="intro">A read-only preview of the GraphQL schema generated from the Structured
          Content schemas selected for this endpoint, including unsaved changes.</p>
        ${this.renderProblems()}` : this.renderEmpty()}
      <div class="sdl-editor" ?hidden=${!this.sdl}></div>
    `;
  }
}

customElements.define(EL_NAME, SdlPanel);
