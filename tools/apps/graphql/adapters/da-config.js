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
import { fetchDaConfigs, getFirstSheet } from 'https://da.live/nx2/utils/daConfig.js';

const ENDPOINT_PATTERN_KEY = 'graphql.endpoint';

const findValue = (json) => getFirstSheet(json)
  ?.find((row) => row.key === ENDPOINT_PATTERN_KEY)?.value;

// The site's `graphql.endpoint` URL pattern, else the org's; undefined when unset or unreadable.
// eslint-disable-next-line import/prefer-default-export
export async function loadEndpointPattern({ org, site }) {
  try {
    const configs = await Promise.all(fetchDaConfigs({ org, site }));
    return configs.map(findValue).findLast(Boolean);
  } catch {
    return undefined;
  }
}
