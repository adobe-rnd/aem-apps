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

import { applyCugHeaders } from '../../plugins/cug/headers.js';

export function siteFromHash(hash) {
  return hash.startsWith('#/') ? hash.slice(1) : '';
}

function siteParts(site) {
  const match = site.trim().match(/^\/?([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i);
  if (!match) throw new Error('Enter an org/site, such as /jckautzmann/jck-ew1.');
  const [, org, repo] = match;
  return { org, repo };
}

function sourceUrl(site) {
  const { org, repo } = siteParts(site);
  return `https://admin.da.live/source/${org}/${repo}/.da/cug/cug.json`;
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

async function fetchSheet(site, daFetch) {
  const response = await daFetch(sourceUrl(site), { cache: 'no-store' });
  if (response.status === 404) {
    return {
      total: 0,
      limit: 0,
      offset: 0,
      data: [],
      ':sheetname': 'data',
      ':type': 'sheet',
    };
  }
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

export async function fetchCugRows(site, daFetch) {
  const sheet = await fetchSheet(site, daFetch);
  return sheet.data.map((row, index) => {
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

export async function saveCugRows(site, rows, daFetch) {
  const sheet = await fetchSheet(site, daFetch);
  const data = rows.map(({ path, authentication, groups }, index) => ({
    Path: path,
    Authentication: normalizeAuthentication(authentication, index),
    Groups: groups.join(','),
  }));
  const updated = {
    ...sheet,
    total: data.length,
    limit: data.length,
    offset: 0,
    data,
  };
  const body = new FormData();
  body.append('data', new Blob([JSON.stringify(updated)], { type: 'application/json' }));
  const response = await daFetch(sourceUrl(site), { method: 'PUT', body });
  if (!response.ok) throw new Error(`Spreadsheet save failed (HTTP ${response.status}).`);
  return updated;
}

export async function generateCugHeaders(site, sheet, daFetch) {
  const { org, repo } = siteParts(site);
  const rows = sheet.data.map((row) => ({
    url: row.Path,
    'cug-required': row.Authentication,
    'cug-groups': row.Groups,
  }));
  return applyCugHeaders(org, repo, rows, daFetch);
}
