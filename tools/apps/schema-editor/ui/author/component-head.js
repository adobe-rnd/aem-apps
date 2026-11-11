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
import { LitElement, html } from 'da-lit';
import { icon } from '../shared/icons.js';
import { refUsages } from '../../core/model/query.js';
import { newComponent } from '../shared/actions.js';
import { usageLabel } from '../shared/format.js';
import { buttons, shared, loadStyle } from '../shared/styles.js';

await import('https://da.live/nx2/blocks/shared/picker/picker.js');

const style = await loadStyle(import.meta.url);

/**
 * `<se-component-head>`: the Components page's head row. The picker lists names only (the top
 * card shows usage); New component, the page's primary action, is kept out of the picker.
 */
class SeComponentHead extends LitElement {
  static properties = {
    store: { attribute: false },
    model: { attribute: false },
    componentId: { type: String },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
  }

  _renderPicker() {
    const items = this.model.defs.map((def) => ({
      value: def.id,
      label: def.name,
      ariaLabel: `${def.name}, ${usageLabel(refUsages(this.model, def.id).length)}`,
    }));
    return html`
      <div class="component-picker" role="group" aria-label="Component">
        <nx-picker variant="field" size="m" check-position="start" placement="below-start"
          placeholder="Choose a component" .items=${items} .value=${this.componentId ?? ''}
          @change=${(e) => this.store.revealDef(e.detail.value)}></nx-picker>
      </div>
    `;
  }

  render() {
    return html`
      ${this._renderPicker()}
      <button type="button" class="nx-btn-accent new-component" title="New component"
        @click=${() => newComponent(this.store)}>
        ${icon('add')}<span class="new-component-label">New component</span></button>
    `;
  }
}

if (!customElements.get('se-component-head')) {
  customElements.define('se-component-head', SeComponentHead);
}
