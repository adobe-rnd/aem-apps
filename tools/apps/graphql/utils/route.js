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
import { isValidEndpointName } from './endpoint.js';

export const ENDPOINTS_SECTION = 'endpoints';

// #/{org}/{site}/endpoints/{endpoint}; anything else within a site opens the list.
export function toRoute(details) {
  if (!details?.org) return undefined;
  const { org, site, path } = details;
  if (!site) return { org };
  const [section, ...rest] = (path || '').split('/').filter(Boolean);
  if (section !== ENDPOINTS_SECTION || !rest.length) return { org, site };
  const endpoint = rest.join('/');
  return isValidEndpointName(endpoint) ? { org, site, endpoint } : { org, site };
}

export function buildHash({ org, site, endpoint } = {}) {
  if (!org) return '';
  if (!site) return `#/${org}`;
  return `#/${[org, site, ENDPOINTS_SECTION, endpoint].filter(Boolean).join('/')}`;
}

const ROUTE_KEYS = ['org', 'site', 'endpoint'];

export const isSameRoute = ({ route, other }) => ROUTE_KEYS
  .every((key) => route?.[key] === other?.[key]);
