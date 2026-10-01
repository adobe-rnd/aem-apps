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

// Spectrum 2 status light: https://spectrum.adobe.com/page/status-light/
export const statusLightStyle = await loadStyle(import.meta.url);

// variant: positive, notice, negative or neutral.
export function renderStatusLight({ variant = 'neutral', label, title }) {
  return html`<span class="status-light ${variant}" title=${title ?? nothing}>${label}</span>`;
}
