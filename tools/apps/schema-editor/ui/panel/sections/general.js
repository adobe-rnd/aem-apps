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
// General and Behavior sections: the settings every element shares.

import { html, nothing } from 'da-lit';
import { ELEMENTS, elementOf } from '../../../core/model/elements.js';
import { changeElement } from '../../../core/model/commands.js';
import { labelOf } from '../../../core/model/query.js';
import { icon } from '../../shared/icons.js';
import { confirmDialog } from '../../shared/confirm.js';
import { isGroupField } from '../inspector.js';
import {
  section, textField, textareaField, switchField, picker,
} from './controls.js';

const CONTAINER_ELEMENTS = ['group', 'list'];

/** Elements the node may switch to: Group/List for the root, anything otherwise. */
function elementChoices(entry) {
  const top = !entry.parent && !entry.def;
  return Object.values(ELEMENTS)
    .filter((el) => !top || CONTAINER_ELEMENTS.includes(el.id))
    .map((el) => ({ value: el.id, label: el.label }));
}

async function onElementChange(ctx, element) {
  const current = ELEMENTS[elementOf(ctx.node)];
  const next = ELEMENTS[element];
  if (!next || next.id === current?.id) return;
  if (next.class !== current?.class) {
    const confirmed = await confirmDialog({
      title: `Change to ${next.label}?`,
      message: `"${labelOf(ctx.model, ctx.node)}" becomes a ${next.label}. `
        + 'Settings that don\'t apply to it are removed.',
      confirmLabel: 'Change',
    });
    if (!confirmed) {
      ctx.view.bump('element');
      return;
    }
  }
  ctx.dispatch(changeElement, { nodeId: ctx.node.id, element });
}

async function unlockKey(ctx) {
  const confirmed = await confirmDialog({
    title: 'Edit key?',
    message: `Documents store data under "${ctx.node.key}". `
      + 'Renaming the key orphans existing values.',
    confirmLabel: 'Edit key',
    destructive: true,
  });
  if (confirmed) ctx.view.set('keyUnlocked', true);
}

function keyHint(node) {
  if (node.keyLocked) return 'Saved documents use this key.';
  if (!node.keyManual) return 'Follows the label.';
  return 'Set manually.';
}

function keyField(ctx) {
  const { node } = ctx;
  const locked = node.keyLocked && !ctx.view.get('keyUnlocked');
  const followLabel = () => ctx.update({ keyManual: undefined, title: node.title });
  return html`
    <div class="key-field">
      <se-input label="Key" .value=${node.key ?? ''} required
        ?disabled=${locked}
        description=${keyHint(node)}
        .error=${ctx.error('key')}
        @input=${(e) => ctx.update({ key: e.target.value })}></se-input>
      ${locked ? html`
        <button type="button" class="nx-action-btn-quiet nx-action-btn-icon key-btn"
          title="Edit key" aria-label="Edit key"
          @click=${() => unlockKey(ctx)}>${icon('lock')}</button>` : nothing}
      ${node.keyManual && !node.keyLocked ? html`
        <button type="button" class="nx-action-btn-quiet nx-btn-sm key-btn"
          @click=${followLabel}>Follow label</button>` : nothing}
    </div>
  `;
}

function elementPicker(ctx) {
  const value = elementOf(ctx.node);
  if (!value) return nothing;
  return picker(ctx, {
    id: 'element',
    label: 'Element',
    options: elementChoices(ctx.entry),
    value,
    onChange: (element) => onElementChange(ctx, element),
  });
}

export function general(ctx) {
  const { node, model, entry } = ctx;
  const isRef = node.kind === 'ref';
  const placeholder = isRef ? labelOf(model, { ...node, title: '' }) : undefined;
  return section('general', 'General', html`
    ${textField(ctx, 'title', 'Label', {
    placeholder,
    description: isRef ? 'Leave empty to use the component\'s label.' : undefined,
  })}
    ${isGroupField(entry) ? keyField(ctx) : nothing}
    ${textareaField(ctx, 'description', 'Help text', { description: 'Shown below the field in the form.' })}
    ${isRef ? nothing : elementPicker(ctx)}
  `);
}

export function behavior(ctx) {
  const inGroup = isGroupField(ctx.entry);
  return section('behavior', 'Behavior', html`
    ${inGroup
    ? switchField(ctx, 'required', 'Required', { description: 'Authors must fill it in.' })
    : html`<p class="hint">List items are required by the list itself.</p>`}
    ${switchField(ctx, 'readOnly', 'Read-only', { description: 'Shown, but authors can\'t change it.' })}
  `);
}
