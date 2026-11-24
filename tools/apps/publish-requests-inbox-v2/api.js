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
/* eslint-disable import/no-unresolved, no-console, no-await-in-loop */

import {
  adminUrl, createSourceVersion, isAemApiUrl, isHlx6, usesSourceBus,
} from '../../shared/hlx6.js';

const WORKER_URL = 'https://publish-requests.aem-poc-lab.workers.dev';
const CI_WORKER_URL = 'https://publish-requests-ci.aem-poc-lab.workers.dev';
const LOCAL_WORKER_URL = 'http://localhost:8787';

const CORS_PROXY = 'https://da-etc.adobeaem.workers.dev/cors';
const DA_ADMIN = 'https://admin.da.live';

// daFetch ensures a fresh IMS token is used on every request (handles token expiry)
async function daFetch(...args) {
  const sdk = await import('https://da.live/nx/utils/daFetch.js');
  return sdk.daFetch(...args);
}

/**
 * Get the Worker URL. Falls back to localhost:8787 for local development;
 * `?env=ci` targets the CI worker.
 * @returns {string} Worker URL
 */
function getWorkerUrl() {
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return LOCAL_WORKER_URL;
  }
  if (new URLSearchParams(window.location.search).get('env') === 'ci') {
    return CI_WORKER_URL;
  }
  return WORKER_URL;
}

/**
 * Build fetch options with the user's IMS bearer token. The worker derives the
 * caller's identity from this token; the client never sends an email/approver list.
 * @param {string} token - The authorization token
 * @param {string} method - HTTP method
 * @param {Object} body - Optional request body
 * @returns {Object} Fetch options object
 */
function getOpts(token, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  return opts;
}

/**
 * Extract a setting value from the publish-workflow-settings tab. Display-only;
 * the worker enforces the authoritative rules.
 * @param {Object} config - The workflow config returned by GET /api/v2/config
 * @param {string} key - The setting key to look up
 * @returns {string|null} The setting value or null if not found
 */
function extractSetting(config, key) {
  const settings = config?.['publish-workflow-settings']?.data || [];
  const entry = settings.find((r) => (r.key || r.Key) === key);
  return entry?.value || entry?.Value || null;
}

// ===========================================================================
// Site config / live host (admin.hlx.page — unchanged, client-side)
// ===========================================================================

/**
 * Fetch site config from admin.hlx.page (CDN config, etc.) via CORS proxy.
 * @param {string} org - Organization
 * @param {string} site - Site (repo)
 * @returns {Promise<Object|null>} Site config or null on failure
 */
export async function fetchSiteConfig(org, site) {
  try {
    const configUrl = `https://admin.hlx.page/sidekick/${org}/${site}/main/config.json`;
    const url = `${CORS_PROXY}?url=${encodeURIComponent(configUrl)}`;
    const response = await daFetch(url);
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.warn('Failed to fetch site config from admin.hlx.page:', error);
    return null;
  }
}

/**
 * Resolve the live host from site config.
 * Uses cdn.live.host (supports $owner, $repo placeholders) or falls back to default.
 * @param {string} org - Organization (owner)
 * @param {string} site - Site (repo)
 * @param {Object|null} config - Site config from fetchSiteConfig
 * @returns {string} Live host (e.g. main--repo--org.aem.live)
 */
export function getLiveHostFromConfig(org, site, config) {
  const liveHost = config?.host;
  if (liveHost) {
    return liveHost
      .replace(/\$owner/g, org)
      .replace(/\$repo/g, site);
  }
  return `main--${site}--${org}.aem.live`;
}

/**
 * Why the site can't take requests yet, or '' when it can or the worker can't say.
 * Unregistered: `GET /api/v2/site-config` answers 404 with `availableProviders`.
 * No rules: `GET /api/v2/config` answers `config: null` (no `publish-workflow-config`
 * in the site or org config). Denials, outages and network failures report nothing.
 */
export async function getSetupGap(org, site, token) {
  const query = `org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
  try {
    const regResp = await fetch(`${getWorkerUrl()}/api/v2/site-config?${query}`, getOpts(token));
    if (!regResp.ok) {
      const { availableProviders } = await regResp.json().catch(() => ({}));
      if (Array.isArray(availableProviders)) return "isn't registered for publish requests";
    }
    const configResp = await fetch(`${getWorkerUrl()}/api/v2/config?${query}`, getOpts(token));
    if (configResp.ok && !(await configResp.json()).config) return 'has no approval rules';
  } catch { /* fail open: the inbox reports its own errors */ }
  return '';
}

/**
 * Fetch per-customer accent color overrides from the workflow config (display).
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} token - Authorization token
 * @returns {Promise<{accentColor: string|null, accentColorHover: string|null}>}
 */
export async function fetchAccentSettings(org, site, token) {
  try {
    const url = `${getWorkerUrl()}/api/v2/config?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
    const resp = await fetch(url, getOpts(token, 'GET'));
    if (!resp.ok) return { accentColor: null, accentColorHover: null };
    const { config } = await resp.json();
    if (!config) return { accentColor: null, accentColorHover: null };
    return {
      accentColor: extractSetting(config, 'theme.accent-color'),
      accentColorHover: extractSetting(config, 'theme.accent-color-hover'),
    };
  } catch (error) {
    console.warn('Failed to fetch accent settings:', error);
    return { accentColor: null, accentColorHover: null };
  }
}

// ===========================================================================
// DA version (admin.da.live or the Helix 6 source bus — snapshot of the source after publish)
// ===========================================================================

const PUBLISH_VERSION_LABEL = 'Approved & Published';

/**
 * DA source path for a page or sheet. Media files are not versioned.
 * @param {string} path - Site-relative content path
 * @returns {string|null} Source path without leading slash, or null for unsupported files
 */
export function versionSourcePath(path) {
  const cleanPath = path.replace(/^\/+/, '');
  const lastSegment = cleanPath.split('/').pop();
  if (!lastSegment) return `${cleanPath}index.html`;
  if (!lastSegment.includes('.')) return `${cleanPath}.html`;
  return /\.(html|json)$/.test(lastSegment) ? cleanPath : null;
}

/**
 * Create a labelled version of an existing DA page or sheet (on Helix 6, in
 * the source bus).
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} path - Content path (site-relative)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function createVersion(org, site, path) {
  try {
    const sourcePath = versionSourcePath(path);
    if (!sourcePath) return { success: true };

    // The primary content source, not the admin ping, says where versions live.
    if (await usesSourceBus(org, site, fetchSiteConfig)) {
      const resp = await createSourceVersion(daFetch, org, site, sourcePath, PUBLISH_VERSION_LABEL);
      if (!resp.ok) return { success: false, error: `Version failed: ${resp.status}` };
      return { success: true };
    }

    const key = `${org}/${site}/${sourcePath}`;
    const source = await daFetch(`${DA_ADMIN}/source/${key}`, { method: 'HEAD', cache: 'no-store' });
    if (!source.ok) return { success: false, error: `Source check failed: ${source.status}` };

    const response = await daFetch(`${DA_ADMIN}/versionsource/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: PUBLISH_VERSION_LABEL }),
    });
    if (!response.ok) return { success: false, error: `Version failed: ${response.status}` };
    return { success: true };
  } catch (error) {
    console.warn('Error creating version:', error);
    return { success: false, error: error.message || 'Version failed' };
  }
}

// ===========================================================================
// Helix publish (runs under the user's session). Legacy sites go through the
// CORS proxy to admin.hlx.page; Helix 6 sites go to api.aem.live directly.
// ===========================================================================

/**
 * Publish content via Helix Admin API
 * POST https://admin.hlx.page/live/{org}/{site}/main/{path}
 * Helix 6: POST https://api.aem.live/{org}/sites/{site}/live/{path}
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} path - Content path
 * @returns {Promise<Object>} Result
 */
export async function publishContent(org, site, path) {
  try {
    // Ensure path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    const hlx6 = await isHlx6(org, site);
    const publishUrl = hlx6
      ? adminUrl('live', { org, site, path: cleanPath }, true)
      : `${CORS_PROXY}?url=https://admin.hlx.page/live/${org}/${site}/main${cleanPath}`;

    const response = await daFetch(publishUrl, { method: 'POST' });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Publish failed:', response.status, errorText);
      return {
        success: false,
        error: `Publish failed: ${response.status} ${errorText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('Error publishing content:', error);
    return {
      success: false,
      error: error.message || 'An error occurred during publish',
    };
  }
}

/**
 * Bulk publish multiple content paths via Helix Admin API
 * POST https://admin.hlx.page/live/{org}/{site}/main/*
 * Helix 6: POST https://api.aem.live/{org}/sites/{site}/live/ (forceAsync)
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string[]} paths - Array of content paths to publish
 * @returns {Promise<Object>} Result with job info or error
 */
export async function bulkPublishContent(org, site, paths) {
  try {
    // Normalize paths — ensure each starts with /
    const cleanPaths = paths.map((p) => (p.startsWith('/') ? p : `/${p}`));

    const hlx6 = await isHlx6(org, site);
    const bulkUrl = hlx6
      ? adminUrl('live', { org, site, path: '/' }, true)
      : `${CORS_PROXY}?url=https://admin.hlx.page/live/${org}/${site}/main/*`;
    // api.aem.live takes bulk paths at the resource root (it answers /* with a
    // 400), and runs up to 200 paths synchronously, keeping no job to poll.
    // forceAsync gives the same job and /details flow as admin.hlx.page.
    const body = hlx6 ? { paths: cleanPaths, forceAsync: true } : { paths: cleanPaths };

    const response = await daFetch(bulkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Bulk publish failed:', response.status, errorText);
      return {
        success: false,
        error: `Bulk publish failed: ${response.status} ${errorText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      data: result,
      job: result.job,
      links: result.links,
    };
  } catch (error) {
    console.error('Error during bulk publish:', error);
    return {
      success: false,
      error: error.message || 'An error occurred during bulk publish',
    };
  }
}

/**
 * Poll a bulk job until it completes or times out.
 * @param {string} jobSelfUrl - The links.self URL from the bulk publish response
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds (default: 60s)
 * @param {number} intervalMs - Polling interval in milliseconds (default: 2s)
 * @returns {Promise<Object>} Final job status
 */
export async function pollJobStatus(jobSelfUrl, maxWaitMs = 60000, intervalMs = 2000) {
  // Helix 6 job links point at api.aem.live, which needs no proxy.
  const jobUrl = isAemApiUrl(jobSelfUrl)
    ? `${jobSelfUrl}/details`
    : `${CORS_PROXY}?url=${encodeURIComponent(jobSelfUrl)}/details`;
  const startTime = Date.now();
  let lastJob;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const resp = await daFetch(jobUrl);

      if (!resp.ok) {
        console.warn('Job status check failed:', resp.status);
        break;
      }

      const job = await resp.json();
      lastJob = job;
      const { state } = job;

      // Terminal states
      if (state === 'stopped' || state === 'completed') {
        return { success: true, job };
      }

      // Still running — wait before polling again
      await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
    } catch (error) {
      console.warn('Job poll error:', error);
      break;
    }
  }

  return { success: false, job: lastJob, error: 'Job polling timed out or encountered an error' };
}

// ===========================================================================
// Workflow bookkeeping — thin REST client over publish-requests-worker.
// Identity is derived server-side from the user's IMS token; the worker does
// approver resolution, sheet I/O, and email. Publish/preview stay client-side.
// ===========================================================================

/**
 * Resolved approvers (incl. CC, when cc.can-approve) for a path.
 * @returns {Promise<string[]>} Deduplicated authorized emails (empty if none).
 */
async function readWorkerResponse(resp) {
  const result = await resp.json().catch(() => null);
  if (result?.code === 'registration-unavailable') {
    // The worker couldn't read the registration (503): an outage, not an unregistered site.
    throw Object.assign(new Error(`Can't check this site's registration right now. Retry later. (${resp.status})`), { status: resp.status });
  }
  if (!resp.ok || !result) {
    const labels = {
      401: 'Your session has expired. Reopen the app.',
      403: 'You are not authorized for this workflow.',
    };
    const fallback = resp.status >= 500 ? 'The workflow backend is unavailable. Retry later.'
      : 'The workflow service returned an invalid response.';
    const label = labels[resp.status] || fallback;
    throw Object.assign(new Error(`${label} ${result?.error || ''} (${resp.status})`.trim()), { status: resp.status });
  }
  return result;
}

export async function getApproversForPath(org, site, path, token) {
  const url = `${getWorkerUrl()}/api/v2/approvers?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&path=${encodeURIComponent(path)}`;
  const resp = await fetch(url, getOpts(token, 'GET'));
  const { approvers = [], cc = [] } = await readWorkerResponse(resp);
  return [...approvers, ...cc];
}

/**
 * All pending requests the caller is authorized to approve.
 * @param {string} userEmail - Unused; the worker derives identity from the token.
 */
export async function getAllPendingRequestsForUser(org, site, userEmail, token) {
  const url = `${getWorkerUrl()}/api/v2/requests?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&role=approver`;
  const resp = await fetch(url, getOpts(token, 'GET'));
  const { requests } = await readWorkerResponse(resp);
  if (!Array.isArray(requests)) throw new Error('The workflow service returned an invalid request list.');
  return requests;
}

/**
 * All pending requests the caller submitted (their own queue).
 * @param {string} userEmail - Unused; the worker scopes by the token identity.
 */
export async function getAllPendingRequestsByRequester(org, site, userEmail, token) {
  const url = `${getWorkerUrl()}/api/v2/requests?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&role=requester`;
  const resp = await fetch(url, getOpts(token, 'GET'));
  const { requests } = await readWorkerResponse(resp);
  if (!Array.isArray(requests)) throw new Error('The workflow service returned an invalid request list.');
  return requests;
}

/**
 * The pending request at `path` if the caller can approve it, else null.
 * @returns {Promise<Object|null>}
 */
export async function checkPublishRequest(org, site, path, token) {
  const params = new URLSearchParams({
    org, site, role: 'page', path,
  });
  const resp = await fetch(`${getWorkerUrl()}/api/v2/requests?${params}`, getOpts(token));
  const { requests: pending } = await readWorkerResponse(resp);
  if (!Array.isArray(pending)) throw new Error('The workflow service returned an invalid request list.');
  return pending.find((r) => r.path === path && r.status === 'pending') || null;
}

/**
 * True when approving `request` completes the workflow and so must publish
 * first. Intermediate approvals only advance the step log.
 */
export function isFinalStep(request) {
  const info = request?.stepInfo;
  return request?.isFinal === true && Number.isInteger(info?.current)
    && info.current > 0 && !info.complete && request.canApproveNow !== false;
}

/**
 * Record approval of the step `paths` are waiting on. For the final step the
 * caller must publish first; intermediate steps publish nothing.
 * @param {number} [step] - The step the caller believes is current.
 * @returns {Promise<Object>} { success, approved, notFound, unauthorized, stale, completed }
 */
export async function approveRequests(org, site, paths, token, step, final = false) {
  if (!Number.isInteger(step) || step < 1) {
    return { success: false, error: 'Cannot determine the current step. Refresh before approving.' };
  }
  try {
    const body = { org, site, paths };
    body.step = step;
    if (final) body.final = true;
    const resp = await fetch(`${getWorkerUrl()}/api/v2/requests/approve`, getOpts(token, 'POST', body));
    const result = await resp.json();
    if (!resp.ok) {
      return {
        ...result, success: false, status: resp.status, error: result.error || 'Failed to record approval',
      };
    }
    const accepted = final ? result.completed || []
      : result.advanced || [];
    const denied = [
      ...(result.stale || []), ...(result.unauthorized || []), ...(result.notFound || []),
    ];
    const success = paths.every((path) => accepted.includes(path) && !denied.includes(path));
    return {
      ...result,
      success,
      error: success ? null : 'Some approvals were not recorded. Refresh to check conflicts, access, and request status.',
    };
  } catch (error) {
    console.error('Error recording approval:', error);
    return { success: false, error: error.message || 'An error occurred' };
  }
}

/**
 * Reject a pending request (sheet removal + author notification).
 * @returns {Promise<Object>} { success, error? }
 */
export async function rejectRequest(org, site, path, reason, token) {
  try {
    const resp = await fetch(`${getWorkerUrl()}/api/v2/requests/reject`, getOpts(token, 'POST', {
      org, site, path, reason,
    }));
    const result = await resp.json();
    if (!resp.ok) return { success: false, status: resp.status, error: result.error || 'Failed to reject request' };
    return { ...result, success: result.success === true };
  } catch (error) {
    console.error('Error rejecting request:', error);
    return { success: false, error: error.message || 'An error occurred' };
  }
}

/**
 * Withdraw the caller's own pending request.
 * @returns {Promise<Object>} { success, error? }
 */
export async function withdrawRequest(org, site, path, token) {
  try {
    const resp = await fetch(`${getWorkerUrl()}/api/v2/requests/withdraw`, getOpts(token, 'POST', { org, site, path }));
    const result = await resp.json();
    if (!resp.ok) return { success: false, status: resp.status, error: result.error || 'Failed to withdraw request' };
    return { ...result, success: result.success === true };
  } catch (error) {
    console.error('Error withdrawing request:', error);
    return { success: false, error: error.message || 'An error occurred' };
  }
}

const RECIPIENT_DOMAINS = 'recipient-domain-not-allowed';
const DOMAIN_HINT = 'A config admin can allow them under Registration in the Request Publish setup app.';

/**
 * The worker refuses a create or resend whose approver or CC domains aren't allowed for the site:
 * 403 with `code: recipient-domain-not-allowed` and `domains` (a worker without the code is known
 * by its message). Not a registration or setup problem. Returns the message to show, else null.
 */
export function recipientDomainError(status, result) {
  if (status !== 403) return null;
  if (result?.code !== RECIPIENT_DOMAINS && !/email domains are not allowed/i.test(result?.error || '')) return null;
  const domains = Array.isArray(result.domains) ? result.domains.filter((d) => typeof d === 'string' && d) : [];
  return domains.length
    ? `These approver or CC email domains aren't allowed for this site: ${domains.join(', ')}. ${DOMAIN_HINT}`
    : `Some approver or CC email domains aren't allowed for this site. ${DOMAIN_HINT}`;
}

/**
 * The warning for `emailErrors` on a successful change: the existing warning, plus the worker's
 * note naming refused recipient domains when it sends one. '' when there are none.
 */
export function emailWarning(emailErrors) {
  if (!Array.isArray(emailErrors) || !emailErrors.length) return '';
  const domains = emailErrors.filter((entry) => typeof entry === 'string' && /domains are not allowed/i.test(entry));
  return ['Some notification emails could not be sent.', ...new Set(domains)].join(' ');
}

/**
 * Re-send the approval email for an existing request (no sheet change).
 * @param {string} requesterEmail - Unused; the worker resolves approvers itself.
 * @returns {Promise<Object>} { success, message, approvers? }
 */
export async function resendPublishRequest(org, site, path, requesterEmail, token) {
  try {
    const resp = await fetch(`${getWorkerUrl()}/api/v2/requests`, getOpts(token, 'POST', {
      org, site, path, resend: true,
    }));
    const result = await resp.json();
    if (!resp.ok) {
      const domainError = recipientDomainError(resp.status, result);
      if (domainError) {
        return {
          success: false, status: resp.status, code: RECIPIENT_DOMAINS, error: domainError,
        };
      }
      return { success: false, status: resp.status, error: result.error || 'Failed to resend publish request' };
    }
    return { ...result, success: result.success === true };
  } catch (error) {
    console.error('Error resending publish request:', error);
    return { success: false, error: error.message || 'An error occurred' };
  }
}

/**
 * Fetch the current user's email from Adobe IMS profile (for display).
 * @param {string} token - The authorization token
 * @returns {Promise<string>} User email or empty string if unavailable
 */
export async function getUserEmail(token) {
  try {
    const resp = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return '';
    const profile = await resp.json();
    return profile?.email || '';
  } catch {
    console.warn('Could not fetch user profile');
    return '';
  }
}
