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
// Default value section: a control matching the element.

import { html } from 'da-lit';
import {
  section, picker, dateField, toNumber,
} from './controls.js';

const DATE_TYPES = { date: 'date', time: 'time', 'date-time': 'datetime' };
const BOOLEAN_VALUES = { '': undefined, true: true, false: false };

function control(ctx) {
  const { node } = ctx;
  const value = node.default;
  const error = ctx.error('default');
  const set = (next) => ctx.update({ default: next });

  if (node.kind === 'boolean') {
    return picker(ctx, {
      id: 'default',
      label: 'Default value',
      value: value === undefined ? '' : String(value),
      options: [
        { value: '', label: 'No default' },
        { value: 'true', label: 'On' },
        { value: 'false', label: 'Off' },
      ],
      error,
      onChange: (v) => set(BOOLEAN_VALUES[v]),
    });
  }
  if (node.kind === 'number' || node.kind === 'integer') {
    return html`
      <se-number label="Default value" placeholder="No default"
        .value=${value === undefined ? '' : String(value)}
        .step=${node.kind === 'integer' ? 1 : undefined}
        .error=${error}
        @input=${(e) => set(toNumber(e.target.value))}></se-number>
    `;
  }
  if (node.variant === 'choice') {
    return picker(ctx, {
      id: 'default',
      label: 'Default value',
      value: value ?? '',
      options: [
        { value: '', label: 'No default' },
        ...(node.enum ?? []).map((choice) => ({ value: choice, label: choice })),
      ],
      error,
      onChange: (v) => set(v === '' ? undefined : v),
    });
  }
  if (DATE_TYPES[node.variant]) {
    return dateField(ctx, {
      label: 'Default value',
      type: DATE_TYPES[node.variant],
      value,
      error,
      onInput: (v) => set(v || undefined),
    });
  }
  const onInput = (e) => set(e.target.value === '' ? undefined : e.target.value);
  return node.variant === 'long-text'
    ? html`<se-textarea label="Default value" .value=${value ?? ''} .error=${error}
        @input=${onInput}></se-textarea>`
    : html`<se-input label="Default value" .value=${value ?? ''} placeholder="No default"
        .error=${error} @input=${onInput}></se-input>`;
}

export function defaultValue(ctx) {
  return section('default', 'Default', control(ctx));
}
