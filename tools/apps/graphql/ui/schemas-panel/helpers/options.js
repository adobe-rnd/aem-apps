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
// A row's unsaved change against the saved selection; none for a new endpoint.
const getChange = ({ selected, wasSelected, saved }) => {
  if (!saved || selected === wasSelected) return undefined;
  return selected ? 'adding' : 'removing';
};

// Site schemas plus missing ids that are selected or saved, so they can be deselected.
// Rows in the saved selection are `saved`.
export function getSchemaOptions({ draft, schemas = [], saved }) {
  const selected = new Set(draft.schemas);
  const savedIds = new Set(saved);
  const known = new Set(schemas.map(({ id }) => id));
  const withChange = (row) => {
    const wasSelected = savedIds.has(row.id);
    const change = getChange({ selected: row.selected, wasSelected, saved });
    return { ...row, ...(wasSelected && { saved: true }), ...(change && { change }) };
  };
  const rows = schemas.map((entry) => withChange({
    id: entry.id,
    title: entry.schema?.title,
    selected: selected.has(entry.id),
    usable: !!entry.valid,
    issues: entry.issues ?? [],
  }));
  const missingIds = [...new Set([...draft.schemas, ...savedIds])].filter((id) => !known.has(id));
  const missing = missingIds.map((id) => withChange({
    id,
    selected: selected.has(id),
    usable: false,
    missing: true,
    issues: ['This schema no longer exists.'],
  }));
  return [...rows, ...missing];
}

// In Status sort order; a new endpoint's selection has no status, as nothing is saved yet.
const SCHEMA_STATUSES = ['invalid', 'missing', 'adding', 'removing', 'added'];

export function getSchemaStatus({
  usable, missing, change, saved,
}) {
  if (change) return change;
  if (!usable) return missing ? 'missing' : 'invalid';
  return saved ? 'added' : undefined;
}

// Keeps rows where any whitespace-separated keyword is in the id, title or status label.
// `statusLabel(option)` lets the view make its status wording searchable too.
export function filterSchemaOptions({ options = [], query = '', statusLabel }) {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!keywords.length) return options;
  return options.filter((option) => [option.id, option.title, statusLabel?.(option)]
    .some((value) => keywords.some((keyword) => value?.toLowerCase().includes(keyword))));
}

export function countChanges(options = []) {
  const count = (change) => options.filter((option) => option.change === change).length;
  return { adding: count('adding'), removing: count('removing') };
}

const compareText = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

const COMPARE = {
  id: (a, b) => compareText(a.id, b.id),
  title: (a, b) => compareText(a.title || a.id, b.title || b.id),
  status: (a, b) => SCHEMA_STATUSES.indexOf(getSchemaStatus(a))
    - SCHEMA_STATUSES.indexOf(getSchemaStatus(b)),
};

// Rows without a status stay last in both directions; ties sort by id.
export function sortSchemaOptions({ options = [], key = 'title', direction = 'ascending' }) {
  const sign = direction === 'descending' ? -1 : 1;
  const last = (option) => (key === 'status' && !getSchemaStatus(option) ? 1 : 0);
  return [...options].sort((a, b) => last(a) - last(b)
    || sign * COMPARE[key](a, b)
    || COMPARE.id(a, b));
}
