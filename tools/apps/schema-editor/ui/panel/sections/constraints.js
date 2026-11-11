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
// Length, Pattern and Range sections. Inconsistent values are applied and flagged, never rejected.

import { html, nothing } from 'da-lit';
import { testPattern } from '../../../core/model/lint.js';
import { icon } from '../../shared/icons.js';
import { section, numberField, textField } from './controls.js';

await import('https://da.live/nx2/blocks/shared/menu/menu.js');

const PATTERN_PRESETS = Object.freeze([
  { id: 'slug', label: 'Slug (lowercase-with-dashes)', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
  { id: 'url', label: 'Web address (http/https)', pattern: '^https?://' },
  { id: 'email', label: 'Email address', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
  { id: 'digits', label: 'Digits only', pattern: '^[0-9]+$' },
]);

export function length(ctx) {
  return section('length', 'Length', html`
    <div class="pair">
      ${numberField(ctx, 'minLength', 'Min characters', { min: 0, step: 1 })}
      ${numberField(ctx, 'maxLength', 'Max characters', { min: 0, step: 1 })}
    </div>
  `);
}

export function range(ctx) {
  const step = ctx.node.kind === 'integer' ? 1 : undefined;
  return section('range', 'Range', html`
    <div class="pair">
      ${numberField(ctx, 'minimum', 'Minimum', { step })}
      ${numberField(ctx, 'maximum', 'Maximum', { step })}
    </div>
  `);
}

export function pattern(ctx) {
  const sample = ctx.view.get('patternSample') ?? '';
  const result = testPattern(ctx.node.pattern, sample);
  const presets = PATTERN_PRESETS.map(({ id, label }) => ({ id, label }));
  const applyPreset = (id) => {
    const preset = PATTERN_PRESETS.find((p) => p.id === id);
    if (preset) ctx.update({ pattern: preset.pattern });
  };
  return section('pattern', 'Pattern', html`
    ${textField(ctx, 'pattern', 'Regular expression', {
    placeholder: 'e.g. ^[a-z0-9-]+$',
    description: 'Values must match it. Leave empty to accept any text.',
  })}
    <div class="row-actions">
      <nx-menu placement="below-start" .items=${presets} @select=${(e) => applyPreset(e.detail.id)}>
        <button slot="trigger" type="button" class="nx-action-btn nx-btn-sm">
          Presets ${icon('chevronDown')}</button>
      </nx-menu>
    </div>
    ${ctx.node.pattern ? html`
      <se-input label="Try it" .value=${sample} placeholder="Sample value"
        @input=${(e) => ctx.view.set('patternSample', e.target.value)}></se-input>
      <p class="tester is-${result.state}" aria-live="polite">${result.message}</p>
    ` : nothing}
  `);
}
