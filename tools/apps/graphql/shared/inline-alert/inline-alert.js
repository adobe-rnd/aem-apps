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
import { icon } from '../icons.js';

// Spectrum 2 in-line alert (border style): https://spectrum.adobe.com/page/in-line-alert/
export const inlineAlertStyle = await loadStyle(import.meta.url);

const ICONS = {
  informative: { name: 'info', label: 'Information' },
  negative: { name: 'alert', label: 'Error' },
};

const renderIcon = (variant) => icon({ ...ICONS[variant], className: 'inline-alert-icon' });

export function renderInlineAlert({
  variant, heading, content = nothing, className = '', role = 'status',
}) {
  return html`
    <div class="inline-alert ${variant} ${className}" role=${role}>
      ${renderIcon(variant)}
      <p class="inline-alert-heading">${heading}</p>
      <div class="inline-alert-content">${content}</div>
    </div>`;
}
