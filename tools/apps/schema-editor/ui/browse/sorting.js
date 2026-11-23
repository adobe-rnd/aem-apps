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

// The schema list's sort orders, named for people, as on da.live browse: a Sort popover in the
// bar and sortable column headings. Sorting itself is `sortItems` (core/catalog.js).

export const SORT_COLUMNS = {
  title: { label: 'Title', ascending: 'A-Z', descending: 'Z-A' },
  name: { label: 'Name', ascending: 'A-Z', descending: 'Z-A' },
  modified: { label: 'Modified', ascending: 'oldest first', descending: 'newest first' },
};

export const SORT_OPTIONS = [
  ['title', 'ascending', 'Title (A-Z)'],
  ['title', 'descending', 'Title (Z-A)'],
  ['name', 'ascending', 'Name (A-Z)'],
  ['name', 'descending', 'Name (Z-A)'],
  ['modified', 'descending', 'Modified at (Newest)'],
  ['modified', 'ascending', 'Modified at (Oldest)'],
].map(([property, direction, label]) => ({ property, direction, label }));

/** "Title (A-Z)", "Modified (newest first)": the order a sort announces. */
export const sortedBy = ({ property, direction }) => {
  const column = SORT_COLUMNS[property];
  return `${column.label} (${column[direction]})`;
};

export const sameSort = (a, b) => a?.property === b?.property && a?.direction === b?.direction;
