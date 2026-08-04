/**
 * Shared API utilities for library items (templates, icons, placeholders)
 */

// External imports from da.live CDN - unresolved at lint time
/* eslint-disable import/no-unresolved */

import { getLibraryPath } from './config-api.js';
import { uploadTemplateDoc } from '../utils/da-api.js';

// Use DA's daFetch which automatically handles IMS tokens
const { daFetch: daFetchUtil } = await import('https://da.live/nx/utils/daFetch.js');
const DA_ADMIN = 'https://admin.da.live';

// Wrapper for daFetch
async function daFetch(url, options = {}) {
  return daFetchUtil(url, options);
}

/**
 * Normalize identifier for comparison
 * @param {string} str - String to normalize
 * @returns {string}
 */
export function normalizeIdentifier(str) {
  return str.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Merge new items with existing items, avoiding duplicates
 * @param {Array} existingItems - Existing items
 * @param {Array} newItems - New items to merge
 * @param {string} identifierKey - Key to use for identification
 * @returns {Object}
 */
export function mergeLibraryItems(existingItems, newItems, identifierKey) {
  if (!existingItems || existingItems.length === 0) {
    return {
      merged: newItems,
      added: newItems.length,
      skipped: 0,
      existing: 0,
    };
  }

  const existingMap = new Map(
    existingItems.map((item) => [
      normalizeIdentifier(item[identifierKey]),
      item,
    ]),
  );

  const newItemsSet = new Set(
    newItems.map((item) => normalizeIdentifier(item[identifierKey])),
  );

  // Keep existing items that are NOT being updated
  const preserved = existingItems.filter(
    (item) => !newItemsSet.has(normalizeIdentifier(item[identifierKey])),
  );

  // Find truly new items (don't exist yet)
  const itemsToAdd = newItems.filter(
    (item) => !existingMap.has(normalizeIdentifier(item[identifierKey])),
  );

  // Find items being updated (exist in both) - use new version
  const itemsToUpdate = newItems.filter(
    (item) => existingMap.has(normalizeIdentifier(item[identifierKey])),
  );

  return {
    merged: [...preserved, ...itemsToUpdate, ...itemsToAdd],
    added: itemsToAdd.length,
    skipped: 0, // We update instead of skip
    updated: itemsToUpdate.length,
    existing: existingItems.length,
  };
}

/**
 * Convert sheet JSON response to data array
 * @param {Object} json - Sheet JSON
 * @returns {Array}
 */
export function getSheetDataArray(json) {
  if (!json) return [];
  return json.data || [];
}

/**
 * Fetch library item JSON (generic)
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} type - Type (templates, icons, placeholders)
 * @param {string} token - Auth token
 * @returns {Promise<Object|null>}
 */
export async function fetchLibraryJSON(org, site, type, token) {
  // Use library path from config
  const libraryPath = await getLibraryPath(org, site, type, token);

  if (!libraryPath) {
    // No library path configured - return null
    return null;
  }

  // Extract path from URL (e.g., https://content.da.live/org/site/library/templates.json -> org/site/library/templates.json)
  let pathForRead;
  try {
    const urlObj = new URL(libraryPath);
    pathForRead = urlObj.pathname.replace(/^\//, '');
  } catch (error) {
    // If already a path without protocol, use as-is
    pathForRead = libraryPath.replace(/^\//, '');
  }

  const url = `${DA_ADMIN}/source/${pathForRead}`;

  try {
    const response = await daFetch(url, {});

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${type}.json: ${response.status}`);
    }

    return response.json();
  } catch {
    // Fetch failed - return null
    return null;
  }
}

/**
 * Update library item JSON (generic)
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} type - Type (templates, icons, placeholders)
 * @param {Object} config - Configuration object
 * @param {string} token - Auth token
 * @returns {Promise<Object>}
 */
export async function updateLibraryJSON(org, site, type, config, token) {
  // Use library path from config
  const libraryPath = await getLibraryPath(org, site, type, token);

  if (!libraryPath) {
    throw new Error(`No library path configured for ${type}`);
  }

  // Extract path from URL (e.g., https://content.da.live/org/site/library/templates.json -> org/site/library/templates.json)
  let pathForWrite;
  try {
    const urlObj = new URL(libraryPath);
    pathForWrite = urlObj.pathname.replace(/^\//, '');
  } catch (error) {
    // If already a path without protocol, use as-is
    pathForWrite = libraryPath.replace(/^\//, '');
  }

  const url = `${DA_ADMIN}/source/${pathForWrite}`;

  try {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await daFetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update ${type}.json: ${response.status}`);
    }

    return {
      success: true,
      error: null,
      status: response.status,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[updateLibraryJSON] Error writing ${type}.json:`, error);
    return {
      success: false,
      error: error.message,
      status: error.status || 500,
    };
  }
}

/**
 * Remove library item
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {string} type - Type (templates, icons, placeholders)
 * @param {string} itemKey - Item key to remove
 * @param {string} token - Auth token
 * @returns {Promise<Object>}
 */
export async function removeLibraryItem(org, site, type, itemKey, token) {
  const existingJSON = await fetchLibraryJSON(org, site, type, token);
  const existingData = getSheetDataArray(existingJSON);
  const targetId = normalizeIdentifier(itemKey);

  const merged = existingData.filter(
    (item) => normalizeIdentifier(item.key) !== targetId,
  );

  if (merged.length === existingData.length) {
    return { success: true, removed: false };
  }

  const libraryJSON = {
    ':version': 3,
    ':type': 'sheet',
    total: merged.length,
    limit: merged.length,
    offset: 0,
    data: merged,
  };

  const updateResult = await updateLibraryJSON(org, site, type, libraryJSON, token);
  return { ...updateResult, removed: true };
}

/**
 * Update templates JSON
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {Array} templates - Templates to add/update (each with name and path)
 * @param {string} token - Auth token
 * @returns {Promise<Object>}
 */
export async function updateTemplates(org, site, templates, token) {
  const existingJSON = await fetchLibraryJSON(org, site, 'templates', token);
  const existingData = getSheetDataArray(existingJSON);

  // Process templates: copy source files to templates folder with kebab-case names
  const normalizedNew = await Promise.all(templates.map(async (template) => {
    // Convert template name to kebab-case (e.g., "Home Page" -> "home")
    const kebabName = normalizeIdentifier(template.name);

    // Remove .html extension and leading slash from source path
    let sourcePath = template.path.replace(/\.html$/, '');
    if (!sourcePath.startsWith('/')) {
      sourcePath = `/${sourcePath}`;
    }

    // Copy the source file to library/templates/{kebab-name}.html
    const uploadResult = await uploadTemplateDoc(org, site, kebabName, sourcePath);

    if (!uploadResult.success) {
      throw new Error(`Failed to copy template "${template.name}": ${uploadResult.error}`);
    }

    // Use the copied file path (e.g., /library/templates/home.html)
    const copiedPath = uploadResult.path.replace(/\.html$/, '');

    return {
      key: template.name,
      value: `https://content.da.live${copiedPath}`,
    };
  }));

  const mergeResult = mergeLibraryItems(existingData, normalizedNew, 'key');

  const templatesJSON = {
    ':version': 3,
    ':type': 'sheet',
    total: mergeResult.merged.length,
    limit: mergeResult.merged.length,
    offset: 0,
    data: mergeResult.merged,
  };

  const updateResult = await updateLibraryJSON(org, site, 'templates', templatesJSON, token);

  return {
    ...updateResult,
    stats: {
      added: mergeResult.added,
      skipped: mergeResult.skipped,
      existing: mergeResult.existing,
      total: mergeResult.merged.length,
    },
  };
}

/**
 * Update icons JSON
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {Array} icons - Icons to add/update (each with name and path)
 * @param {string} token - Auth token
 * @returns {Promise<Object>}
 */
export async function updateIcons(org, site, icons, token) {
  const existingJSON = await fetchLibraryJSON(org, site, 'icons', token);
  const existingData = getSheetDataArray(existingJSON);

  // Icons are referenced directly from /icons path (not copied)
  const normalizedNew = icons.map((icon) => {
    let iconPath = icon.path;

    if (iconPath.startsWith('https://')) {
      return {
        key: icon.name,
        icon: iconPath,
      };
    }

    const orgSitePrefix = `/${org}/${site}`;
    if (iconPath.startsWith(orgSitePrefix)) {
      iconPath = iconPath.substring(orgSitePrefix.length);
    }

    return {
      key: icon.name,
      icon: `https://content.da.live/${org}/${site}${iconPath}`,
    };
  });

  const mergeResult = mergeLibraryItems(existingData, normalizedNew, 'key');

  const iconsJSON = {
    ':version': 3,
    ':type': 'sheet',
    total: mergeResult.merged.length,
    limit: mergeResult.merged.length,
    offset: 0,
    data: mergeResult.merged,
  };

  const updateResult = await updateLibraryJSON(org, site, 'icons', iconsJSON, token);

  return {
    ...updateResult,
    stats: {
      added: mergeResult.added,
      skipped: mergeResult.skipped,
      existing: mergeResult.existing,
      total: mergeResult.merged.length,
    },
  };
}

/**
 * Update placeholders JSON
 * @param {string} org - Organization
 * @param {string} site - Site
 * @param {Array} placeholders - Placeholders to add/update
 * @param {string} token - Auth token
 * @returns {Promise<Object>}
 */
export async function updatePlaceholders(org, site, placeholders, token) {
  const existingJSON = await fetchLibraryJSON(org, site, 'placeholders', token);
  const existingData = getSheetDataArray(existingJSON);

  const normalizedNew = placeholders.map((p) => ({
    key: p.value,
    value: p.key,
  }));

  const mergeResult = mergeLibraryItems(existingData, normalizedNew, 'value');

  const placeholdersJSON = {
    ':version': 3,
    ':type': 'sheet',
    total: mergeResult.merged.length,
    limit: mergeResult.merged.length,
    offset: 0,
    data: mergeResult.merged,
  };

  const updateResult = await updateLibraryJSON(org, site, 'placeholders', placeholdersJSON, token);

  return {
    ...updateResult,
    stats: {
      added: mergeResult.added,
      skipped: mergeResult.skipped,
      existing: mergeResult.existing,
      total: mergeResult.merged.length,
    },
  };
}
