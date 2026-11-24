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
  checkmark: 's2-icon-checkmark-20-n',
  chevronDown: 's2-icon-chevrondown-20-n',
  edit: 's2-icon-edit-20-n',
};

const iconHref = (name) => `${new URL(`../img/icons/${FILES[name]}.svg`, import.meta.url).href}#icon`;

// Decorative S2 icon.
// eslint-disable-next-line import/prefer-default-export
export function icon({ name, className }) {
  return html`
    <svg class=${className ?? nothing} viewBox="0 0 20 20" width="18" height="18"
      aria-hidden="true"><use href="${iconHref(name)}"></use></svg>`;
}
