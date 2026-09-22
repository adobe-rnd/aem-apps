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
 * Looks for "shared.paths" key in config.data.data array
 * Config structure: { data: { data: [{ key: "shared.paths", value: "..." }, ...] } }
 * 
 * @param {object} siteConfig - Site configuration object from DA
 * @returns {string[]} Array of trimmed path strings, empty array if not found or invalid
 */
export function extractSharedPaths(siteConfig) {
  if (!siteConfig) {
    return [];
  }

  // Look for shared.paths in config.data.data array (nested)
  const dataArray = siteConfig.data?.data || siteConfig.data || [];
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
      folder: path,
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
 * Logic: 
 * 1. If path has file extension (e.g., .json, .html) → treat as file immediately
 * 2. If no extension → call list API to verify it's a folder
 * 
 * @param {string} org - Organization
 * @param {string} site - Site name
 * @param {string} path - Path to check (e.g., /metadata.json, /data, /drafts/kiran)
 * @returns {Promise<object>} { type: 'folder'|'file'|'unknown', ext?: string }
 */
export async function detectPathType(org, site, path) {
  try {
    // Check if path has a file extension
    const lastSegment = path.split('/').pop() || '';
    const ext = lastSegment.includes('.') ? lastSegment.split('.').pop()?.toLowerCase() : null;

    // If path has extension, treat as file
    if (ext) {
      console.log(`  [detectPathType] File with extension .${ext}: ${path}`);
      return { type: 'file', ext };
    }

    // No extension - must be a folder, verify with list API
    const listUrl = `${DA_ADMIN}/list/${org}/${site}${path}`;
    console.log(`  [detectPathType] Calling list API: ${listUrl}`);
    const listResponse = await daFetch(listUrl);

    if (listResponse.ok) {
      const items = await listResponse.json();
      if (Array.isArray(items)) {
        console.log(`  [detectPathType] Confirmed folder with ${items.length} items`);
        return { type: 'folder' };
      }
    }

    console.log(`  [detectPathType] Not a valid folder, list API returned ${listResponse.status}`);
    return { type: 'unknown' };
  } catch (e) {
    console.error(`  [detectPathType] Error: ${e.message}`);
    return { type: 'unknown' };
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
  console.log('[Sheets Picker] Note: For individual files, include the file extension (e.g., /metadata.json, /data/products.json)');
  console.log('[Sheets Picker] For folders, omit the extension (e.g., /drafts, /data)');

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
    const pathInfo = await detectPathType(
      analyzed.org || currentOrg,
      analyzed.site || currentSite,
      analyzed.folder,
    );

    console.log(`  Type: ${pathInfo.type}${pathInfo.ext ? ` (.${pathInfo.ext})` : ''}`);

    // Skip relative /fragments paths (already covered by fragments picker)
    if (analyzed.type === 'same-site' && analyzed.fullPath.endsWith('/fragments')) {
      console.log('  ⊘ Skipping relative /fragments (already in fragments picker)');
      continue;
    }

    if (pathInfo.type === 'file') {
      // Determine file type based on extension
      const ext = pathInfo.ext || analyzed.fullPath.split('.').pop()?.toLowerCase();
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
    } else if (pathInfo.type === 'folder') {
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
