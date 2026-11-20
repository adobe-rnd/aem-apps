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

export const messageStyle = await loadStyle(import.meta.url);

// A centered full-page message with one action, e.g. for an empty or missing context.
export function renderMessage({
  heading, text, action, onAction, role,
}) {
  return html`
    <section class="message" role=${role ?? nothing}>
      <h2>${heading}</h2>
      <p>${text}</p>
      <sl-button class="primary outline" @click=${onAction}>${action}</sl-button>
    </section>`;
}

export const renderLoading = (text) => html`
  <div class="loading" role="status">
    <span class="nx-loading-spinner" aria-hidden="true"></span>${text}
  </div>`;
