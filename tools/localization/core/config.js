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
import { parseLanguage, languageLabel } from './language.js';

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

const FIELDS = ['site', 'path', 'language', 'label', 'source', ...RELATIONSHIP_FIELDS];
const HEADER_MAP = Object.fromEntries(FIELDS.map((f) => [f.toLowerCase(), f]));

const COMPARED_FIELDS = ['site', 'path', 'language', 'source', ...RELATIONSHIP_FIELDS];

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
  if (segments.some((s) => !s || s === '.' || s === '..')) return null;
  return stripped;
}

export function parseSource(raw, site) {
  const value = (raw ?? '').trim();
  if (value.startsWith('/')) {
    const path = normalizePath(value);
    return path ? toId(site, path) : null;
  }
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const sourceSite = value.slice(0, idx).toLowerCase();
  const rest = value.slice(idx + 1);
  if (!SITE_PATTERN.test(sourceSite) || !rest.startsWith('/')) return null;
  const path = normalizePath(rest);
  return path ? toId(sourceSite, path) : null;
}

const toList = (value) => [...new Set((value || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean))];

function parseRow(fields, { scope, site: scopeSite, index }, issue) {
  const ctx = { scope, row: index };
  let site = (fields.site || '').toLowerCase();
  if (scope === 'site') {
    if (site && site !== scopeSite) {
      issue({
        ...ctx, code: 'site-mismatch', field: 'site', message: `Site "${site}" does not match site config "${scopeSite}".`,
      });
      return null;
    }
    site = scopeSite;
  } else if (!site) {
    issue({
      ...ctx, code: 'missing-site', field: 'site', message: 'Org config rows need a site.',
    });
    return null;
  }

  if (!SITE_PATTERN.test(site)) {
    issue({
      ...ctx, code: 'invalid-site', field: 'site', message: `Invalid site "${site}".`,
    });
    return null;
  }

  const path = normalizePath(fields.path);
  if (!path) {
    issue({
      ...ctx, code: 'invalid-path', field: 'path', message: `Invalid path "${fields.path}".`,
    });
    return null;
  }

  const id = toId(site, path);
  const fail = (code, field, message) => issue({
    ...ctx, id, code, field, message,
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
    scope,
    valid: true,
  };

  if (!fields.source) {
    const set = RELATIONSHIP_FIELDS.filter((f) => fields[f]);
    if (set.length) {
      fail('root-has-relationship-settings', set[0], `Root location has relationship settings (${set.join(', ')}) but no source.`);
    }
    return location;
  }

  location.source = parseSource(fields.source, site);
  if (!location.source) fail('invalid-source', 'source', `Invalid source "${fields.source}". Use "site:/path" or "/path".`);

  const listField = (field, allowed, code) => {
    const values = toList(fields[field]);
    if (!values.length) return [...DEFAULTS[field]];
    const bad = values.filter((v) => !allowed.includes(v));
    if (bad.length) fail(code, field, `Unknown ${field}: ${bad.join(', ')}.`);
    return values.filter((v) => allowed.includes(v));
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

const sameDefinition = (a, b) => COMPARED_FIELDS
  .every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]));

export function parseConfig({ org, sites = {} } = {}) {
  const issues = [];
  const issue = (details) => issues.push({ level: 'error', ...details });
  const locations = new Map();

  const addScope = (rows, scope, site) => {
    const seen = new Set();
    (rows || []).forEach((raw, index) => {
      const fields = normalizeRow(raw);
      if (!Object.values(fields).some(Boolean)) return;
      const location = parseRow(fields, { scope, site, index }, issue);
      if (!location) return;
      const { id } = location;
      if (seen.has(id)) {
        issue({
          scope, row: index, id, code: 'duplicate-location', message: `Location ${id} is defined more than once in ${scope} config.`,
        });
        return;
      }
      seen.add(id);
      const existing = locations.get(id);
      if (!existing) {
        locations.set(id, location);
        return;
      }
      if (!sameDefinition(existing, location)) {
        issue({
          scope, row: index, id, code: 'scope-conflict', message: `Location ${id} is defined differently in org and site config.`,
        });
      }
    });
  };

  addScope(org, 'org');
  Object.entries(sites).forEach(([site, rows]) => addScope(rows, 'site', site.toLowerCase()));

  const invalid = new Set(issues.filter((i) => i.level === 'error' && i.id).map((i) => i.id));
  invalid.forEach((id) => {
    const location = locations.get(id);
    if (location) location.valid = false;
  });

  return { locations, issues, incomplete: org === null };
}
