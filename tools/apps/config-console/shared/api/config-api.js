/* eslint-disable import/no-unresolved */
import { ADMIN_DA_LIVE_BASE } from '../constants.js';

// daFetch for token-refreshed requests
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

/**
 * Fetch site configuration
 * @param {string} org
 * @param {string} site
 * @param {string} token - DA token
 * @returns {Promise<Object>}
 */
export async function fetchSiteConfig(org, site, token) {
  const url = `${ADMIN_DA_LIVE_BASE}/config/${org}/${site}`;
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
  const url = `${ADMIN_DA_LIVE_BASE}/config/${org}`;
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
 * Fetch site translate configuration from .da/translate
 * @param {string} org
 * @param {string} site
 * @param {string} token - DA token
 * @returns {Promise<Object>}
 */
export async function fetchSiteTranslateConfig(org, site, token) {
  const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/${site}/.da/translate.json`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch site translate config: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch organization translate configuration from .da/translate
 * @param {string} org
 * @param {string} token - DA token
 * @returns {Promise<Object>}
 */
export async function fetchOrgTranslateConfig(org, token) {
  const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/.da/translate.json`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch org translate config: ${response.status}`);
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
 * Get a translate value from translate config (sheet name is "config", not "data")
 * @param {Object} config - Translate config object
 * @param {string} key - Translate key (e.g., 'translate.behavior')
 * @returns {string|null}
 */
function getTranslateValue(config, key) {
  if (!config?.config?.data) return null;

  const entry = config.config.data.find((item) => item.key === key);
  return entry?.value || null;
}

/**
 * Get a sheet's data from translate config
 * @param {Object} config - Translate config object
 * @param {string} sheetName - Sheet name (e.g., 'languages', 'custom-doc-rules')
 * @returns {Array}
 */
function getTranslateSheetData(config, sheetName) {
  if (!config?.[sheetName]?.data) return [];
  return config[sheetName].data;
}

/**
 * Get a flag value from flags sheet
 * @param {Object} config - Site/org config object
 * @param {string} key - Flag key (e.g., 'ew.enabled')
 * @returns {string|null}
 */
function getFlagValue(config, key) {
  if (!config?.flags?.data) return null;

  const entry = config.flags.data.find((item) => item.key === key);
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
 * Fetch a flag value with inheritance: check site flags, fall back to org flags
 * @param {string} org
 * @param {string} site - optional, if null fetches org-level only
 * @param {string} flagKey - e.g., 'ew.enabled'
 * @param {string} token - DA token
 * @returns {Promise<{value: string|null, source: 'org'|'site'|null, inheritedValue: string|null}>}
 */
export async function fetchInheritedFlag(org, site, flagKey, token) {
  let siteValue = null;
  let orgValue = null;

  // Try site-level first (if site provided)
  if (site) {
    const siteConfig = await fetchSiteConfig(org, site, token);
    siteValue = getFlagValue(siteConfig, flagKey);
  }

  // Always fetch org-level (needed for inheritance display)
  const orgConfig = await fetchOrgConfig(org, token);
  orgValue = getFlagValue(orgConfig, flagKey);

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
 * Fetch a translate value from .da/translate (site-level only, no org inheritance)
 * @param {string} org
 * @param {string} site - required for translate config
 * @param {string} translateKey - e.g., 'translate.behavior'
 * @param {string} token - DA token
 * @returns {Promise<{value: string|null, source: 'site'|null, inheritedValue: null}>}
 */
export async function fetchInheritedTranslate(org, site, translateKey, token) {
  if (!site) {
    // Translation is always at site level
    return {
      value: null,
      source: null,
      inheritedValue: null,
    };
  }

  const siteConfig = await fetchSiteTranslateConfig(org, site, token);
  const siteValue = getTranslateValue(siteConfig, translateKey);

  return {
    value: siteValue,
    source: siteValue ? 'site' : null,
    inheritedValue: null, // No org-level inheritance for translate
  };
}

/**
 * Fetch all translate sheets from .da/translate
 * @param {string} org
 * @param {string} site - required for translate config
 * @param {string} token - DA token
 * @returns {Promise<Object>} Object with all sheet data
 */
export async function fetchAllTranslateSheets(org, site, token) {
  if (!site) return null;

  const config = await fetchSiteTranslateConfig(org, site, token);
  if (!config) return null;

  return {
    languages: getTranslateSheetData(config, 'languages'),
    customDocRules: getTranslateSheetData(config, 'custom-doc-rules'),
    dntContentRules: getTranslateSheetData(config, 'dnt-content-rules'),
    dntSheetRules: getTranslateSheetData(config, 'dnt-sheet-rules'),
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

    if (!config.data) config.data = {};
    if (!config.data.data) config.data.data = [];

    const existingIndex = config.data.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.data.data[existingIndex].value = value;
    } else {
      config.data.data.push({ key, value });
    }

    config.data.total = config.data.data.length;
    config.data.limit = config.data.data.length;

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

    if (!config.data) config.data = {};
    if (!config.data.data) config.data.data = [];

    const existingIndex = config.data.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.data.data[existingIndex].value = value;
    } else {
      config.data.data.push({ key, value });
    }

    config.data.total = config.data.data.length;
    config.data.limit = config.data.data.length;

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
      return { success: true };
    }

    config.data.data = config.data.data.filter((item) => item.key !== key);

    config.data.total = config.data.data.length;
    config.data.limit = config.data.data.length;

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

/**
 * Update site flags value
 * @param {string} org
 * @param {string} site
 * @param {string} key - Flag key
 * @param {string} value - Flag value
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateSiteFlag(org, site, key, value, token) {
  try {
    // Fetch entire config to preserve all sheets
    const config = await fetchSiteConfig(org, site, token) || {
      ':version': 3,
      ':names': [],
      ':type': 'multi-sheet',
    };

    if (!config.flags) {
      if (!config[':names']) config[':names'] = [];
      if (!config[':names'].includes('flags')) {
        config[':names'].push('flags');
      }
      config.flags = { data: [] };
    }
    if (!config.flags.data) config.flags.data = [];

    const existingIndex = config.flags.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.flags.data[existingIndex].value = value;
    } else {
      config.flags.data.push({ key, value });
    }

    config.flags.total = config.flags.data.length;
    config.flags.limit = config.flags.data.length;

    // Save entire config to DA (preserves library and other sheets)
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
      throw new Error(`Failed to update site flags: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update organization flags value
 * @param {string} org
 * @param {string} key - Flag key
 * @param {string} value - Flag value
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateOrgFlag(org, key, value, token) {
  try {
    // Fetch entire config to preserve all sheets
    const config = await fetchOrgConfig(org, token) || {
      ':version': 3,
      ':names': [],
      ':type': 'multi-sheet',
    };

    if (!config.flags) {
      if (!config[':names']) config[':names'] = [];
      if (!config[':names'].includes('flags')) {
        config[':names'].push('flags');
      }
      config.flags = { data: [] };
    }
    if (!config.flags.data) config.flags.data = [];

    const existingIndex = config.flags.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.flags.data[existingIndex].value = value;
    } else {
      config.flags.data.push({ key, value });
    }

    config.flags.total = config.flags.data.length;
    config.flags.limit = config.flags.data.length;

    // Save entire config to DA (preserves other sheets)
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
      throw new Error(`Failed to update org flags: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a flag from site config (revert to org default)
 * @param {string} org
 * @param {string} site
 * @param {string} key - Flag key to remove
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteSiteFlag(org, site, key, token) {
  try {
    const config = await fetchSiteConfig(org, site, token);
    if (!config?.flags?.data) {
      return { success: true };
    }

    config.flags.data = config.flags.data.filter((item) => item.key !== key);

    config.flags.total = config.flags.data.length;
    config.flags.limit = config.flags.data.length;

    // Save entire config to DA
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
      throw new Error(`Failed to delete site flag: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update site translate configuration in .da/translate
 * @param {string} org
 * @param {string} site
 * @param {string} key - Translate key
 * @param {string} value - Translate value
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateSiteTranslate(org, site, key, value, token) {
  try {
    // Fetch entire translate config to preserve all sheets
    const existingConfig = await fetchSiteTranslateConfig(org, site, token);

    let config;
    if (existingConfig && existingConfig[':type'] === 'multi-sheet') {
      config = existingConfig;
    } else {
      config = {
        ':version': 3,
        ':type': 'multi-sheet',
        ':names': ['config'],
        config: { data: [] },
      };
    }

    if (!config[':names'].includes('config')) {
      config[':names'].push('config');
    }

    if (!config.config) {
      config.config = { data: [] };
    }
    if (!config.config.data) {
      config.config.data = [];
    }

    const existingIndex = config.config.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.config.data[existingIndex].value = value;
    } else {
      config.config.data.push({ key, value });
    }

    config.config.total = config.config.data.length;
    config.config.offset = 0;
    config.config.limit = config.config.data.length;

    // Save entire translate config to DA (preserves all sheets)
    const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/${site}/.da/translate.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config, null, 2),
    });

    if (!response.ok) {
      throw new Error(`Failed to update site translate config: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update organization translate configuration in .da/translate
 * @param {string} org
 * @param {string} key - Translate key
 * @param {string} value - Translate value
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateOrgTranslate(org, key, value, token) {
  try {
    const config = await fetchOrgTranslateConfig(org, token) || {
      config: { data: [] },
    };

    if (!config.config) config.config = {};
    if (!config.config.data) config.config.data = [];

    const existingIndex = config.config.data.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      config.config.data[existingIndex].value = value;
    } else {
      config.config.data.push({ key, value });
    }

    config.config.total = config.config.data.length;
    config.config.limit = config.config.data.length;

    // Save entire translate config to DA (preserves other keys)
    const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/.da/translate`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Failed to update org translate config: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update an entire sheet in translate config
 * @param {string} org
 * @param {string} site
 * @param {string} sheetName - Sheet name (e.g., 'languages', 'custom-doc-rules')
 * @param {Array} data - Array of row objects for the sheet
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateTranslateSheet(org, site, sheetName, data, token) {
  try {
    // Fetch entire translate config to preserve all sheets
    const existingConfig = await fetchSiteTranslateConfig(org, site, token);

    let config;
    if (existingConfig && existingConfig[':type'] === 'multi-sheet') {
      config = existingConfig;
    } else {
      // Create new multi-sheet structure if doesn't exist
      config = {
        ':version': 3,
        ':type': 'multi-sheet',
        ':names': [],
      };
    }

    if (!config[':names'].includes(sheetName)) {
      config[':names'].push(sheetName);
    }

    config[sheetName] = {
      total: data.length,
      offset: 0,
      limit: data.length,
      data,
    };

    // Save entire translate config to DA (preserves all other sheets)
    const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/${site}/.da/translate.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config, null, 2),
    });

    if (!response.ok) {
      throw new Error(`Failed to update translate sheet: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete site translate configuration value (revert to org default) from .da/translate
 * @param {string} org
 * @param {string} site
 * @param {string} key - Translate key to delete
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteSiteTranslate(org, site, key, token) {
  try {
    const config = await fetchSiteTranslateConfig(org, site, token);
    if (!config?.config?.data) {
      return { success: true };
    }

    config.config.data = config.config.data.filter((item) => item.key !== key);

    config.config.total = config.config.data.length;
    config.config.offset = 0;
    config.config.limit = config.config.data.length;

    // Save entire translate config to DA (preserves all other sheets)
    const url = `${ADMIN_DA_LIVE_BASE}/source/${org}/${site}/.da/translate.json`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(config, null, 2),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete site translate config: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetch library configuration from site config
 * @param {string} org
 * @param {string} site
 * @param {string} token - DA token
 * @returns {Promise<Object|null>} Returns config.library or null if not configured
 */
export async function fetchLibraryConfig(org, site, token) {
  const url = `${ADMIN_DA_LIVE_BASE}/config/${org}/${site}`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`Failed to fetch site config: ${response.status}`);
  }

  const config = await response.json();
  const libraryConfig = config?.library || null;
  return libraryConfig;
}

/**
 * Get a specific library entry by title (case-insensitive)
 * @param {Object} libraryConfig - Library config object (config.library)
 * @param {string} title - Library entry title (Blocks, Templates, Icons, Placeholders)
 * @returns {Object|null} Library entry with title, path, format, ref, icon, experience
 */
export function getLibraryEntry(libraryConfig, title) {
  if (!libraryConfig?.data) return null;

  const normalizedTitle = title.toLowerCase();
  return libraryConfig.data.find(
    (item) => item.title?.toLowerCase() === normalizedTitle,
  ) || null;
}

/**
 * Get the path URL for a specific library type
 * @param {string} org
 * @param {string} site
 * @param {string} libraryType - 'Blocks', 'Templates', 'Icons', or 'Placeholders'
 * @param {string} token - DA token
 * @returns {Promise<string|null>} Full URL to the JSON file, or null if not configured
 */
export async function getLibraryPath(org, site, libraryType, token) {
  const libraryConfig = await fetchLibraryConfig(org, site, token);
  const entry = getLibraryEntry(libraryConfig, libraryType);
  return entry?.path || null;
}

/**
 * Check if library is configured for this site
 * @param {string} org
 * @param {string} site
 * @param {string} token - DA token
 * @returns {Promise<boolean>}
 */
export async function hasLibraryConfig(org, site, token) {
  const libraryConfig = await fetchLibraryConfig(org, site, token);
  return !!(libraryConfig?.data && libraryConfig.data.length > 0);
}

/**
 * Update the entire site config structure
 * @param {string} org
 * @param {string} site
 * @param {Object} config - Full config object
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateFullSiteConfig(org, site, config, token) {
  const url = `${ADMIN_DA_LIVE_BASE}/config/${org}/${site}`;

  try {
    const formData = new FormData();
    formData.append('config', JSON.stringify(config));

    const response = await fetch(url, {
      method: 'PUT',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update config: ${response.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Extract base path from a library entry path
 * e.g., 'https://content.da.live/org/site/library/blocks.json' -> 'library'
 * e.g., 'org/site/docs/library/icons.json' -> 'docs/library'
 */
function extractBasePath(path) {
  if (!path) return null;

  try {
    // Remove protocol and domain if present
    const cleanPath = path.replace(/^https?:\/\/[^/]+\/?/, '');
    // Split by / and find the library base
    const parts = cleanPath.split('/').filter(Boolean);

    // Find 'library' or pattern like 'docs/library'
    const libraryIndex = parts.findIndex((p) => p === 'library');
    if (libraryIndex === -1) return null;

    // Get everything from org/site up to and including 'library'
    // Skip org/site (first 2 parts)
    const baseParts = parts.slice(2, libraryIndex + 1);
    return baseParts.join('/');
  } catch (error) {
    return null;
  }
}

/**
 * Detect base path from existing library entries
 * @param {string} org
 * @param {string} site
 * @param {string} token
 * @returns {Promise<string|null>} Base path like 'library' or 'docs/library'
 */
export async function detectLibraryBasePath(org, site, token) {
  const libraryConfig = await fetchLibraryConfig(org, site, token);
  if (!libraryConfig?.data) return null;

  // Check existing entries for base path
  const types = ['Blocks', 'Templates', 'Icons', 'Placeholders'];
  const foundPath = types.reduce((result, type) => {
    if (result) return result;
    const entry = getLibraryEntry(libraryConfig, type);
    if (entry?.path) {
      const basePath = extractBasePath(entry.path);
      if (basePath) return basePath;
    }
    return null;
  }, null);

  return foundPath;
}

/**
 * Get suggested library paths for a type with smart defaults
 * Returns relative paths only (e.g., 'library' or 'docs/library')
 * @param {string} org
 * @param {string} site
 * @param {string} libraryType - 'Blocks', 'Templates', 'Icons', or 'Placeholders'
 * @param {string} token
 * @returns {Promise<{suggested: string, options: string[], detected: boolean}>}
 */
export async function getSuggestedLibraryPaths(org, site, libraryType, token) {
  const detectedBase = await detectLibraryBasePath(org, site, token);

  // Build options as relative paths (no filename)
  const options = [];

  if (detectedBase) {
    // Use detected base as first option
    options.push(detectedBase);
  } else {
    // Default options
    options.push('library');
  }

  // Always offer docs/library as alternative
  if (detectedBase !== 'docs/library') {
    options.push('docs/library');
  }

  return {
    suggested: options[0],
    options,
    detected: !!detectedBase, // true if we detected an existing library
  };
}

/**
 * Register a library type in site config (preserving existing entries)
 * @param {string} org
 * @param {string} site
 * @param {string} libraryType - 'Blocks', 'Templates', 'Icons', or 'Placeholders'
 * @param {string} relativePath - Relative path like 'library', '/library', or '/docs/library'
 * @param {string} token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function registerLibraryType(org, site, libraryType, relativePath, token) {
  try {
    // Normalize relative path - ensure it starts with / and has no trailing slash
    let normalizedPath = relativePath.trim();
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = `/${normalizedPath}`;
    }
    normalizedPath = normalizedPath.replace(/\/+$/, ''); // Remove trailing slashes
    normalizedPath = normalizedPath.replace(/^\/+/, ''); // Remove leading slash for URL construction

    // Construct full URL with filename
    const filename = `${libraryType.toLowerCase()}.json`;
    const fullPath = `https://content.da.live/${org}/${site}/${normalizedPath}/${filename}`;

    // Fetch entire site config
    const url = `${ADMIN_DA_LIVE_BASE}/config/${org}/${site}`;
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    let config;
    if (response.ok) {
      config = await response.json();
    } else if (response.status === 404) {
      // Create new config with library sheet
      config = {
        ':version': 3,
        ':names': ['library'],
        ':type': 'multi-sheet',
        library: {
          total: 0,
          limit: 0,
          offset: 0,
          data: [],
        },
      };
    } else {
      throw new Error(`Failed to fetch config: ${response.status}`);
    }

    if (!config.library) {
      if (!config[':names']) config[':names'] = [];
      if (!config[':names'].includes('library')) {
        config[':names'].push('library');
      }
      config.library = {
        total: 0,
        limit: 0,
        offset: 0,
        data: [],
      };
    }

    if (!config.library.data) {
      config.library.data = [];
    }

    // Remove existing entry if found (case-insensitive)
    const normalizedType = libraryType.toLowerCase();
    config.library.data = config.library.data.filter(
      (item) => item.title?.toLowerCase() !== normalizedType,
    );

    config.library.data.unshift({
      title: libraryType,
      path: fullPath,
    });

    // Sort to ensure Blocks, Templates, Icons, Placeholders are always at the top in that order
    const priorityOrder = ['blocks', 'templates', 'icons', 'placeholders'];
    config.library.data.sort((a, b) => {
      const aTitle = a.title?.toLowerCase() || '';
      const bTitle = b.title?.toLowerCase() || '';
      const aIndex = priorityOrder.indexOf(aTitle);
      const bIndex = priorityOrder.indexOf(bTitle);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      if (aIndex !== -1) {
        return -1;
      }
      if (bIndex !== -1) {
        return 1;
      }
      return 0;
    });

    config.library.total = config.library.data.length;
    config.library.limit = config.library.data.length;

    return updateFullSiteConfig(org, site, config, token);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Resolve library path for writing - from config only (no fallbacks)
 * @param {string} org
 * @param {string} site
 * @param {string} libraryType
 * @param {string} token
 * @returns {Promise<string|null>} Path for writing, or null if not configured
 */
async function resolveLibraryPathForWrite(org, site, libraryType, token) {
  const configuredPath = await getLibraryPath(org, site, libraryType, token);

  if (!configuredPath) {
    return null;
  }

  // Extract path from URL (e.g., https://content.da.live/org/site/library/blocks.json -> org/site/library/blocks.json)
  try {
    const url = new URL(configuredPath);
    return url.pathname.replace(/^\//, '');
  } catch (error) {
    // If already a path without protocol, use as-is
    return configuredPath.replace(/^\//, '');
  }
}

/**
 * Update blocks.json - resolves path from library config first
 * @param {string} org
 * @param {string} site
 * @param {Object} blocksData - Blocks JSON data
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string, path?: string}>}
 */
export async function updateBlocksJSON(org, site, blocksData, token) {
  try {
    const path = await resolveLibraryPathForWrite(org, site, 'Blocks', token);

    if (!path) {
      return {
        success: false,
        error: 'Library not configured. Please set up Blocks in site config library sheet first.',
      };
    }

    const url = `${ADMIN_DA_LIVE_BASE}/source/${path}`;

    const formData = new FormData();
    const blob = new Blob([JSON.stringify(blocksData)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update blocks.json: ${response.status}`);
    }

    return { success: true, path };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update templates.json - resolves path from library config first
 * @param {string} org
 * @param {string} site
 * @param {Object} templatesData - Templates JSON data
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string, path?: string}>}
 */
export async function updateTemplatesJSON(org, site, templatesData, token) {
  try {
    const path = await resolveLibraryPathForWrite(org, site, 'Templates', token);

    if (!path) {
      return {
        success: false,
        error: 'Library not configured. Please set up Templates in site config library sheet first.',
      };
    }

    const url = `${ADMIN_DA_LIVE_BASE}/source/${path}`;

    const formData = new FormData();
    const blob = new Blob([JSON.stringify(templatesData)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update templates.json: ${response.status}`);
    }

    return { success: true, path };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update icons.json - resolves path from library config first
 * @param {string} org
 * @param {string} site
 * @param {Object} iconsData - Icons JSON data
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string, path?: string}>}
 */
export async function updateIconsJSON(org, site, iconsData, token) {
  try {
    const path = await resolveLibraryPathForWrite(org, site, 'Icons', token);

    if (!path) {
      return {
        success: false,
        error: 'Library not configured. Please set up Icons in site config library sheet first.',
      };
    }

    const url = `${ADMIN_DA_LIVE_BASE}/source/${path}`;

    const formData = new FormData();
    const blob = new Blob([JSON.stringify(iconsData)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update icons.json: ${response.status}`);
    }

    return { success: true, path };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update placeholders.json - resolves path from library config first
 * @param {string} org
 * @param {string} site
 * @param {Object} placeholdersData - Placeholders JSON data
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string, path?: string}>}
 */
export async function updatePlaceholdersJSON(org, site, placeholdersData, token) {
  try {
    const path = await resolveLibraryPathForWrite(org, site, 'Placeholders', token);

    if (!path) {
      return {
        success: false,
        error: 'Library not configured. Please set up Placeholders in site config library sheet first.',
      };
    }

    const url = `${ADMIN_DA_LIVE_BASE}/source/${path}`;

    const formData = new FormData();
    const blob = new Blob([JSON.stringify(placeholdersData)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update placeholders.json: ${response.status}`);
    }

    return { success: true, path };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetch MSM (Multi-Site Manager) config from organization
 * @param {string} org
 * @param {string} token - DA token
 * @returns {Promise<Array>} MSM config data array with base, satellite, title
 */
export async function fetchMSMConfig(org, token) {
  try {
    const url = `${ADMIN_DA_LIVE_BASE}/config/${org}`;
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`Failed to fetch MSM config: ${response.status}`);
    }

    const config = await response.json();
    return config?.msm?.data || [];
  } catch (error) {
    throw new Error(`Failed to fetch MSM config: ${error.message}`);
  }
}

/**
 * Update MSM (Multi-Site Manager) config
 * @param {string} org
 * @param {Array} msmData - Array of MSM entries with base, satellite, title
 * @param {string} token - DA token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateMSMConfig(org, msmData, token) {
  try {
    const url = `${ADMIN_DA_LIVE_BASE}/config/${org}`;

    // Fetch existing config
    let config;
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (response.ok) {
      config = await response.json();
    } else if (response.status === 404) {
      // Create new config structure
      config = {
        ':version': 3,
        ':names': ['msm'],
        ':type': 'multi-sheet',
        msm: {
          total: 0,
          limit: 0,
          offset: 0,
          data: [],
        },
      };
    } else {
      throw new Error(`Failed to fetch config: ${response.status}`);
    }

    // If msmData is empty, remove the MSM sheet entirely
    if (msmData.length === 0) {
      if (config[':names']) {
        config[':names'] = config[':names'].filter((name) => name !== 'msm');
      }
      delete config.msm;
    } else {
      if (!config.msm) {
        if (!config[':names']) config[':names'] = [];
        if (!config[':names'].includes('msm')) {
          config[':names'].push('msm');
        }
        config.msm = {
          total: 0,
          limit: 0,
          offset: 0,
          data: [],
        };
      }

      config.msm.data = msmData;
      config.msm.total = msmData.length;
      config.msm.limit = msmData.length;
    }
    const formData = new FormData();
    formData.append('config', JSON.stringify(config));

    const updateResponse = await fetch(url, {
      method: 'PUT',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!updateResponse.ok) {
      throw new Error(`Failed to update MSM config: ${updateResponse.status}`);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Parse editor path value format: "path=url"
 * @param {string} value - Editor path value
 * @returns {{path: string, editorUrl: string}|null}
 */
function parseEditorPathValue(value) {
  if (!value || typeof value !== 'string') return null;
  const separatorIndex = value.indexOf('=');
  if (separatorIndex === -1) return null;
  return {
    path: value.substring(0, separatorIndex),
    editorUrl: value.substring(separatorIndex + 1),
  };
}

/**
 * Format editor path value: "path=url"
 * @param {string} path - Folder path
 * @param {string} editorUrl - Editor URL
 * @returns {string}
 */
function formatEditorPathValue(path, editorUrl) {
  return `${path}=${editorUrl}`;
}

/**
 * Fetch all editor.path entries from org and site config
 * @param {string} org
 * @param {string} site - Optional, if provided includes site-level paths
 * @param {string} token
 * @returns {Promise<Array>} Array of {path, editorUrl, source}
 */
export async function fetchAllEditorPaths(org, site, token) {
  const paths = [];

  const orgConfig = await fetchOrgConfig(org, token);
  if (orgConfig?.data?.data) {
    const orgPaths = orgConfig.data.data
      .filter((item) => item.key === 'editor.path')
      .map((item) => {
        const parsed = parseEditorPathValue(item.value);
        return parsed ? { ...parsed, source: 'org' } : null;
      })
      .filter(Boolean);
    paths.push(...orgPaths);
  }

  if (site) {
    const siteConfig = await fetchSiteConfig(org, site, token);
    if (siteConfig?.data?.data) {
      const sitePaths = siteConfig.data.data
        .filter((item) => item.key === 'editor.path')
        .map((item) => {
          const parsed = parseEditorPathValue(item.value);
          return parsed ? { ...parsed, source: 'site' } : null;
        })
        .filter(Boolean);
      paths.push(...sitePaths);
    }
  }

  return paths;
}

/**
 * Add new editor.path entry
 * @param {string} org
 * @param {string} site - Optional, if provided adds to site config
 * @param {string} path - Folder path
 * @param {string} editorUrl - Editor URL
 * @param {string} token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function addEditorPath(org, site, path, editorUrl, token) {
  try {
    const value = formatEditorPathValue(path, editorUrl);

    if (site) {
      const config = await fetchSiteConfig(org, site, token) || { data: { data: [] } };
      if (!config.data) config.data = {};
      if (!config.data.data) config.data.data = [];

      config.data.data.push({ key: 'editor.path', value });

      config.data.total = config.data.data.length;
      config.data.limit = config.data.data.length;

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
        throw new Error(`Failed to add editor path: ${response.status}`);
      }
    } else {
      const config = await fetchOrgConfig(org, token) || { data: { data: [] } };
      if (!config.data) config.data = {};
      if (!config.data.data) config.data.data = [];

      config.data.data.push({ key: 'editor.path', value });

      config.data.total = config.data.data.length;
      config.data.limit = config.data.data.length;

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
        throw new Error(`Failed to add editor path: ${response.status}`);
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update existing editor.path entry (identified by old path)
 * @param {string} org
 * @param {string} site - Optional, if provided updates site config
 * @param {string} oldPath - Current folder path to find
 * @param {string} newPath - New folder path
 * @param {string} editorUrl - New editor URL
 * @param {string} token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateEditorPath(org, site, oldPath, newPath, editorUrl, token) {
  try {
    const newValue = formatEditorPathValue(newPath, editorUrl);

    if (site) {
      const config = await fetchSiteConfig(org, site, token);
      if (!config?.data?.data) {
        return { success: false, error: 'Config not found' };
      }

      const entryIndex = config.data.data.findIndex((item) => {
        if (item.key !== 'editor.path') return false;
        const parsed = parseEditorPathValue(item.value);
        return parsed && parsed.path === oldPath;
      });

      if (entryIndex === -1) {
        return { success: false, error: 'Editor path not found' };
      }

      config.data.data[entryIndex].value = newValue;

      config.data.total = config.data.data.length;
      config.data.limit = config.data.data.length;

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
        throw new Error(`Failed to update editor path: ${response.status}`);
      }
    } else {
      const config = await fetchOrgConfig(org, token);
      if (!config?.data?.data) {
        return { success: false, error: 'Config not found' };
      }

      const entryIndex = config.data.data.findIndex((item) => {
        if (item.key !== 'editor.path') return false;
        const parsed = parseEditorPathValue(item.value);
        return parsed && parsed.path === oldPath;
      });

      if (entryIndex === -1) {
        return { success: false, error: 'Editor path not found' };
      }

      config.data.data[entryIndex].value = newValue;

      config.data.total = config.data.data.length;
      config.data.limit = config.data.data.length;

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
        throw new Error(`Failed to update editor path: ${response.status}`);
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete editor.path entry (identified by path)
 * @param {string} org
 * @param {string} site - Optional, if provided deletes from site config
 * @param {string} path - Folder path to remove
 * @param {string} token
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteEditorPath(org, site, path, token) {
  try {
    if (site) {
      const config = await fetchSiteConfig(org, site, token);
      if (!config?.data?.data) {
        return { success: true };
      }

      config.data.data = config.data.data.filter((item) => {
        if (item.key !== 'editor.path') return true;
        const parsed = parseEditorPathValue(item.value);
        return !parsed || parsed.path !== path;
      });

      config.data.total = config.data.data.length;
      config.data.limit = config.data.data.length;

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
        throw new Error(`Failed to delete editor path: ${response.status}`);
      }
    } else {
      const config = await fetchOrgConfig(org, token);
      if (!config?.data?.data) {
        return { success: true };
      }

      config.data.data = config.data.data.filter((item) => {
        if (item.key !== 'editor.path') return true;
        const parsed = parseEditorPathValue(item.value);
        return !parsed || parsed.path !== path;
      });

      config.data.total = config.data.data.length;
      config.data.limit = config.data.data.length;

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
        throw new Error(`Failed to delete editor path: ${response.status}`);
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetch list of sites in an organization
 * @param {string} org - Organization name
 * @returns {Promise<Array<string>>} Array of site names
 */
export async function fetchSiteList(org) {
  try {
    const response = await daFetch(`${ADMIN_DA_LIVE_BASE}/list/${org}/`);
    if (!response.ok) return [];
    const items = await response.json();
    if (!Array.isArray(items)) return [];
    return items.filter((item) => !item.ext).map((item) => item.name);
  } catch {
    return [];
  }
}
