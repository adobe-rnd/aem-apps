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
import {
  parseConfig, normalizePath, ACTIONS, MISSING_PAGES, CONFLICT_BEHAVIORS, ON_COMPLETE,
} from '../../../localization/core/domain/config.js';
import { parseLanguage, languageLabel } from '../../../localization/core/domain/language.js';

export const FIELDS = [
  'path', 'language', 'label', 'level', 'source', 'actions', 'missingPages',
  'conflictBehavior', 'onComplete', 'translationProvider',
];

export const RELATIONSHIP_FIELDS = [
  'actions', 'missingPages', 'conflictBehavior', 'onComplete', 'translationProvider',
];

export const DEFAULT_PROVIDER = 'google';

export const TRANSLATION_PROVIDERS = [
  { id: 'google', label: 'Google Translate', connected: true },
  { id: 'deepl', label: 'DeepL', connected: false },
  { id: 'trados', label: 'Trados', connected: false },
  { id: 'smartling', label: 'Smartling', connected: false },
  { id: 'lionbridge', label: 'Lionbridge', connected: false },
];

export const ACTION_HELP = {
  link: 'Pages inherit this location’s source until someone edits them',
  rollout: 'Source changes are pushed to local copies',
  translate: 'Source content is translated into this language',
};

export const MISSING_PAGES_HELP = {
  none: 'Pages that do not exist here stay missing',
  linked: 'Pages that do not exist here are served from the source',
};

export const ON_COMPLETE_LABELS = { none: 'Do nothing', preview: 'Preview', publish: 'Publish' };

export const CONFLICT_LABELS = { merge: 'Merge changes', overwrite: 'Overwrite local edits' };

const HEADERS = Object.fromEntries(FIELDS.map((field) => [field.toLowerCase(), field]));

const headerOf = (key) => HEADERS[key.toLowerCase().replace(/[\s_-]/g, '')];

let counter = 0;
const nextUid = () => {
  counter += 1;
  return `row-${counter}`;
};

export const splitList = (value) => [...new Set((value ?? '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean))];

export const joinList = (items) => items.join(', ');

export function toDraft(rows) {
  return (rows ?? []).map((raw) => {
    const values = Object.fromEntries(FIELDS.map((field) => [field, '']));
    const extra = {};
    Object.entries(raw ?? {}).forEach(([key, value]) => {
      const field = headerOf(key);
      const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
      if (field) values[field] = text;
      else extra[key] = value;
    });
    return { uid: nextUid(), values, extra };
  });
}

export const toRows = (draft) => draft.map((row) => ({ ...row.extra, ...row.values }));

export const isBlank = (row) => !FIELDS.some((field) => row.values[field]);

export function isDirty(draft, baseRows) {
  return JSON.stringify(toRows(draft)) !== JSON.stringify(toRows(toDraft(baseRows)));
}

export const isRoot = (row) => !row.values.source;

export function setValue(row, field, value) {
  const values = { ...row.values, [field]: value };
  if (field === 'source' && !value) {
    RELATIONSHIP_FIELDS.forEach((name) => { values[name] = ''; });
  }
  return { ...row, values };
}

export function newRow(draft, { source = '', language = '' } = {}) {
  const taken = new Set(draft.map((row) => normalizePath(row.values.path)));
  let index = draft.length + 1;
  while (taken.has(`/new-location-${index}`)) index += 1;
  const values = Object.fromEntries(FIELDS.map((field) => [field, '']));
  Object.assign(values, {
    path: `/new-location-${index}`, language, source, actions: source ? 'rollout' : '',
  });
  return { uid: nextUid(), values, extra: {} };
}

export const copyRow = (draft, row) => {
  const [fresh] = toDraft([{ ...row.extra, ...row.values }]);
  const copy = newRow(draft);
  return { ...fresh, values: { ...fresh.values, path: copy.values.path } };
};

export function actionsOf(row) {
  return splitList(row.values.actions).filter((action) => ACTIONS.includes(action));
}

export function toggleAction(row, action, on) {
  const current = actionsOf(row);
  const next = ACTIONS.filter((each) => (each === action ? on : current.includes(each)));
  return setValue(row, 'actions', joinList(next));
}

export function conflictOf(row) {
  const list = splitList(row.values.conflictBehavior)
    .filter((item) => CONFLICT_BEHAVIORS.includes(item));
  const first = list[0] ?? CONFLICT_BEHAVIORS[0];
  return { first, both: list.length > 1 };
}

export function setConflict(row, { first, both }) {
  const other = CONFLICT_BEHAVIORS.find((item) => item !== first);
  return setValue(row, 'conflictBehavior', joinList(both ? [first, other] : [first]));
}

export const idOf = (site, row) => {
  const path = normalizePath(row.values.path);
  return path ? `${site}:${path}` : null;
};

export function validateDraft({ site, draft, sites = {} }) {
  const rows = toRows(draft);
  const { locations, issues } = parseConfig({ sites: { ...sites, [site]: rows } });
  const mine = issues.filter((issue) => (issue.id
    ? issue.id.startsWith(`${site}:`)
    : issue.site === site));
  const byUid = new Map();
  const add = (uid, issue) => byUid.set(uid, [...(byUid.get(uid) ?? []), issue]);
  const unplaced = [];
  mine.forEach((issue) => {
    const target = Number.isInteger(issue.row)
      ? draft[issue.row]
      : draft.find((row) => idOf(site, row) === issue.id);
    if (target) add(target.uid, issue);
    else unplaced.push(issue);
  });
  return {
    locations,
    issues: mine,
    byUid,
    unplaced,
    errors: mine.filter((issue) => issue.level === 'error'),
    warnings: mine.filter((issue) => issue.level === 'warning'),
  };
}

export function sourceOptions({
  site, draft, sites = {}, row,
}) {
  const own = draft
    .filter((each) => each.uid !== row?.uid && normalizePath(each.values.path))
    .map((each) => {
      const path = normalizePath(each.values.path);
      return {
        value: path,
        label: each.values.label || path,
        site,
        path,
      };
    });
  const others = Object.entries(sites)
    .filter(([name]) => name !== site)
    .flatMap(([name, siteRows]) => (siteRows ?? [])
      .map((raw) => ({ name, path: normalizePath(raw.path ?? raw.Path ?? '') }))
      .filter((entry) => entry.path)
      .map((entry) => ({
        value: `${entry.name}:${entry.path}`,
        label: `${entry.name}:${entry.path}`,
        site: entry.name,
        path: entry.path,
      })));
  return [...own, ...others];
}

export function describeRow(site, row) {
  const parsed = parseLanguage(row.values.language);
  return {
    id: idOf(site, row) ?? `${site}:${row.values.path}`,
    title: row.values.label || (parsed ? languageLabel(parsed.tag) : row.values.path || '(no path)'),
    path: row.values.path || '/',
  };
}

export const providerLabel = (id) => TRANSLATION_PROVIDERS
  .find((provider) => provider.id === id)?.label ?? id;

export const OPTIONS = {
  missingPages: MISSING_PAGES,
  onComplete: ON_COMPLETE,
};
