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
// Component sections: a component use (reference), the component head and the root head.

import { html, nothing } from 'da-lit';
import { detachRef, renameDef } from '../../../core/model/commands.js';
import {
  breadcrumb, getDef, refUsages, wouldCreateCycle,
} from '../../../core/model/query.js';
import { validateDefName } from '../../../core/model/keys.js';
import { icon } from '../../shared/icons.js';
import { usedTimes } from '../../shared/format.js';
import { copyText, deleteComponent, editComponent } from '../../shared/actions.js';
import { section, picker } from './controls.js';

/** Components a reference may point at without making a component contain itself. */
function componentChoices(model, entry) {
  const parentId = entry.parent?.id;
  return model.defs
    .filter((def) => def.id === entry.node.refDefId || !parentId
      || !wouldCreateCycle(model, parentId, { kind: 'ref', refDefId: def.id }))
    .map((def) => ({ value: def.id, label: def.name }));
}

export function reference(ctx) {
  const { model, node, entry } = ctx;
  const def = getDef(model, node.refDefId);
  const used = def ? refUsages(model, def.id).length : 0;
  return section('reference', 'Component', html`
    ${def ? nothing : html`
      <p class="notice is-error">${icon('alert')}
        <span>This component no longer exists. Pick another one or delete the field.</span></p>`}
    ${picker(ctx, {
    id: 'ref',
    label: 'Uses component',
    value: def ? def.id : '',
    options: componentChoices(model, entry),
    description: def ? `Used ${usedTimes(used)} in this schema.` : undefined,
    onChange: (refDefId) => ctx.update({ refDefId }),
  })}
    <p class="hint">Its fields show here read-only. Edit the component to change them everywhere it is used.</p>
    <div class="row-actions">
      ${def ? html`
        <button type="button" class="nx-action-btn nx-btn-sm"
          @click=${() => editComponent(ctx.store, { nodeId: node.id })}>${icon('edit')} Edit component</button>
        <button type="button" class="nx-action-btn-quiet nx-btn-sm"
          @click=${() => ctx.dispatch(detachRef, { nodeId: node.id })}>${icon('unlink')} Detach</button>
      ` : nothing}
    </div>
  `);
}

/** Links to each use of a component: in Build, or on the page of the component using it. */
function usages(ctx, uses) {
  const { model, store } = ctx;
  if (!uses.length) return html`<p class="hint">Not used yet.</p>`;
  const link = ({ node, def }) => {
    const trail = breadcrumb(model, node.id);
    const where = trail.slice(0, -1).map((label) => label || 'Schema');
    if (def) where[0] = `${def.name} component`;
    return html`<li>
      <button type="button" class="nx-action-btn-quiet nx-btn-sm usage"
        title=${trail.join(' › ')} @click=${() => store.select(node.id, { reveal: true })}>
        <span class="usage-name">${trail.at(-1) || 'Untitled'}</span>
        <span class="usage-where">in ${where.join(' › ')}</span>
      </button>
    </li>`;
  };
  return html`
    <div class="usages">
      <p class="eyebrow">Used in ${uses.length} ${uses.length > 1 ? 'places' : 'place'}</p>
      <ul class="list">${uses.map(link)}</ul>
    </div>
  `;
}

function commitName(ctx, def, draft) {
  ctx.view.set('nameDraft', undefined);
  if (draft === def.name) return;
  ctx.dispatch(renameDef, { defId: def.id, name: draft });
}

export function component(ctx) {
  const { model, entry } = ctx;
  const { def } = entry;
  const draft = ctx.view.get('nameDraft') ?? def.name;
  const others = model.defs.filter((d) => d.id !== def.id).map((d) => d.name);
  const error = draft === def.name ? null : validateDefName(draft, others);
  const onKey = (e) => {
    if (e.key === 'Enter' && !error) commitName(ctx, def, draft);
    if (e.key === 'Escape') ctx.view.set('nameDraft', undefined);
  };
  return section('component', 'Component', html`
    <se-input label="Component name" .value=${draft} required
      description="Used in the schema file as $defs/${def.name}."
      .error=${error ?? ''}
      @input=${(e) => ctx.view.set('nameDraft', e.target.value)}
      @keydown=${onKey}
      @change=${() => !error && commitName(ctx, def, draft)}></se-input>
    ${usages(ctx, refUsages(model, def.id))}
    <div class="row-actions">
      <button type="button" class="nx-action-btn-quiet nx-btn-sm"
        @click=${() => deleteComponent(ctx.store, def.id)}>${icon('delete')} Delete component</button>
    </div>
  `);
}

export function root(ctx) {
  const { model, store } = ctx;
  return section('root', 'Schema', html`
    <div class="name-row">
      <span class="eyebrow">Name</span>
      <span class="name-value">${model.name}</span>
      <button type="button" class="nx-action-btn-quiet nx-action-btn-icon" title="Copy name"
        aria-label="Copy schema name" @click=${() => copyText(store, model.name, 'Name')}>
        ${icon('copy')}</button>
    </div>
    <p class="hint">Documents refer to the schema by its name. It can't be changed here.</p>
  `);
}
