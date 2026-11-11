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
// Properties' JSON tab: the selected element's JSON as saved, with a copy button per section.

import { html } from 'da-lit';
import { icon } from '../shared/icons.js';
import { copyText } from '../shared/actions.js';
import { jsonSections } from './json-sections.js';
import { jsonTokens } from './json-tokens.js';

const highlight = (json) => jsonTokens(json)
  .map(({ text, type }) => (type ? html`<span class="tok-${type}">${text}</span>` : text));

function renderSection(store, { title, what, json }) {
  return html`
    <section class="json-section" aria-label=${title}>
      <div class="json-head">
        <span class="hint">${title}</span>
        <button type="button" class="nx-action-btn-quiet nx-action-btn-icon" title="Copy ${what}"
          aria-label="Copy ${what}" @click=${() => copyText(store, json, what)}>${icon('copy')}</button>
      </div>
      <pre class="json" tabindex="0" aria-label=${what}><code>${highlight(json)}</code></pre>
    </section>
  `;
}

export function renderNodeJson({ store, model, node }) {
  return html`
    <div class="json-view">
      ${jsonSections(model, node).map((section) => renderSection(store, section))}
    </div>
  `;
}
