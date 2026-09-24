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
/**
 * Browse status surface for the request-for-publish plugin.
 *
 * This module is deliberately lean: `request-for-publish.js` pulls in the DA
 * editor styles and the Lit component at import time, which the browse list
 * must not pay for just to ask whether a page has a pending request. Anything
 * heavier than the status lookup is imported lazily, inside the call that
 * needs it.
 *
 * Host contract: blocks/browse/da-list/status-registry/README.md in da-live.
 */

/** The inbox app, linked at the foot of the popover. */
const INBOX_URL = 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox';

/**
 * The only state a request row can really be in. Approve, reject and withdraw
 * delete the row, so `pending` is the single status the browse list ever sees.
 */
const PENDING = 'pending';

/**
 * Both caller-scoped listings. Pending requests are not site-wide: `requester`
 * returns the caller's own rows, `approver` the rows the caller may approve.
 * There is no all-site endpoint, so a caller sees the union of the two.
 */
const ROLES = ['requester', 'approver'];

/** The browse item's org/site prefix is always exactly two segments. */
const PREFIX_DEPTH = 2;

/**
 * Site-relative, extensionless path for a browse item, the form the worker
 * stores (`/tea2` for `/bpauli/frescopa/tea2`, verified in bpauli/da-live#39).
 * The host supplies it as `item.sitePath`; the other two spellings are only
 * used as a fallback so a host that omits it still matches.
 * @param {Object} item - Browse item ({ path, previewPath, sitePath })
 * @returns {string} Site-relative extensionless path, or '' when unusable
 */
export function toSitePath(item = {}) {
  if (item.sitePath) return item.sitePath;
  const prefixed = item.previewPath || item.path;
  if (!prefixed) return '';
  const segments = prefixed.split('/').filter(Boolean);
  if (segments.length <= PREFIX_DEPTH) return '';
  return `/${segments.slice(PREFIX_DEPTH).join('/')}`.replace(/\.[^./]+$/, '');
}

/**
 * The stored paths that mean "this item". A folder index is browsed as
 * `/de/index` but AEM's canonical form for the same page is the folder itself,
 * so a request recorded against the folder has to match the index item too.
 * @param {string} sitePath - Site-relative extensionless path
 * @returns {string[]} Candidate stored paths, most specific first
 */
export function requestPathsFor(sitePath) {
  if (!sitePath) return [];
  if (!sitePath.endsWith('/index')) return [sitePath];
  const folder = sitePath.slice(0, -'/index'.length);
  return [sitePath, folder || '/'];
}

/**
 * Merge the role listings into one row per path. A caller who is both the
 * requester and an approver gets the same row from both listings.
 * @param {Array<Array<Object>>} lists - Request rows per role
 * @returns {Object[]} Pending rows, deduped by path
 */
export function mergePendingRequests(lists = []) {
  const byPath = new Map();
  lists.flat().forEach((row) => {
    if (!row?.path || row.status !== PENDING) return;
    if (!byPath.has(row.path)) byPath.set(row.path, row);
  });
  return [...byPath.values()];
}

/**
 * Find the pending request for a browse item.
 * @param {Object[]} requests - Pending request rows
 * @param {string} sitePath - Site-relative extensionless path
 * @returns {Object|null} The matching row, or null
 */
export function findPendingRequest(requests, sitePath) {
  const candidates = requestPathsFor(sitePath);
  return candidates.reduce(
    (found, candidate) => found || (requests || []).find((row) => row.path === candidate) || null,
    null,
  );
}

/**
 * Format an ISO timestamp for the popover, falling back to the raw value.
 * @param {string} created - ISO timestamp from the request row
 * @returns {string} Display string
 */
function formatCreated(created) {
  const date = new Date(created);
  if (Number.isNaN(date.getTime())) return created;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Build the host status object from a request row. Every popover field comes
 * from the row itself — listing the requests is the only network call.
 * @param {Object} row - Pending request row
 * @param {Object} ctx - { org, site }
 * @returns {Object} Status object for the browse drawer
 */
export function toStatus(row, { org, site } = {}) {
  const detail = [
    ['Requested by', row.requester],
    ['Approver', row.approver],
    ['Comment', row.comment],
    ['Requested', row.created && formatCreated(row.created)],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value }));

  const href = org && site
    ? `${INBOX_URL}?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`
    : INBOX_URL;

  return {
    state: PENDING,
    label: 'In Review',
    icon: 'clock',
    detail,
    href,
  };
}

/**
 * List the caller's pending requests for a site, across both roles. A role
 * that fails contributes nothing rather than failing the whole lookup: a
 * throwing `getStatus` disables the status surface for the life of the list.
 * @param {Object} params - { org, site, token }
 * @returns {Promise<Object[]>} Pending rows, deduped by path
 */
async function fetchPendingRequests({ org, site, token }) {
  if (!org || !site) return [];
  // utils.js imports daFetch from da.live at module scope; only the browser
  // needs it, so it is pulled in here rather than at the top of this module.
  const { getWorkerUrl, getOpts } = await import('./utils.js');
  const base = getWorkerUrl();
  const query = `org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
  const lists = await Promise.all(ROLES.map(async (role) => {
    try {
      const resp = await fetch(`${base}/api/requests?${query}&role=${role}`, getOpts(token));
      if (!resp.ok) return [];
      const { requests = [] } = await resp.json();
      return requests;
    } catch {
      return [];
    }
  }));
  return mergePendingRequests(lists);
}

/**
 * Resolve org and site from whichever of the host's two carriers has them.
 * `context.path` is the `/org/site` the list is browsing.
 * @param {Object} context - init context
 * @param {Object} ctx - getStatus context
 * @returns {{org: string, site: string}} Org and site
 */
function resolveOrgSite(context = {}, ctx = {}) {
  const org = ctx.org || context.org || '';
  const site = ctx.site || context.site || '';
  if (org && site) return { org, site };
  const segments = (ctx.path || context.path || '').split('/').filter(Boolean);
  return { org: org || segments[0] || '', site: site || segments[1] || '' };
}

/**
 * Build the status handle. Exported for tests, which supply their own
 * `loadRequests` so no network is involved.
 * @param {Object} params - { context, token, loadRequests }
 * @returns {Object} Handle exposing getStatus
 */
export function createHandle({ context = {}, token, loadRequests = fetchPendingRequests } = {}) {
  // The host calls getStatus once per expand and caches nothing, so the
  // listing is fetched once per init and shared by every item in the list.
  let requests = null;

  return {
    async getStatus(item, ctx = {}) {
      const sitePath = toSitePath(item);
      if (!sitePath) return null;
      const { org, site } = resolveOrgSite(context, ctx);
      if (!requests) {
        requests = loadRequests({ org, site, token: ctx.token || token });
      }
      const row = findPendingRequest(await requests, sitePath);
      return row ? toStatus(row, { org, site }) : null;
    },
  };
}

/**
 * DA browse status plugin entry point.
 * @param {Object} sdk - { context: { org, site, path, ref }, token }
 * @returns {Promise<Object>} Handle exposing getStatus
 */
export default async function init({ context, token } = {}) {
  return createHandle({ context, token });
}
