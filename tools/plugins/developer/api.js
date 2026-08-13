/* eslint-disable no-console, import/prefer-default-export */

const ADMIN_API = 'https://api.aem.live';

// Branches don't change often; cache the list in sessionStorage for a
// short time so switching branches (which reloads the page) doesn't
// trigger an immediate refetch.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY_PREFIX = 'da-developer-branches';

function getCacheKey(org, site) {
  return `${CACHE_KEY_PREFIX}:${org}/${site}`;
}

function readCache(org, site) {
  try {
    const raw = sessionStorage.getItem(getCacheKey(org, site));
    if (!raw) return null;
    const { branches, timestamp } = JSON.parse(raw);
    if (!Array.isArray(branches) || Date.now() - timestamp > CACHE_TTL_MS) return null;
    return branches;
  } catch {
    return null;
  }
}

function writeCache(org, site, branches) {
  try {
    const value = JSON.stringify({ branches, timestamp: Date.now() });
    sessionStorage.setItem(getCacheKey(org, site), value);
  } catch {
    // sessionStorage unavailable or full — caching is a non-essential optimization
  }
}

/**
 * Fetch the list of code branches for a site from the EDS admin API.
 * Results are cached in sessionStorage for `CACHE_TTL_MS` to avoid
 * refetching right after a branch switch reloads the page.
 * @param {string} org - Organization (owner)
 * @param {string} site - Site (repo)
 * @param {string} token - IMS bearer token
 * @returns {Promise<{branches: string[], error: string|null}>}
 */
export async function fetchBranches(org, site, token) {
  const cached = readCache(org, site);
  if (cached) {
    return { branches: cached, error: null };
  }

  try {
    const response = await fetch(`${ADMIN_API}/${org}/repos/${site}/code/`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      return { branches: [], error: 'unauthorized' };
    }
    if (response.status === 404) {
      return { branches: [], error: 'not-found' };
    }
    if (!response.ok) {
      return { branches: [], error: `http-${response.status}` };
    }

    const { branches = [] } = await response.json();
    // Each entry is a path like /{owner}/repos/{repo}/code/{branch}/ — the
    // branch name is the final segment, after stripping any trailing slash.
    const names = branches
      .map((path) => path.replace(/\/$/, '').split('/').pop())
      .filter(Boolean);
    writeCache(org, site, names);
    return { branches: names, error: null };
  } catch (error) {
    console.error('Error fetching branches:', error);
    return { branches: [], error: 'network' };
  }
}
