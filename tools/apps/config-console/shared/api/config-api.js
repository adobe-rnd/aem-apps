import { ADMIN_DA_LIVE_BASE } from '../constants.js';

/**
 * Fetch site configuration
 * @param {string} org
 * @param {string} site
 * @param {string} token - DA token
 * @returns {Promise<Object>}
 */
export async function fetchSiteConfig(org, site, token) {
  const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/${site}/config.json`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch site config: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch organization configuration
 * @param {string} org
 * @param {string} token - DA token
 * @returns {Promise<Object>}
 */
export async function fetchOrgConfig(org, token) {
  const url = `${ADMIN_DA_LIVE_BASE}/config/${org}.json`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch org config: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a config value from site config
 * @param {Object} config - Site config object
 * @param {string} key - Config key (e.g., 'aem.repositoryId')
 * @returns {string|null}
 */
function getConfigValue(config, key) {
  if (!config?.data?.data) return null;

  const entry = config.data.data.find((item) => item.key === key);
  return entry?.value || null;
}

/**
 * Fetch a config value with inheritance: check site, fall back to org
 * @param {string} org
 * @param {string} site - optional, if null fetches org-level only
 * @param {string} configKey - e.g., 'aem.repositoryId'
 * @param {string} token - DA token
 * @returns {Promise<{value: string|null, source: 'org'|'site'|null, inheritedValue: string|null}>}
 */
export async function fetchInheritedConfig(org, site, configKey, token) {
  let siteValue = null;
  let orgValue = null;

  // Try site-level first (if site provided)
  if (site) {
    const siteConfig = await fetchSiteConfig(org, site, token);
    siteValue = getConfigValue(siteConfig, configKey);
  }

  // Always fetch org-level (needed for inheritance display)
  const orgConfig = await fetchOrgConfig(org, token);
  orgValue = getConfigValue(orgConfig, configKey);

  // Determine source without nested ternary
  let source = null;
  if (siteValue) {
    source = 'site';
  } else if (orgValue) {
    source = 'org';
  }

  return {
    value: siteValue || orgValue || null,
    source,
    inheritedValue: orgValue,
  };
}

/**
 * Update site configuration value
 * @param {string} org
 * @param {string} site
 * @param {string} key - Config key
 * @param {string} value - Config value
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateSiteConfig(org, site, key, value, token) {
  try {
    const config = await fetchSiteConfig(org, site, token) || { data: { data: [] } };

    // Ensure data structure exists
    if (!config.data) config.data = {};
    if (!config.data.data) config.data.data = [];

    // Update or add the config entry
    const existingIndex = config.data.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.data.data[existingIndex].value = value;
    } else {
      config.data.data.push({ key, value });
    }

    // Update total and limit
    config.data.total = config.data.data.length;
    config.data.limit = config.data.data.length;

    // Save to DA
    const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/${site}/config.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to update site config: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update organization configuration value
 * @param {string} org
 * @param {string} key - Config key
 * @param {string} value - Config value
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateOrgConfig(org, key, value, token) {
  try {
    const config = await fetchOrgConfig(org, token) || { data: { data: [] } };

    // Ensure data structure exists
    if (!config.data) config.data = {};
    if (!config.data.data) config.data.data = [];

    // Update or add the config entry
    const existingIndex = config.data.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.data.data[existingIndex].value = value;
    } else {
      config.data.data.push({ key, value });
    }

    // Update total and limit
    config.data.total = config.data.data.length;
    config.data.limit = config.data.data.length;

    // Save to DA
    const url = `${ADMIN_DA_LIVE_BASE}/config/${org}.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to update org config: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a config value from site config (revert to org default)
 * @param {string} org
 * @param {string} site
 * @param {string} key - Config key to remove
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteSiteConfigValue(org, site, key, token) {
  try {
    const config = await fetchSiteConfig(org, site, token);
    if (!config?.data?.data) {
      return { success: true }; // Nothing to delete
    }

    // Remove the entry
    config.data.data = config.data.data.filter((item) => item.key !== key);

    // Update total and limit
    config.data.total = config.data.data.length;
    config.data.limit = config.data.data.length;

    // Save to DA
    const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/${site}/config.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete site config value: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
