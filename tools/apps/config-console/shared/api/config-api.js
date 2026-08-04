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

    // Ensure library sheet exists
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

    // Add new entry at the beginning
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

      // Both are priority items - sort by priority order
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      // Only a is priority - a comes first
      if (aIndex !== -1) {
        return -1;
      }
      // Only b is priority - b comes first
      if (bIndex !== -1) {
        return 1;
      }
      // Neither is priority - maintain existing order
      return 0;
    });

    // Update counts
    config.library.total = config.library.data.length;
    config.library.limit = config.library.data.length;

    // Save config
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
