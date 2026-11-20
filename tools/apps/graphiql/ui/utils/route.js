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
const ENDPOINT_NAME = /^[a-z][a-z0-9-]{2,31}$/;

// #/{org}/{site}/{endpoint}; an invalid endpoint opens the site.
export function toRoute(details) {
  if (!details?.org) return undefined;
  const { org, site, path } = details;
  if (!site) return { org };
  const endpoint = (path || '').split('/').filter(Boolean)[0];
  return ENDPOINT_NAME.test(endpoint ?? '') ? { org, site, endpoint } : { org, site };
}

export function buildHash({ org, site, endpoint } = {}) {
  if (!org) return '';
  return `#/${[org, site, site && endpoint].filter(Boolean).join('/')}`;
}

export const isSameRoute = ({ route, other }) => ['org', 'site', 'endpoint']
  .every((key) => route?.[key] === other?.[key]);
