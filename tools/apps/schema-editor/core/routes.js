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
// Hash routing: maps the nx2 `hashChange` state to a screen, and builds hashes back.
//   #/org/site        → browse the site's schemas
//   #/org/site/name   → author schema `name`

import { validateSchemaName } from './model/keys.js';

export const SCREENS = Object.freeze({
  NONE: 'none',
  BROWSE: 'browse',
  AUTHOR: 'author',
});

/** @param {{ org?: string, site?: string|null, path?: string|null } | null} state */
export function parseRoute(state) {
  const { org, site, path } = state ?? {};
  if (!org || !site) return { screen: SCREENS.NONE };
  if (!path) return { screen: SCREENS.BROWSE, org, site };
  const name = path.replace(/\.html$/, '');
  if (validateSchemaName(name)) {
    return {
      screen: SCREENS.BROWSE, org, site, invalidName: name,
    };
  }
  return {
    screen: SCREENS.AUTHOR, org, site, name,
  };
}

export function routeHash({ org, site, name } = {}) {
  if (!org || !site) return '#';
  return name ? `#/${org}/${site}/${name}` : `#/${org}/${site}`;
}

export function sameRoute(a, b) {
  return a?.screen === b?.screen && a?.org === b?.org && a?.site === b?.site
    && a?.name === b?.name;
}
