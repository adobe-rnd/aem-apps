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
import { html } from 'da-lit';

// Shared MSM icon helper. Icons live in ./img and are referenced via <use>.
// The href is resolved against this module's URL (not the consuming document),
// so it works identically from the app and the dialog — and survives the
// da.live `/app/{owner}/{repo}/` proxy, where root-relative paths would break.
const ICON_DIR = new URL('./img/', import.meta.url).href;

// Returns an inline <svg> using the named icon. Setting `--iconPrimary` to
// `currentColor` lets icons that hard-code that token follow the inherited
// text color, the same as the currentColor-based icons.
// eslint-disable-next-line import/prefer-default-export
export const icon = (name, viewBox = '0 0 20 20', w = 16, h = 16) => html`
  <svg width=${w} height=${h} viewBox=${viewBox} style="--iconPrimary: currentColor" aria-hidden="true">
    <use href="${ICON_DIR}${name}.svg#${name}"/>
  </svg>`;
