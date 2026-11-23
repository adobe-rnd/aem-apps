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
import { buildHash, ENDPOINTS_SECTION } from '../utils/route.js';
import { icon } from '../utils/icons.js';

// The app's top bar, rendered by each screen into its own shadow root so the screen styles its
// controls. Screens adopt `headerStyle` after the canvas style (ui/shared/canvas/).
export const headerStyle = await loadStyle(import.meta.url);

function renderSite({ org, site, onChangeSite }) {
  if (!site) return nothing;
  const key = `${org}/${site}`;
  return html`
    <span class="site" title=${key}>${key}</span>
    <button type="button" class="nx-action-btn-icon change-site" title="Change site (${key})"
      aria-label="Change site, ${key}" @click=${onChangeSite}>${icon({ name: 'edit' })}</button>
    <span class="divider" aria-hidden="true"></span>`;
}

// GraphQL › endpoints › {endpoint}; the trail is app-specific, so it is not nx-breadcrumb.
function renderTrail({ org, site, endpoint }) {
  const current = (label) => html`<span class="crumb-label" aria-current="page">${label}</span>`;
  const section = endpoint && site
    ? html`<a class="crumb-label" href=${buildHash({ org, site })}>${ENDPOINTS_SECTION}</a>`
    : current(ENDPOINTS_SECTION);
  return html`
    <nav class="trail" aria-label="Breadcrumb">
      <ol>
        <li class="crumb"><span class="crumb-label">GraphQL</span></li>
        <li class="crumb">${section}</li>
        ${endpoint ? html`<li class="crumb">${current(endpoint)}</li>` : nothing}
      </ol>
    </nav>`;
}

// `center` and `end` fill the bar's center and end groups; a bar without `center` gives the
// end group the free space, so its controls (search, sort) can grow.
export function renderHeader({
  org, site, endpoint, onChangeSite, center, end,
}) {
  return html`
    <header class="bar ${center ? 'centered' : ''} ${endpoint ? '' : 'root'}">
      <h1 class="sr-only">${endpoint ?? 'GraphQL endpoints'}</h1>
      <div class="group group-start">
        ${renderSite({ org, site, onChangeSite })}
        ${renderTrail({ org, site, endpoint })}
      </div>
      ${center ? html`<div class="group group-center">${center}</div>` : nothing}
      <div class="group group-end">${end ?? nothing}</div>
    </header>`;
}
