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
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { SeField } from './field.js';

const style = await loadStyle(import.meta.url);

class SeTextarea extends SeField {
  static properties = {
    placeholder: { type: String },
  };

  static stylesheet = style;

  render() {
    return this.renderField(html`
      <div class="form-control-wrap">
        <textarea
          id="control"
          class="form-control"
          .value=${this.value ?? ''}
          placeholder=${this.placeholder ?? nothing}
          ?disabled=${this.disabled}
          @input=${this.relay}
          @change=${this.relay}
        ></textarea>
        ${this.renderAlert()}
      </div>
    `);
  }
}

if (!customElements.get('se-textarea')) customElements.define('se-textarea', SeTextarea);
