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
import { icon } from '../utils/icons.js';
import '../endpoint-menu/endpoint-menu.js';

// The app's top bar, as in the GraphQL Endpoints app. The host adopts `headerStyle` after the
// canvas style (ui/shared/canvas/).
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

// GraphQL › endpoints › {endpoint}, as in the GraphQL Endpoints app; the endpoint crumb switches
// to another endpoint of the site.
function renderTrail({ endpoint, endpoints, onEndpointChange }) {
  return html`
    <nav class="trail" aria-label="Breadcrumb">
      <ol>
        <li class="crumb"><span class="crumb-label">GraphQL</span></li>
        <li class="crumb"><span class="crumb-label">endpoints</span></li>
        ${endpoint ? html`
          <li class="crumb">
            <gqi-endpoint-menu .endpoint=${endpoint} .endpoints=${endpoints}
              @endpoint-change=${onEndpointChange}></gqi-endpoint-menu>
          </li>` : nothing}
      </ol>
    </nav>`;
}

export function renderHeader({
  org, site, endpoint, endpoints, onChangeSite, onEndpointChange,
}) {
  return html`
    <header class="bar">
      <h1 class="sr-only">${endpoint ? `GraphiQL: ${endpoint}` : 'GraphiQL'}</h1>
      <div class="group group-start">
        ${renderSite({ org, site, onChangeSite })}
        ${renderTrail({ endpoint, endpoints, onEndpointChange })}
      </div>
    </header>`;
}
