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
/* eslint-disable import/no-unresolved */

const { getDaAdmin } = await import('https://da.live/nx/public/utils/constants.js');
const DA_ADMIN = getDaAdmin();
const { daFetch } = await import('https://da.live/nx/utils/daFetch.js');

/**
 * Fetch site-level configuration from DA
 * @param {string} org - Organization
 * @param {string} site - Site name
 * @returns {Promise<object>} { canAccess, config } - config is null if access denied
 */
export async function fetchSiteConfig(org, site) {
  try {
    const response = await daFetch(`${DA_ADMIN}/config/${org}/${site}/`);
    const unauthorized = response.status === 403 || response.status === 401;
    if (unauthorized) return { canAccess: false, config: null };
    if (!response.ok) return { canAccess: false, config: null };
    const config = await response.json();
    return { canAccess: true, config };
  } catch {
    return { canAccess: false, config: null };
  }
}

/**
 * Check if an item is a folder (from DA list API)
 * @param {object} item - Item from DA list API
 * @returns {boolean} True if folder
 */
export function isFolderItem(item) {
  return !item.ext && !item.name.includes('.') && item.name !== 'drafts';
}

/**
 * Check if an item is a sheet (JSON file)
 * @param {object} item - Item from DA list API
 * @returns {boolean} True if item is a sheet (.json file)
 */
export function isSheetItem(item) {
  return item?.ext === 'json';
}

/**
 * Check if an item is a document (HTML file)
 * @param {object} item - Item from DA list API
 * @returns {boolean} True if item is a document (.html file)
 */
export function isDocumentItem(item) {
  return item?.ext === 'html';
}

/**
 * Check if an item is a sheet or document
 * @param {object} item - Item from DA list API
 * @returns {boolean} True if item is a sheet or document
 */
export function isSheetOrDocument(item) {
  return isSheetItem(item) || isDocumentItem(item);
}

/**
 * Extract shared paths from site config JSON
 * Looks for "shared.paths" key in config.data array
 * Config structure: { data: [{ key: "shared.paths", value: "..." }, ...] }
 * 
 * @param {object} siteConfig - Site configuration object from DA
 * @returns {string[]} Array of trimmed path strings, empty array if not found or invalid
 */
export function extractSharedPaths(siteConfig) {
  if (!siteConfig) {
    return [];
  }

  // Look for shared.paths in config.data array
  const dataArray = siteConfig.data || [];
  const sharedPathsRow = dataArray.find((row) => row.key === 'shared.paths');

  if (!sharedPathsRow || !sharedPathsRow.value || typeof sharedPathsRow.value !== 'string') {
    return [];
  }

  // Parse comma-separated paths and filter empty ones
  return sharedPathsRow.value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}


/**
 * Analyze path based on prefix convention
 * "/" prefix (relative): /data, /sheets, /data/pricing
 *   → relative to current site: /{currentOrg}/{currentSite}/data
 * "#/" prefix (cross-site): #/other-org/other-site/data
 *   → first two segments after # are org and site
 *
 * @param {string} userPath - User-entered path
 * @param {string} currentOrg - Current organization
 * @param {string} currentSite - Current site
 * @returns {object|null} Analyzed path with type, fullPath, and metadata, or null if invalid/empty
 */
export function analyzePath(userPath, currentOrg, currentSite) {
  const path = userPath?.trim();

  // Early return for empty paths
  if (!path) {
    return null;
  }

  const firstChar = path[0];

  // Relative path: starts with "/"
  if (firstChar === '/') {
    return {
      type: 'same-site',
      fullPath: `/${currentOrg}/${currentSite}${path}`,
      display: path,
    };
  }

  // Cross-site path: starts with "#/"
  if (firstChar === '#' && path[1] === '/') {
    const segments = path.slice(2).split('/').filter(Boolean);

    if (segments.length < 2) {
      console.error(`[Sheets Picker] Invalid cross-site path: "${path}". Format must be #/org/site/path. Skipping.`);
      return null;
    }

    const [org, site, ...rest] = segments;

    return {
      type: 'cross-site',
      fullPath: `/${org}/${site}/${rest.join('/')}`,
      org,
      site,
      folder: rest.length > 0 ? `/${rest.join('/')}` : '',
      display: path,
    };
  }

  // Invalid format
  console.error(`[Sheets Picker] Invalid path format: "${path}". Must start with "/" (relative) or "#/" (cross-site). Skipping.`);
  return null;
}

/**
 * Determine if a path is a folder or file
 * @param {string} org - Organization
 * @param {string} site - Site name
 * @param {string} path - Path to check (e.g., /data, /data/pricing)
 * @returns {Promise<'folder'|'file'|'unknown'>} Type of path
 */
export async function detectPathType(org, site, path) {
  try {
    const response = await daFetch(`${DA_ADMIN}/list/${org}/${site}${path}`);

    // If list succeeds, it's a folder
    if (response.ok) {
      const items = await response.json();
      return Array.isArray(items) ? 'folder' : 'file';
    }

    // If 404, likely a file or doesn't exist
    if (response.status === 404) {
      return 'file';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Analyze and categorize shared paths from site config
 * Determines path type, item type (folder/file), and logs comprehensive info
 * 
 * @param {object} siteConfig - Site configuration from DA
 * @param {string} currentOrg - Current organization
 * @param {string} currentSite - Current site
 * @returns {Promise<object>} Categorized paths: { sameSite, crossSite, invalid }
 */
export async function analyzeSharedPaths(siteConfig, currentOrg, currentSite) {
  const paths = extractSharedPaths(siteConfig);

  // No shared paths - use default fragments picker
  if (paths.length === 0) {
    console.log('[Sheets Picker] No shared.paths configured. Using default fragments picker.');
    return { sameSite: [], crossSite: [], invalid: [] };
  }

  console.log(`[Sheets Picker] Found ${paths.length} configured path(s)`);

  const result = {
    sameSite: [],
    crossSite: [],
    invalid: [],
  };

  for (const userPath of paths) {
    const analyzed = analyzePath(userPath, currentOrg, currentSite);

    if (!analyzed) {
      result.invalid.push(userPath);
      continue;
    }

    // Log path analysis
    const pathType = analyzed.type === 'same-site' ? '📍 SAME-SITE' : '🌍 CROSS-SITE';
    console.log(`${pathType}: ${analyzed.display} → ${analyzed.fullPath}`);

    // Check if path is a folder or file
    const itemType = await detectPathType(
      analyzed.org || currentOrg,
      analyzed.site || currentSite,
      analyzed.folder || analyzed.fullPath,
    );

    console.log(`  Type: ${itemType}`);

    // Skip relative /fragments paths (already covered by fragments picker)
    if (analyzed.type === 'same-site' && analyzed.fullPath.endsWith('/fragments')) {
      console.log('  ⊘ Skipping relative /fragments (already in fragments picker)');
      continue;
    }

    if (itemType === 'file') {
      // Determine file type
      const ext = analyzed.fullPath.split('.').pop()?.toLowerCase();
      const fileType = ext === 'json' ? '📊 Sheet' : ext === 'html' ? '📄 Document' : `📋 ${ext}`;
      console.log(`  File type: ${fileType}`);

      const entry = {
        path: analyzed.fullPath,
        display: analyzed.display,
        type: ext,
        itemType: 'file',
      };

      if (analyzed.type === 'same-site') {
        result.sameSite.push(entry);
      } else {
        result.crossSite.push(entry);
      }
    } else if (itemType === 'folder') {
      // Count documents and sheets in folder
      const folderItems = await listFolderContents(
        analyzed.org || currentOrg,
        analyzed.site || currentSite,
        analyzed.folder || analyzed.fullPath,
      );

      const sheetCount = folderItems.filter(isSheetItem).length;
      const docCount = folderItems.filter(isDocumentItem).length;

      console.log(`  Contents: ${sheetCount} sheets, ${docCount} documents`);

      const entry = {
        path: analyzed.fullPath,
        display: analyzed.display,
        itemType: 'folder',
        sheets: sheetCount,
        documents: docCount,
        items: folderItems,
      };

      if (analyzed.type === 'same-site') {
        result.sameSite.push(entry);
      } else {
        result.crossSite.push(entry);
      }
    } else {
      console.warn(`  ⚠ Unknown item type: ${itemType}`);
      result.invalid.push(userPath);
    }
  }

  console.log(`[Sheets Picker] Analysis complete: ${result.sameSite.length} same-site, ${result.crossSite.length} cross-site, ${result.invalid.length} invalid`);

  return result;
}

/**
 * List folder contents from DA
 * @param {string} org - Organization
 * @param {string} site - Site name
 * @param {string} path - Folder path
 * @returns {Promise<array>} Array of items in folder
 */
async function listFolderContents(org, site, path) {
  try {
    const response = await daFetch(`${DA_ADMIN}/list/${org}/${site}${path}`);
    if (!response.ok) return [];
    const items = await response.json();
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
