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
import { html, LitElement } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { getColorScheme } from 'https://da.live/nx2/scripts/nx.js';

const style = await loadStyle(import.meta.url);

const EL_NAME = 'gql-sdl-panel';

class SdlPanel extends LitElement {
  static properties = {
    sdl: { type: String },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [style];
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
      doc: this.sdl ?? '',
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

  updated(props) {
    if (!props.has('sdl') || !this._editor) return;
    const doc = this.sdl ?? '';
    if (this._editor.state.doc.toString() === doc) return;
    this._editor.dispatch({ changes: { from: 0, to: this._editor.state.doc.length, insert: doc } });
  }

  render() {
    return html`
      <slot></slot>
      <div class="sdl-editor" ?hidden=${!this.sdl}></div>
    `;
  }
}

customElements.define(EL_NAME, SdlPanel);
