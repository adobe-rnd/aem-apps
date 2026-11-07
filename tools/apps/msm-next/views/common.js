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
import { SYNC_DISPLAY, levelLabel } from '../data/display.js';

export const badge = (label, tone = 'neutral', extra = '') => html`
  <span class="badge ${tone} ${extra}">${label}</span>`;

export function syncBadge(sync) {
  if (!sync) return nothing;
  const display = SYNC_DISPLAY[sync] ?? { label: sync, tone: 'neutral' };
  return badge(display.label, display.tone);
}

export const overriddenBadge = (result) => (result?.status?.overridden
  ? html`<span class="badge outline" title="This page has local edits since it was last synced">Overridden</span>`
  : nothing);

export const langBadge = (location) => html`
  <span class="lang" title=${location.label}>${location.language.toUpperCase()}</span>`;

export const pageLabel = (node) => (node.parent ? node.location.label : node.title);

export function pageSubLabel(node, rootSite) {
  const where = node.site === rootSite ? node.path : `${node.site}:${node.path}`;
  if (!node.parent) return where;
  return `${levelLabel(node.location, node.depth)} · ${where}`;
}

export const spinner = (label = 'Working') => html`
  <span class="spinner" role="img" aria-label=${label}></span>`;
