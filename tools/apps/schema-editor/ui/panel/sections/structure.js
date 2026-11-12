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
// Group fields and List item sections. Rows select the child so the inspector drills down.

import { html, nothing } from 'da-lit';
import { updateNode } from '../../../core/model/commands.js';
import { labelOf } from '../../../core/model/query.js';
import { icon } from '../../shared/icons.js';
import { kindLabel, nodeIcon } from '../../author/card-info.js';
import { makeReusable } from '../../shared/actions.js';
import { paletteMenuItems, parseMenuId, insertPaletteItem } from '../../shared/palette.js';
import { section, numberField } from './controls.js';

await import('https://da.live/nx2/blocks/shared/menu/menu.js');

function addMenu(ctx, label, target) {
  return html`
    <nx-menu placement="below-start" .items=${paletteMenuItems(ctx.model, ctx.node.id)}
      @select=${(e) => insertPaletteItem(ctx.store, parseMenuId(e.detail.id), target)}>
      <button slot="trigger" type="button" class="nx-action-btn nx-btn-sm">
        ${icon('add')} ${label}</button>
    </nx-menu>
  `;
}

function nodeRow(ctx, child, extra = nothing) {
  const label = labelOf(ctx.model, child) || 'Untitled';
  return html`
    <li class="node-row">
      <button type="button" class="node-row-main" @click=${() => ctx.store.select(child.id, { reveal: true })}
        aria-label="Edit ${label}">
        <span class="node-icon ${child.kind === 'ref' ? 'is-ref' : ''}">${icon(nodeIcon(child))}</span>
        <span class="node-row-text">
          <span class="node-row-label">${label}</span>
          <span class="node-row-meta">
            ${kindLabel(ctx.model, child)}${child.key ? ` · ${child.key}` : nothing}
          </span>
        </span>
        ${icon('chevronRight', 'icon chevron')}
      </button>
      ${extra}
    </li>
  `;
}

function requiredToggle(ctx, child) {
  const label = labelOf(ctx.model, child) || 'field';
  return html`
    <label class="required-toggle" title="Required">
      <input type="checkbox" .checked=${!!child.required} aria-label="${label} is required"
        @change=${(e) => ctx.dispatch(updateNode, {
    nodeId: child.id,
    patch: { required: e.target.checked || undefined },
  })}>
      <span>Req.</span>
    </label>
  `;
}

export function fields(ctx) {
  const { node, entry } = ctx;
  const children = node.children ?? [];
  const canReuse = !!entry.parent;
  return section('fields', `Fields (${children.length})`, html`
    ${children.length ? html`
      <ul class="list">${children.map((child) => nodeRow(ctx, child, requiredToggle(ctx, child)))}</ul>
    ` : html`<p class="hint">No fields yet. Add one here, or drag one in from Elements.</p>`}
    ${ctx.error('required') ? html`<p class="error-text">${ctx.error('required')}</p>` : nothing}
    <div class="row-actions">
      ${addMenu(ctx, 'Add field', { parentId: node.id, index: children.length })}
      ${canReuse ? html`
        <button type="button" class="nx-action-btn-quiet nx-btn-sm"
          @click=${() => makeReusable(ctx.store, node.id)}>
          ${icon('component')} Make reusable</button>` : nothing}
    </div>
  `);
}

export function items(ctx) {
  const { node, entry } = ctx;
  const target = { parentId: node.id };
  return section('items', 'List item', html`
    ${node.item
    ? html`<ul class="list">${nodeRow(ctx, node.item)}</ul>`
    : html`<p class="hint">Choose what each entry of the list is.</p>`}
    ${ctx.error('item') ? html`<p class="error-text">${ctx.error('item')}</p>` : nothing}
    <div class="row-actions">
      ${addMenu(ctx, node.item ? 'Change item' : 'Choose item', target)}
      ${entry.parent ? html`
        <button type="button" class="nx-action-btn-quiet nx-btn-sm"
          @click=${() => makeReusable(ctx.store, node.id)}>
          ${icon('component')} Make reusable</button>` : nothing}
    </div>
    <div class="pair">
      ${numberField(ctx, 'minItems', 'Min entries', { min: 0, step: 1 })}
      ${numberField(ctx, 'maxItems', 'Max entries', { min: 0, step: 1 })}
    </div>
  `);
}
