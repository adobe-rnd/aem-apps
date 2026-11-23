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
import { compareText, matchKeywords } from '../../utils/list.js';

// The endpoint list shows endpoint names; listings have no dates, so it sorts by name only.

export const DEFAULT_ENDPOINT_SORT = { key: 'name', direction: 'ascending' };

// Keeps names that contain any whitespace-separated keyword of `query`.
export const filterEndpoints = ({ endpoints = [], query = '' }) => matchKeywords({
  values: endpoints, query, fields: (name) => [name],
});

export function sortEndpoints({ endpoints = [], sort = DEFAULT_ENDPOINT_SORT }) {
  const sign = sort.direction === 'descending' ? -1 : 1;
  return [...endpoints].sort((a, b) => sign * compareText(a, b));
}
