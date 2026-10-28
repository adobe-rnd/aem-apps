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
  parseLanguage, languageLabel, canTranslate, isSameBaseLanguage,
} from './language.js';

export const MAX_DEPTH = 5;

export const ACTIONS = ['link', 'rollout', 'translate'];
export const MISSING_PAGES = ['linked', 'none'];
export const CONFLICT_BEHAVIORS = ['merge', 'overwrite'];
export const ON_COMPLETE = ['none', 'preview', 'publish'];

const DEFAULTS = {
  actions: ['rollout'],
  missingPages: 'none',
  conflictBehavior: ['merge'],
  onComplete: 'none',
};

const RELATIONSHIP_FIELDS = ['actions', 'missingPages', 'conflictBehavior', 'onComplete'];

const FIELDS = ['path', 'language', 'label', 'source', ...RELATIONSHIP_FIELDS];
const HEADER_MAP = Object.fromEntries(FIELDS.map((field) => [field.toLowerCase(), field]));

const SITE_PATTERN = /^[a-z0-9-]+$/;

const toId = (site, path) => `${site}:${path}`;

function normalizeRow(raw) {
  return Object.entries(raw || {}).reduce((acc, [key, value]) => {
    const field = HEADER_MAP[key.toLowerCase().replace(/[\s_-]/g, '')];
    if (field) acc[field] = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    return acc;
  }, {});
}

export function normalizePath(raw) {
  const value = (raw ?? '').trim();
  if (!value) return '/';
  if (!value.startsWith('/')) return null;
  const stripped = value.replace(/\/+$/, '');
  if (!stripped) return '/';
  const segments = stripped.slice(1).split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return stripped;
}

export function parseSource(raw, site) {
  const value = (raw ?? '').trim();
  if (value.startsWith('/')) {
    const path = normalizePath(value);
    return path ? toId(site, path) : null;
  }
  const colonIndex = value.indexOf(':');
  if (colonIndex <= 0) return null;
  const sourceSite = value.slice(0, colonIndex).toLowerCase();
  const rest = value.slice(colonIndex + 1);
  if (!SITE_PATTERN.test(sourceSite) || !rest.startsWith('/')) return null;
  const path = normalizePath(rest);
  return path ? toId(sourceSite, path) : null;
}

const toList = (value) => [...new Set((value || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean))];

function parseRow(fields, { site, index }, issue) {
  const rowContext = { site, row: index };

  const path = normalizePath(fields.path);
  if (!path) {
    issue({
      ...rowContext, code: 'invalid-path', field: 'path', message: `Invalid path "${fields.path}".`,
    });
    return null;
  }

  const id = toId(site, path);
  const fail = (code, field, message) => issue({
    ...rowContext, id, code, field, message,
  });

  const parsedLanguage = parseLanguage(fields.language);
  if (!parsedLanguage) fail('invalid-language', 'language', `Invalid language "${fields.language || ''}".`);
  const language = parsedLanguage?.tag ?? (fields.language || '');

  const location = {
    id,
    site,
    path,
    language,
    label: fields.label || (parsedLanguage ? languageLabel(language) : id),
    source: null,
    actions: [],
    missingPages: null,
    conflictBehavior: [],
    onComplete: null,
    valid: true,
    resolved: true,
  };

  if (!fields.source) {
    const setFields = RELATIONSHIP_FIELDS.filter((field) => fields[field]);
    if (setFields.length) {
      fail('root-has-relationship-settings', setFields[0], `Root location has relationship settings (${setFields.join(', ')}) but no source.`);
    }
    return location;
  }

  location.source = parseSource(fields.source, site);
  if (!location.source) fail('invalid-source', 'source', `Invalid source "${fields.source}". Use "site:/path" or "/path".`);

  const listField = (field, allowed, code) => {
    const values = toList(fields[field]);
    if (!values.length) return [...DEFAULTS[field]];
    const unknownValues = values.filter((value) => !allowed.includes(value));
    if (unknownValues.length) fail(code, field, `Unknown ${field}: ${unknownValues.join(', ')}.`);
    return values.filter((value) => allowed.includes(value));
  };
  const valueField = (field, allowed, code) => {
    const value = (fields[field] || '').toLowerCase();
    if (!value) return DEFAULTS[field];
    if (!allowed.includes(value)) {
      fail(code, field, `Unknown ${field}: ${value}.`);
      return DEFAULTS[field];
    }
    return value;
  };

  location.actions = listField('actions', ACTIONS, 'invalid-actions');
  location.missingPages = valueField('missingPages', MISSING_PAGES, 'invalid-missing-pages');
  location.conflictBehavior = listField('conflictBehavior', CONFLICT_BEHAVIORS, 'invalid-conflict-behavior');
  location.onComplete = valueField('onComplete', ON_COMPLETE, 'invalid-on-complete');
  return location;
}

const siteOf = (id) => id.slice(0, id.indexOf(':'));

const erroredIds = (issues) => new Set(issues
  .filter((entry) => entry.level === 'error' && entry.id)
  .map((entry) => entry.id));

function findCycles(locations) {
  const inCycle = new Set();
  const done = new Set();
  locations.forEach((start) => {
    const stack = [];
    let current = start;
    while (current && !done.has(current.id)) {
      const cycleStart = stack.indexOf(current.id);
      if (cycleStart !== -1) {
        stack.slice(cycleStart).forEach((id) => inCycle.add(id));
        break;
      }
      stack.push(current.id);
      current = current.source ? locations.get(current.source) : null;
    }
    stack.forEach((id) => done.add(id));
  });
  return inCycle;
}

function ancestorsOf(locations, location) {
  const result = [];
  const seen = new Set([location.id]);
  let current = location.source ? locations.get(location.source) : null;
  while (current && !seen.has(current.id)) {
    result.push(current);
    seen.add(current.id);
    current = current.source ? locations.get(current.source) : null;
  }
  return result;
}

function validateGraph(locations, { loadedSites, issue }) {
  const unresolved = new Set();

  locations.forEach((location) => {
    const { id, source } = location;
    if (!source || locations.has(source)) return;
    const sourceSite = siteOf(source);
    if (loadedSites.has(sourceSite)) {
      issue({
        id, code: 'unknown-source', field: 'source', message: `Source ${source} is not a configured location.`,
      });
    } else {
      unresolved.add(id);
      issue({
        level: 'warning', id, code: 'source-unresolved', field: 'source', message: `Source ${source} not found; config for site ${sourceSite} is not loaded or not readable.`,
      });
    }
  });

  const inCycle = findCycles(locations);
  inCycle.forEach((id) => issue({
    id, code: 'cycle', field: 'source', message: `Location ${id} is part of a source cycle.`,
  }));

  locations.forEach((location) => {
    if (inCycle.has(location.id)) return;
    const depth = ancestorsOf(locations, location).length + 1;
    if (depth === MAX_DEPTH + 1) {
      issue({
        id: location.id, code: 'max-depth', field: 'source', message: `Location ${location.id} is ${depth} levels deep; max is ${MAX_DEPTH}.`,
      });
    }
  });

  locations.forEach((location) => {
    const source = location.source && locations.get(location.source);
    if (!source) return;
    if (!parseLanguage(source.language) || !parseLanguage(location.language)) return;
    if (location.actions.includes('translate') && !canTranslate(source.language, location.language)) {
      issue({
        id: location.id, code: 'translate-same-language', field: 'actions', message: `Cannot translate ${source.language} to ${location.language}.`,
      });
    }
    const copies = location.actions.some((action) => action === 'link' || action === 'rollout')
      && !location.actions.includes('translate');
    if (copies && !isSameBaseLanguage(source.language, location.language)) {
      issue({
        level: 'warning', id: location.id, code: 'cross-language', field: 'actions', message: `Link/rollout from ${source.language} to ${location.language} copies content across languages.`,
      });
    }
  });

  return { unresolved, inCycle };
}

function propagate(locations, {
  issues, unresolved, inCycle, issue,
}) {
  const ownInvalid = erroredIds(issues);

  locations.forEach((location) => {
    const ancestors = ancestorsOf(locations, location);
    if (!inCycle.has(location.id)) {
      const invalidAncestor = ancestors.find((ancestor) => ownInvalid.has(ancestor.id));
      if (invalidAncestor) {
        issue({
          id: location.id, ancestor: invalidAncestor.id, code: 'invalid-ancestor', field: 'source', message: `Source chain includes invalid location ${invalidAncestor.id}.`,
        });
      }
    }
    if (unresolved.has(location.id)) {
      location.resolved = false;
      return;
    }
    const unresolvedAncestor = ancestors.find((ancestor) => unresolved.has(ancestor.id));
    if (unresolvedAncestor) {
      location.resolved = false;
      issue({
        level: 'warning', id: location.id, ancestor: unresolvedAncestor.id, code: 'ancestor-unresolved', field: 'source', message: `Source chain is incomplete above ${unresolvedAncestor.id}.`,
      });
    }
  });
}

export function parseConfig({ sites = {} } = {}) {
  const issues = [];
  const issue = (details) => issues.push({ level: 'error', ...details });
  const locations = new Map();
  const loadedSites = new Set();

  Object.entries(sites).forEach(([rawSite, rows]) => {
    const site = rawSite.toLowerCase();
    if (!SITE_PATTERN.test(site)) {
      issue({ site: rawSite, code: 'invalid-site', message: `Invalid site "${rawSite}".` });
      return;
    }
    if (!rows) return;
    loadedSites.add(site);
    rows.forEach((raw, index) => {
      const fields = normalizeRow(raw);
      if (!Object.values(fields).some(Boolean)) return;
      const location = parseRow(fields, { site, index }, issue);
      if (!location) return;
      const { id } = location;
      if (locations.has(id)) {
        issue({
          site, row: index, id, code: 'duplicate-location', message: `Location ${id} is defined more than once.`,
        });
        return;
      }
      locations.set(id, location);
    });
  });

  const { unresolved, inCycle } = validateGraph(locations, { loadedSites, issue });
  propagate(locations, {
    issues, unresolved, inCycle, issue,
  });

  const invalid = erroredIds(issues);
  invalid.forEach((id) => {
    const location = locations.get(id);
    if (location) location.valid = false;
  });

  return { locations, issues };
}
