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
// Advanced and Unsupported sections. Unknown keywords are kept on save; this is where authors
// see and drop them.

import { html, nothing } from 'da-lit';
import { icon } from '../../shared/icons.js';
import { remove } from '../../shared/actions.js';
import { section } from './controls.js';

function removeExtra(ctx, keyword) {
  const rest = { ...ctx.node.extras };
  delete rest[keyword];
  ctx.update({ extras: Object.keys(rest).length ? rest : undefined });
}

export function advanced(ctx) {
  const extras = Object.keys(ctx.node.extras ?? {});
  // Nothing to show: leave its issues to the callout.
  if (!extras.length) return nothing;
  const open = ctx.view.get('advancedOpen') || !!ctx.error('advanced');
  return html`
    <details class="section advanced" ?open=${open}
      @toggle=${(e) => ctx.view.set('advancedOpen', e.target.open, { silent: true })}>
      <summary class="eyebrow">Advanced</summary>
      <div class="extras">
        <p class="hint">Kept as-is when saving. The editor doesn't use them.</p>
        <ul class="list">
          ${extras.map((keyword) => html`
            <li class="extra">
              <span>${keyword}</span>
              <button type="button" class="nx-action-btn-quiet nx-btn-sm"
                @click=${() => removeExtra(ctx, keyword)}>Remove</button>
            </li>
          `)}
        </ul>
      </div>
    </details>
  `;
}

export function unsupported(ctx) {
  const { entry } = ctx;
  return section('unsupported', 'Unsupported', html`
    <p class="hint">
      This part of the schema uses JSON Schema features the editor doesn't support.
      It is kept unchanged when you save.
    </p>
    ${entry.parent ? html`
      <div class="row-actions">
        <button type="button" class="nx-action-btn nx-btn-sm"
          @click=${() => remove(ctx.store, ctx.node.id)}>${icon('delete')} Delete</button>
      </div>` : nothing}
  `);
}
