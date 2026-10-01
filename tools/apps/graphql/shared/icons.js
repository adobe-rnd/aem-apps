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

const FILES = {
  addCircle: 's2-icon-addcircle-20-n',
  alert: 's2-icon-alerttriangle-20-n',
  arrowUp: 's2-icon-arrowupsend-20-n',
  copy: 's2-icon-copy-20-n',
  delete: 's2-icon-delete-20-n',
  edit: 's2-icon-edit-20-n',
  filter: 's2-icon-filter-20-n',
  info: 's2-icon-infocircle-20-n',
  openIn: 's2-icon-openin-20-n',
};

const iconHref = (name) => `${new URL(`../img/${FILES[name]}.svg`, import.meta.url).href}#icon`;

// S2 icon; `label` makes it a labelled image.
// eslint-disable-next-line import/prefer-default-export
export function icon({ name, className, label }) {
  return html`
    <svg class=${className ?? nothing} viewBox="0 0 20 20" width="18" height="18"
      role=${label ? 'img' : nothing} aria-label=${label ?? nothing}
      aria-hidden=${label ? nothing : 'true'}><use href="${iconHref(name)}"></use></svg>`;
}
