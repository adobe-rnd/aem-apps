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
// The Choice element's list of values. The list rules are in core/model/choices.js.

import { html, nothing } from 'da-lit';
import { icon } from '../../shared/icons.js';
import { modKey } from '../../shared/format.js';
import {
  nextChoice, parseChoices, moveChoice, renameChoice,
} from '../../../core/model/choices.js';
import { section } from './controls.js';

function remove(ctx, index) {
  const { node } = ctx;
  const removed = node.enum[index];
  ctx.update({ enum: node.enum.filter((_, i) => i !== index) });
  if (node.default === removed) {
    ctx.store.bus.toastRequest.emit({ message: `"${removed}" was the default; the default is cleared.` });
  }
}

function move(ctx, from, to) {
  const list = moveChoice(ctx.node.enum, from, to);
  if (list === ctx.node.enum) return;
  ctx.update({ enum: list });
  ctx.view.set('focusChoice', to);
}

function onRowKey(ctx, event, index) {
  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  move(ctx, index, index + (event.key === 'ArrowUp' ? -1 : 1));
}

// Native drag, like the canvas rows. The view keeps `{ from, gap }`: `gap` is the row index the
// drop line sits above (the list length below the last row), or null where a drop wouldn't move.
const DRAG_TYPE = 'application/x-se-choice';

function onDragStart(ctx, event, index) {
  const row = event.currentTarget.closest('.choice');
  const { left, top } = row.getBoundingClientRect();
  event.dataTransfer.setData(DRAG_TYPE, String(index));
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setDragImage(row, event.clientX - left, event.clientY - top);
  // Dim the row only after the browser has taken the drag image from it.
  setTimeout(() => ctx.view.set('choiceDrag', { from: index, gap: null }));
}

function setGap(ctx, gap) {
  const drag = ctx.view.get('choiceDrag');
  if (drag && drag.gap !== gap) ctx.view.set('choiceDrag', { ...drag, gap });
}

function onDragOver(ctx, event) {
  const drag = ctx.view.get('choiceDrag');
  if (!drag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rows = [...event.currentTarget.children];
  const below = rows.findIndex((row) => {
    const { top, height } = row.getBoundingClientRect();
    return event.clientY < top + height / 2;
  });
  const gap = below === -1 ? rows.length : below;
  setGap(ctx, gap === drag.from || gap === drag.from + 1 ? null : gap);
}

function onDragLeave(ctx, event) {
  if (!event.currentTarget.contains(event.relatedTarget)) setGap(ctx, null);
}

function onDrop(ctx, event) {
  const drag = ctx.view.get('choiceDrag');
  if (!drag) return;
  event.preventDefault();
  ctx.view.set('choiceDrag', null);
  if (drag.gap !== null) move(ctx, drag.from, drag.gap > drag.from ? drag.gap - 1 : drag.gap);
}

function onDragEnd(ctx) {
  if (ctx.view.get('choiceDrag')) ctx.view.set('choiceDrag', null);
}

function rowClass(drag, index, count) {
  return [
    'choice',
    drag?.from === index ? 'is-drag-source' : '',
    drag?.gap === index ? 'is-drop-before' : '',
    drag?.gap === count && index === count - 1 ? 'is-drop-after' : '',
  ].filter(Boolean).join(' ');
}

function applyPaste(ctx, text, replace) {
  const pasted = parseChoices(text);
  if (!pasted.length) return;
  const current = replace ? [] : ctx.node.enum ?? [];
  ctx.update({ enum: [...new Set([...current, ...pasted])] });
  ctx.view.set('pasting', false);
}

function renderPaste(ctx) {
  const draft = ctx.view.get('pasteDraft') ?? '';
  return html`
    <div class="paste">
      <se-textarea label="Paste choices" description="One choice per line."
        .value=${draft} @input=${(e) => ctx.view.set('pasteDraft', e.target.value)}></se-textarea>
      <div class="row-actions">
        <button type="button" class="nx-btn-primary nx-btn-sm"
          ?disabled=${!parseChoices(draft).length}
          @click=${() => applyPaste(ctx, draft, false)}>Add</button>
        <button type="button" class="nx-action-btn nx-btn-sm"
          ?disabled=${!parseChoices(draft).length}
          @click=${() => applyPaste(ctx, draft, true)}>Replace all</button>
        <button type="button" class="nx-action-btn-quiet nx-btn-sm"
          @click=${() => ctx.view.set('pasting', false)}>Cancel</button>
      </div>
    </div>
  `;
}

export function choices(ctx) {
  const list = ctx.node.enum ?? [];
  const drag = ctx.view.get('choiceDrag');
  return section('choices', 'Choices', html`
    <ol class="choices" aria-describedby="choices-hint" @dragover=${(e) => onDragOver(ctx, e)}
      @dragleave=${(e) => onDragLeave(ctx, e)} @drop=${(e) => onDrop(ctx, e)}>
      ${list.map((choice, index) => html`
        <li class=${rowClass(drag, index, list.length)} @keydown=${(e) => onRowKey(ctx, e, index)}>
          <span class="choice-grip" draggable="true" title="Drag to reorder" aria-hidden="true"
            @dragstart=${(e) => onDragStart(ctx, e, index)}
            @dragend=${() => onDragEnd(ctx)}>${icon('drag')}</span>
          <input class="choice-input" aria-label="Choice ${index + 1}" .value=${choice}
            data-choice-index=${index}
            @input=${(e) => ctx.update(renameChoice(ctx.node, index, e.target.value))}>
          ${ctx.node.default === choice ? html`<span class="chip">Default</span>` : nothing}
          <button type="button" class="nx-action-btn-quiet nx-action-btn-icon"
            aria-label="Remove ${choice}" title="Remove"
            @click=${() => remove(ctx, index)}>${icon('close')}</button>
        </li>
      `)}
    </ol>
    ${ctx.error('enum') ? html`<p class="error-text">${ctx.error('enum')}</p>` : nothing}
    <p class="hint" id="choices-hint">Drag or Alt+↑ / Alt+↓ reorders. ${modKey()}Z undoes.</p>
    ${ctx.view.get('pasting') ? renderPaste(ctx) : html`
      <div class="row-actions">
        <button type="button" class="nx-action-btn nx-btn-sm"
          @click=${() => ctx.update({ enum: [...list, nextChoice(list)] })}>
          ${icon('add')} Add choice</button>
        <button type="button" class="nx-action-btn-quiet nx-btn-sm"
          @click=${() => ctx.view.set('pasting', true)}>Paste list…</button>
      </div>
    `}
  `);
}
