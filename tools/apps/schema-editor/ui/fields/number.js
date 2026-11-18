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
import { icon } from '../shared/icons.js';
import { SeField } from './field.js';

const style = await loadStyle(import.meta.url);

// Press-and-hold: a longer first pause, then fast repeats (like Spectrum's number field).
const HOLD_DELAY_MS = 400;
const HOLD_INTERVAL_MS = 60;
// Shift snaps by a larger increment, like Spectrum's stepModifier.
const SHIFT_FACTOR = 10;

// Spectrum 2 number field with stacked steppers; honors min/max/step.
class SeNumber extends SeField {
  static properties = {
    placeholder: { type: String },
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
  };

  static stylesheet = style;

  constructor() {
    super();
    this.step = 1;
    this._holdTimer = 0;
    this._holdInterval = 0;
  }

  disconnectedCallback() {
    this._stopHold();
    super.disconnectedCallback();
  }

  get _input() { return this.shadowRoot.querySelector('input'); }

  _hasMin() {
    return typeof this.min === 'number' && !Number.isNaN(this.min);
  }

  _hasMax() {
    return typeof this.max === 'number' && !Number.isNaN(this.max);
  }

  _clamp(num) {
    let next = num;
    if (this._hasMin()) next = Math.max(this.min, next);
    if (this._hasMax()) next = Math.min(this.max, next);
    return next;
  }

  _atMin() {
    return this._hasMin() && Number(this.value) <= this.min;
  }

  _atMax() {
    return this._hasMax() && Number(this.value) >= this.max;
  }

  _emit(type) {
    this.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  }

  _stepBy(dir, factor = 1) {
    if (this.disabled) return;
    const stepSize = (this.step || 1) * factor;
    const current = Number(this.value);
    // An empty/invalid value starts stepping from the min (or 0).
    const fallback = this._hasMin() ? this.min : 0;
    const base = Number.isNaN(current) ? fallback : current;
    // toPrecision avoids float dust (e.g. 0.1 + 0.2) accumulating across steps.
    const next = Number(this._clamp(base + dir * stepSize).toPrecision(15));
    this.value = String(next);
    this._emit('input');
  }

  _onKeydown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    this._stepBy(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? SHIFT_FACTOR : 1);
    this._emit('change');
  }

  _onWheel(e) {
    // Only while focused, so the wheel doesn't hijack page scroll on hover.
    if (this.shadowRoot.activeElement !== this._input) return;
    e.preventDefault();
    this._stepBy(e.deltaY < 0 ? 1 : -1, e.shiftKey ? SHIFT_FACTOR : 1);
    this._emit('change');
  }

  _onStepPointerdown(e, dir) {
    if (e.button !== 0 || this.disabled) return;
    e.preventDefault(); // keep focus on the input
    // Capture so a held pointer drifting off keeps repeating; throws for an inactive pointer.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no-op */ }
    this._input?.focus();
    const factor = e.shiftKey ? SHIFT_FACTOR : 1;
    this._stepBy(dir, factor);
    this._holdTimer = setTimeout(() => {
      this._holdInterval = setInterval(() => this._stepBy(dir, factor), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }

  _onStepPointerup() {
    this._stopHold();
    this._emit('change');
  }

  _stopHold() {
    clearTimeout(this._holdTimer);
    clearInterval(this._holdInterval);
    this._holdTimer = 0;
    this._holdInterval = 0;
  }

  render() {
    return this.renderField(html`
      <div class="form-number-wrap">
        <input
          id="control"
          type="number"
          inputmode="numeric"
          .value=${this.value ?? ''}
          placeholder=${this.placeholder ?? nothing}
          min=${this._hasMin() ? this.min : nothing}
          max=${this._hasMax() ? this.max : nothing}
          step=${this.step ?? nothing}
          ?disabled=${this.disabled}
          @input=${this.relay}
          @change=${this.relay}
          @keydown=${this._onKeydown}
          @wheel=${this._onWheel}
        />
        ${this.renderAlert()}
        <span class="form-number-buttons" aria-hidden="true">
          <button
            type="button"
            class="form-number-step form-number-step-up"
            tabindex="-1"
            ?disabled=${this.disabled || this._atMax()}
            @pointerdown=${(e) => this._onStepPointerdown(e, 1)}
            @pointerup=${this._onStepPointerup}
            @pointercancel=${this._onStepPointerup}
          >${icon('chevronUp', 'form-number-chevron')}</button>
          <button
            type="button"
            class="form-number-step form-number-step-down"
            tabindex="-1"
            ?disabled=${this.disabled || this._atMin()}
            @pointerdown=${(e) => this._onStepPointerdown(e, -1)}
            @pointerup=${this._onStepPointerup}
            @pointercancel=${this._onStepPointerup}
          >${icon('chevronDown', 'form-number-chevron')}</button>
        </span>
      </div>
    `);
  }
}

if (!customElements.get('se-number')) customElements.define('se-number', SeNumber);
