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

/* global AggregateError */
import { applyCugHeaders } from '../../plugins/cug/headers.js';

const SITE_PATTERN = /^\/?([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i;
const AEM_HOST_PATTERN = /^[a-z0-9-]+--([a-z0-9-]+)--([a-z0-9-]+)\.aem\.(?:page|live)$/i;
const SITE_INPUT_ERROR = 'Enter an org/site or an HTTPS .aem.page or .aem.live URL.';

export function siteFromHash(hash) {
  const site = hash.startsWith('#') ? hash.slice(1) : '';
  return SITE_PATTERN.test(site) ? site.replace(/^\//, '') : '';
}

function siteParts(site) {
  const input = site.trim();
  const match = input.match(SITE_PATTERN);
  if (match) {
    const [, org, repo] = match;
    return { org, repo };
  }
  let url;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new Error(SITE_INPUT_ERROR, { cause });
  }
  const host = url.hostname.match(AEM_HOST_PATTERN);
  if (!host || url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error(SITE_INPUT_ERROR);
  }
  const [, repo, org] = host;
  return { org, repo };
}

export function siteKey(site) {
  const { org, repo } = siteParts(site);
  return `${org}/${repo}`;
}

function sourceUrl(site, path = '/.da/cug/cug.json') {
  const { org, repo } = siteParts(site);
  return `https://admin.da.live/source/${org}/${repo}${path}`;
}

export async function assertSiteExists(site, daFetch) {
  const { org, repo } = siteParts(site);
  const response = await daFetch(`https://admin.da.live/list/${org}/`, { cache: 'no-store' });
  const notFound = `Org/site /${org}/${repo} was not found. Check the name and your access.`;
  if (response.status === 404) throw new Error(notFound);
  if (!response.ok) {
    throw new Error(`Could not check org/site (HTTP ${response.status}). Check your DA access.`);
  }
  const sites = await response.json();
  if (!Array.isArray(sites)) throw new Error('DA returned an invalid site list.');
  if (!sites.some((item) => item && !item.ext && item.name === repo)) {
    throw new Error(notFound);
  }
}

async function fetchSheet(site, daFetch, path) {
  const response = await daFetch(sourceUrl(site, path), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Spreadsheet request failed (HTTP ${response.status}).`);
  const sheet = await response.json();
  if (!Array.isArray(sheet.data)) throw new Error('The spreadsheet must contain a data sheet.');
  return sheet;
}

function normalizeAuthentication(value, index) {
  const authentication = value ?? '';
  if (![true, false, 'true', 'false', ''].includes(authentication)) {
    throw new Error(`Invalid Authentication value in row ${index + 1}.`);
  }
  return String(authentication);
}

function parseCugRows(data) {
  return data.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Invalid spreadsheet row ${index + 1}.`);
    }
    if (!Object.hasOwn(row, 'Authentication') && Object.values(row).some((value) => value !== '')) {
      throw new Error(`Missing Authentication column in row ${index + 1}. Check the spreadsheet header.`);
    }
    const authentication = normalizeAuthentication(row.Authentication, index);
    if ((row.Path !== undefined && typeof row.Path !== 'string')
      || (row.Groups !== undefined && typeof row.Groups !== 'string')) {
      throw new Error(`Path and Groups must be text in row ${index + 1}.`);
    }
    return {
      path: row.Path ?? '',
      authentication,
      groups: (row.Groups ?? '').split(',').map((group) => group.trim()).filter(Boolean),
    };
  });
}

export async function fetchCugState(site, daFetch) {
  const sheet = await fetchSheet(site, daFetch);
  if (sheet === null) {
    const legacySheet = await fetchSheet(site, daFetch, '/closed-user-groups.json');
    return { rows: [], hasLegacySheet: legacySheet !== null };
  }
  return { rows: parseCugRows(sheet.data), hasLegacySheet: false };
}

async function writeSheet(site, sheet, daFetch) {
  const body = new FormData();
  body.append('data', new Blob([JSON.stringify(sheet)], { type: 'application/json' }));
  const response = await daFetch(sourceUrl(site), { method: 'PUT', body });
  if (!response.ok) throw new Error(`Spreadsheet save failed (HTTP ${response.status}).`);
  return sheet;
}

function validateCugRules(rows) {
  const errors = [];
  rows.forEach((row, index) => {
    const value = row.Path ?? '';
    const path = typeof value === 'string' ? value.trim() : null;
    const issues = [];
    if (!path?.startsWith('/')) issues.push('Enter a path starting with /.');
    const authentication = normalizeAuthentication(row.Authentication, index);
    const hasGroups = (row.Groups ?? '').split(',').some((group) => group.trim());
    if (authentication === '' && !hasGroups) {
      issues.push('Set Authentication or add at least one group.');
    }
    if (issues.length) {
      const field = path?.startsWith('/') ? 'rule' : 'Path';
      errors.push(new Error(`Invalid ${field} in row ${index + 1}. ${issues.join(' ')}`));
    }
  });
  if (errors.length) {
    throw new AggregateError(errors, errors.map((error) => error.message).join(' '));
  }
}

export async function migrateCugSheet(site, daFetch) {
  if (await fetchSheet(site, daFetch) !== null) {
    throw new Error('The destination spreadsheet already exists. Click Load to use it.');
  }
  const sheet = await fetchSheet(site, daFetch, '/closed-user-groups.json');
  if (sheet === null) throw new Error('The legacy spreadsheet was not found. Click Load to check again.');
  const columns = {
    url: 'Path',
    'cug-required': 'Authentication',
    'cug-groups': 'Groups',
  };
  const data = sheet.data.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Invalid spreadsheet row ${index + 1}.`);
    }
    const entries = Object.entries(row).filter(([column]) => column !== 'cug-login-path');
    if (!Object.keys(columns).some((column) => Object.hasOwn(row, column))) {
      return Object.fromEntries(entries);
    }
    const converted = Object.fromEntries(entries.map(([column, value]) => {
      if (!Object.hasOwn(columns, column)) return [column, value];
      const current = columns[column];
      if (Object.hasOwn(row, current)) {
        throw new Error(`Conflicting ${column} and ${current} columns in row ${index + 1}.`);
      }
      return [current, value];
    }));
    const authentication = converted.Authentication;
    return {
      ...converted,
      Path: converted.Path ?? '',
      Authentication: normalizeAuthentication(
        typeof authentication === 'string' ? authentication.trim().toLowerCase() : authentication,
        index,
      ),
      Groups: converted.Groups ?? '',
    };
  });
  parseCugRows(data);
  validateCugRules(data);
  return writeSheet(site, { ...sheet, data }, daFetch);
}

export async function saveCugRows(site, rows, daFetch) {
  const data = rows.map(({ path, authentication, groups }, index) => ({
    Path: path,
    Authentication: normalizeAuthentication(authentication, index),
    Groups: groups.join(','),
  }));
  validateCugRules(data);
  const sheet = await fetchSheet(site, daFetch) ?? { ':sheetname': 'data', ':type': 'sheet' };
  const updated = {
    ...sheet,
    total: data.length,
    limit: data.length,
    offset: 0,
    data,
  };
  return writeSheet(site, updated, daFetch);
}

export async function generateCugHeaders(site, sheet, daFetch) {
  const { org, repo } = siteParts(site);
  validateCugRules(sheet.data);
  const rows = sheet.data.map((row) => ({
    url: row.Path,
    'cug-required': row.Authentication,
    'cug-groups': row.Groups,
  }));
  return applyCugHeaders(org, repo, rows, daFetch);
}
