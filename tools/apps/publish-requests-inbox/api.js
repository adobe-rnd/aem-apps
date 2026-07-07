/* eslint-disable import/no-unresolved, no-console, no-await-in-loop */

const WORKER_URL = 'https://publish-requests.aem-poc-lab.workers.dev';
const CI_WORKER_URL = 'https://publish-requests-ci.aem-poc-lab.workers.dev';
const LOCAL_WORKER_URL = 'http://localhost:8787';

const CORS_PROXY = 'https://da-etc.adobeaem.workers.dev/cors';

// daFetch ensures a fresh IMS token is used on every request (handles token expiry)
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

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
 * @param {Object} config - The workflow config returned by GET /api/config
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
 * Fetch per-customer accent color overrides from the workflow config (display).
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} token - Authorization token
 * @returns {Promise<{accentColor: string|null, accentColorHover: string|null}>}
 */
export async function fetchAccentSettings(org, site, token) {
  try {
    const url = `${getWorkerUrl()}/api/config?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
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
// Helix publish (admin.hlx.page — unchanged, runs under the user's session)
// ===========================================================================

/**
 * Publish content via Helix Admin API
 * POST https://admin.hlx.page/live/{org}/{site}/main/{path}
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} path - Content path
 * @returns {Promise<Object>} Result
 */
export async function publishContent(org, site, path) {
  try {
    // Ensure path starts with /
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    const publishUrl = `${CORS_PROXY}?url=https://admin.hlx.page/live/${org}/${site}/main${cleanPath}`;

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
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string[]} paths - Array of content paths to publish
 * @returns {Promise<Object>} Result with job info or error
 */
export async function bulkPublishContent(org, site, paths) {
  try {
    // Normalize paths — ensure each starts with /
    const cleanPaths = paths.map((p) => (p.startsWith('/') ? p : `/${p}`));

    const bulkUrl = `${CORS_PROXY}?url=https://admin.hlx.page/live/${org}/${site}/main/*`;

    const response = await daFetch(bulkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: cleanPaths }),
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
  const jobUrl = `${CORS_PROXY}?url=${encodeURIComponent(jobSelfUrl)}/details`;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const resp = await daFetch(jobUrl);

      if (!resp.ok) {
        console.warn('Job status check failed:', resp.status);
        break;
      }

      const job = await resp.json();
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

  return { success: false, error: 'Job polling timed out or encountered an error' };
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
export async function getApproversForPath(org, site, path, token) {
  const url = `${getWorkerUrl()}/api/approvers?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&path=${encodeURIComponent(path)}`;
  const resp = await fetch(url, getOpts(token, 'GET'));
  if (!resp.ok) return [];
  const { approvers = [], cc = [] } = await resp.json();
  return [...approvers, ...cc];
}

/**
 * All pending requests the caller is authorized to approve.
 * @param {string} userEmail - Unused; the worker derives identity from the token.
 */
export async function getAllPendingRequestsForUser(org, site, userEmail, token) {
  const url = `${getWorkerUrl()}/api/requests?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}`;
  const resp = await fetch(url, getOpts(token, 'GET'));
  if (!resp.ok) return [];
  const { requests = [] } = await resp.json();
  return requests;
}

/**
 * All pending requests the caller submitted (their own queue).
 * @param {string} userEmail - Unused; the worker scopes by the token identity.
 */
export async function getAllPendingRequestsByRequester(org, site, userEmail, token) {
  const url = `${getWorkerUrl()}/api/requests?org=${encodeURIComponent(org)}&site=${encodeURIComponent(site)}&role=requester`;
  const resp = await fetch(url, getOpts(token, 'GET'));
  if (!resp.ok) return [];
  const { requests = [] } = await resp.json();
  return requests;
}

/**
 * The pending request at `path` if the caller can approve it, else null.
 * @returns {Promise<Object|null>}
 */
export async function checkPublishRequest(org, site, path, token) {
  try {
    const pending = await getAllPendingRequestsForUser(org, site, null, token);
    return pending.find((r) => r.path === path && r.status === 'pending') || null;
  } catch (error) {
    console.error('Error checking publish request:', error);
    return null;
  }
}

/**
 * Record approval for already-published paths (sheet removal + author email).
 * The publish itself is done client-side via publishContent/bulkPublishContent.
 * @param {string[]} paths - Paths that were successfully published.
 * @returns {Promise<Object>} { success, approved, notFound, unauthorized }
 */
export async function approveRequests(org, site, paths, token) {
  try {
    const resp = await fetch(`${getWorkerUrl()}/api/requests/approve`, getOpts(token, 'POST', { org, site, paths }));
    const result = await resp.json();
    if (!resp.ok) return { success: false, error: result.error || 'Failed to record approval' };
    return { success: true, ...result };
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
    const resp = await fetch(`${getWorkerUrl()}/api/requests/reject`, getOpts(token, 'POST', {
      org, site, path, reason,
    }));
    const result = await resp.json();
    if (!resp.ok) return { success: false, error: result.error || 'Failed to reject request' };
    return { success: true };
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
    const resp = await fetch(`${getWorkerUrl()}/api/requests/withdraw`, getOpts(token, 'POST', { org, site, path }));
    const result = await resp.json();
    if (!resp.ok) return { success: false, error: result.error || 'Failed to withdraw request' };
    return { success: true };
  } catch (error) {
    console.error('Error withdrawing request:', error);
    return { success: false, error: error.message || 'An error occurred' };
  }
}

/**
 * Re-send the approval email for an existing request (no sheet change).
 * @param {string} requesterEmail - Unused; the worker resolves approvers itself.
 * @returns {Promise<Object>} { success, message, approvers? }
 */
export async function resendPublishRequest(org, site, path, requesterEmail, token) {
  try {
    const resp = await fetch(`${getWorkerUrl()}/api/requests`, getOpts(token, 'POST', {
      org, site, path, resend: true,
    }));
    const result = await resp.json();
    if (!resp.ok) return { success: false, error: result.error || 'Failed to resend publish request' };
    return { success: true };
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
