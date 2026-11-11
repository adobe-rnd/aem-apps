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
// Field builders shared by the inspector sections. Each writes edits straight to the store;
// history coalesces repeated edits of a field into one undo step.

import { html, nothing } from 'da-lit';
import '../../fields/input.js';
import '../../fields/textarea.js';
import '../../fields/number.js';
import '../../fields/picker.js';
import '../../fields/checkbox.js';
import '../../fields/date.js';

const blankToUndefined = (value) => (value === '' ? undefined : value);

/** Blank clears a number field; text that isn't a finite number is kept as typed. */
export function toNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

export function textField(ctx, field, label, opts = {}) {
  const { node } = ctx;
  return html`
    <se-input label=${label} .value=${node[field] ?? ''}
      placeholder=${opts.placeholder ?? nothing}
      description=${opts.description ?? nothing}
      ?required=${!!opts.required}
      .error=${ctx.error(field)}
      @input=${(e) => ctx.update({ [field]: (opts.parse ?? blankToUndefined)(e.target.value) })}>
    </se-input>
  `;
}

export function textareaField(ctx, field, label, opts = {}) {
  return html`
    <se-textarea label=${label} .value=${ctx.node[field] ?? ''}
      description=${opts.description ?? nothing}
      .error=${ctx.error(field)}
      @input=${(e) => ctx.update({ [field]: blankToUndefined(e.target.value) })}>
    </se-textarea>
  `;
}

export function numberField(ctx, field, label, opts = {}) {
  const value = ctx.node[field];
  return html`
    <se-number label=${label} .value=${value === undefined ? '' : String(value)}
      .min=${opts.min} .step=${opts.step}
      placeholder=${opts.placeholder ?? 'None'}
      .error=${ctx.error(field)}
      @input=${(e) => ctx.update({ [field]: toNumber(e.target.value) })}>
    </se-number>
  `;
}

/** An on/off switch; off removes `field`. */
export function switchField(ctx, field, label, opts = {}) {
  return html`
    <se-checkbox .checked=${!!ctx.node[field]}
      description=${opts.description ?? nothing}
      .error=${ctx.error(field)}
      @change=${(e) => ctx.update({ [field]: e.target.checked || undefined })}>${label}</se-checkbox>
  `;
}

/** A select that always shows `value`; `ctx.view.bump(id)` re-syncs it after a cancelled change. */
export function picker(ctx, {
  id, label, options, value, onChange, description, error,
}) {
  const syncKey = ctx.view.get(`picker:${id}`) ?? 0;
  return html`
    <se-picker label=${label} .value=${value} .options=${options} .syncKey=${syncKey}
      description=${description ?? nothing} .error=${error ?? ''}
      @change=${(e) => onChange(e.detail.value)}></se-picker>
  `;
}

export function dateField(ctx, {
  label, type, value, onInput, error,
}) {
  return html`
    <se-date label=${label} type=${type} .value=${value ?? ''} .error=${error ?? ''}
      @input=${(e) => onInput(e.currentTarget.value)}></se-date>
  `;
}

export function section(id, title, body) {
  return html`
    <section class="section" aria-labelledby="sec-${id}">
      <h3 class="eyebrow" id="sec-${id}">${title}</h3>
      ${body}
    </section>
  `;
}
