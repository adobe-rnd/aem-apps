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

// Sorting and searching lists. A sort is { key, direction: 'ascending' | 'descending' }.

export const isSameSort = (a, b) => a?.key === b?.key && a?.direction === b?.direction;

// A sortable heading's click: reverses its own column, or sorts another one ascending.
export function toggleSort(sort, key) {
  if (sort?.key !== key) return { key, direction: 'ascending' };
  return { key, direction: sort.direction === 'ascending' ? 'descending' : 'ascending' };
}

export const compareText = (a = '', b = '') => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

// Keeps the values where any whitespace-separated keyword of `query` is in one of `fields(value)`.
export function matchKeywords({ values = [], query = '', fields }) {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!keywords.length) return values;
  return values.filter((value) => fields(value)
    .some((field) => keywords.some((keyword) => field?.toLowerCase().includes(keyword))));
}
