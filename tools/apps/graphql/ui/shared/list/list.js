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
/* eslint-disable import/no-unresolved */
import { html, nothing } from 'da-lit';
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';
import { icon } from '../../utils/icons.js';
import { toggleSort } from '../../utils/list.js';

// The schema editor's list: a `.list` grid whose `.list-head` and `.rows > .row` share one
// column template (`--cols` on `.list`, set by the host), each row's `.row-link` spanning
// every column but the last (`--link-cols`), which holds the row's own control.
export const listStyle = await loadStyle(import.meta.url);

// A heading that sorts its column; the arrow shows on the sorted column only.
export function renderSortHeading({
  key, label, sort, onSort, disabled,
}) {
  const direction = sort?.key === key ? sort.direction : undefined;
  const arrow = direction && icon({ name: direction === 'ascending' ? 'sortUp' : 'sortDown' });
  return html`
    <button type="button" class="sort-heading" ?disabled=${disabled}
      @click=${() => onSort(toggleSort(sort, key))}>
      <span>${label}${direction ? html`<span class="sr-only">, sorted ${direction}</span>` : nothing}</span>
      <span class="sort-icon">${arrow || nothing}</span>
    </button>`;
}
