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
import { SeField } from './field.js';
import { localToUtc, utcToLocal } from './datetime-zone.js';

const NATIVE_TYPE = { date: 'date', time: 'time', datetime: 'datetime-local' };

// Cap the year to 4 digits; native inputs otherwise allow up to 6.
const RANGE = {
  date: { min: '0001-01-01', max: '9999-12-31' },
  datetime: { min: '0001-01-01T00:00', max: '9999-12-31T23:59' },
};

class SeDate extends SeField {
  static properties = {
    type: { type: String },
  };

  constructor() {
    super();
    this.type = 'date';
    this._lastValue = undefined;
  }

  get _input() { return this.shadowRoot.querySelector('input'); }

  // Skip values we emitted so a re-render can't wipe an in-progress entry.
  updated(changed) {
    if (changed.has('value') && this.value !== this._lastValue) {
      this._lastValue = this.value;
      if (this._input) {
        this._input.value = this.type === 'datetime'
          ? utcToLocal(this.value)
          : (this.value ?? '');
      }
    }
  }

  _onInput(e) {
    const raw = e.target.value;
    const next = this.type === 'datetime' ? localToUtc(raw) : raw;
    this._lastValue = next;
    this.value = next;
  }

  render() {
    return this.renderField(html`
      <input
        id="control"
        class="form-control"
        type=${NATIVE_TYPE[this.type] ?? 'date'}
        min=${RANGE[this.type]?.min ?? nothing}
        max=${RANGE[this.type]?.max ?? nothing}
        ?disabled=${this.disabled}
        @input=${this._onInput}
      />
    `);
  }
}

if (!customElements.get('se-date')) customElements.define('se-date', SeDate);
