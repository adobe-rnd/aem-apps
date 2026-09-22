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
      return { type: 'file', ext };
    }

    // No extension - must be a folder, verify with list API
    const listUrl = `${DA_ADMIN}/list/${org}/${site}${path}`;
    const listResponse = await daFetch(listUrl);

    if (listResponse.ok) {
      const items = await listResponse.json();
      if (Array.isArray(items)) {
        return { type: 'folder' };
      }
    }

    return { type: 'unknown' };
  } catch (e) {
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
    return { sameSite: [], crossSite: [], invalid: [] };
  }

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

    // Check if path is a folder or file
    const pathInfo = await detectPathType(
      analyzed.org || currentOrg,
      analyzed.site || currentSite,
      analyzed.folder,
    );

    // Skip relative /fragments paths (already covered by fragments picker)
    if (analyzed.type === 'same-site' && analyzed.fullPath.endsWith('/fragments')) {
      continue;
    }

    if (pathInfo.type === 'file') {
      // Determine file type based on extension
      const ext = pathInfo.ext || analyzed.fullPath.split('.').pop()?.toLowerCase();

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
      result.invalid.push(userPath);
    }
  }

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

/**
 * Fetch sheet content from DA source API
 * @param {string} org - Organization
 * @param {string} site - Site name
 * @param {string} path - Sheet path (with .json extension)
 * @returns {Promise<object|null>} Parsed sheet JSON or null if error
 */
export async function fetchSheetContent(org, site, path) {
  try {
    const sourceUrl = `${DA_ADMIN}/source/${org}/${site}${path}`;
    const response = await daFetch(sourceUrl);
    if (!response.ok) {
      console.error(`[Sheets Preview] Failed to fetch sheet: ${sourceUrl} (${response.status})`);
      return null;
    }
    const sheetData = await response.json();
    return sheetData;
  } catch (e) {
    console.error(`[Sheets Preview] Error fetching sheet: ${e.message}`);
    return null;
  }
}

/**
 * Extract tabs from sheet data
 * Sheets have structure: { data: { tabName: [...], tabName2: [...] }, ... }
 * @param {object} sheetContent - Parsed sheet JSON
 * @returns {object} { tabName: [rows...], ... }
 */
export function extractSheetTabs(sheetContent) {
  if (!sheetContent || !sheetContent.data) {
    return {};
  }
  return sheetContent.data;
}

/**
 * Build read-only HTML table from tab data
 * First row contains headers (keys), subsequent rows are data values
 * @param {array} tabData - Array of row objects [headerRow, dataRow1, dataRow2, ...]
 * @returns {string} HTML table markup
 */
export function buildTableHtml(tabData) {
  if (!Array.isArray(tabData) || tabData.length === 0) {
    return '<p>No data available</p>';
  }

  // First row contains headers
  const headerRow = tabData[0];
  const headers = Object.keys(headerRow);
  
  // Data rows are from index 1 onwards
  const dataRows = tabData.slice(1);
  
  let html = '<table style="border-collapse: collapse; width: 100%; font-family: system-ui; font-size: 14px;">';
  html += '<thead style="background-color: #f0f0f0; border-bottom: 2px solid #ccc;">';
  html += '<tr>';
  
  headers.forEach((header) => {
    html += `<th style="padding: 8px; text-align: left; border: 1px solid #ddd; font-weight: bold;">${header}</th>`;
  });
  
  html += '</tr></thead><tbody>';
  
  dataRows.forEach((row, idx) => {
    const bgColor = idx % 2 === 0 ? '#ffffff' : '#f9f9f9';
    html += `<tr style="background-color: ${bgColor};">`;
    
    headers.forEach((header) => {
      const cellValue = row[header] !== undefined ? row[header] : '';
      html += `<td style="padding: 8px; border: 1px solid #ddd;">${cellValue}</td>`;
    });
    
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  return html;
}

/**
 * Build sheet preview UI with tabs
 * @param {object} sheetContent - Parsed sheet JSON
 * @returns {string} HTML markup with tabs and tables
 */
export function buildSheetPreviewHtml(sheetContent) {
  const tabs = extractSheetTabs(sheetContent);
  const tabNames = Object.keys(tabs);
  
  if (tabNames.length === 0) {
    return '<p>No tabs found in sheet</p>';
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 16px;">';
  
  // Tab buttons
  html += '<div style="display: flex; gap: 4px; border-bottom: 2px solid #ccc;">';
  tabNames.forEach((tabName, idx) => {
    const isActive = idx === 0 ? 'true' : 'false';
    const bgColor = idx === 0 ? '#007bff' : '#e0e0e0';
    const textColor = idx === 0 ? '#fff' : '#000';
    html += `<button data-tab="${tabName}" class="sheet-tab" style="padding: 8px 16px; background-color: ${bgColor}; color: ${textColor}; border: none; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 14px; font-weight: ${idx === 0 ? 'bold' : 'normal'};" data-active="${isActive}">${tabName}</button>`;
  });
  html += '</div>';
  
  // Tab content
  html += '<div style="padding: 16px; background-color: #fafafa; border-radius: 0 4px 4px 4px; border: 1px solid #ccc;">';
  tabNames.forEach((tabName, idx) => {
    const display = idx === 0 ? 'block' : 'none';
    html += `<div class="sheet-tab-content" data-tab="${tabName}" style="display: ${display};">`;
    html += buildTableHtml(tabs[tabName]);
    html += '</div>';
  });
  html += '</div></div>';
  
  return html;
}

/**
 * Create img element for sheet icon using SVG file
 */
export function createSheetIcon() {
  const img = document.createElement('img');
  img.src = '/tools/plugins/fragments/img/Smock_Data_18_N.svg';
  img.alt = 'Sheet';
  img.style.cssText = 'flex-shrink: 0; width: 18px; height: 18px;';
  return img;
}

/**
 * Build DOM element for a shared path (file or folder)
 * @param {object} pathEntry - Path entry from analyzeSharedPaths result
 * @param {string} org - Organization
 * @param {string} site - Site name
 * @returns {HTMLElement} List item element with expandable content
 */
export function createSharedPathElement(pathEntry, org, site) {
  const li = document.createElement('li');
  li.className = 'tree-item';
  li.setAttribute('role', 'listitem');
  
  // Store data for later retrieval when expanding
  li.dataset.pathFull = pathEntry.path;
  li.dataset.org = org;
  li.dataset.site = site;
  li.dataset.itemType = pathEntry.itemType;
  li.dataset.pathDisplay = pathEntry.display;

  const content = document.createElement('div');
  content.className = 'tree-item-content';

  // For folders, create expandable button
  if (pathEntry.itemType === 'folder') {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'tree-item-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.style.cssText = 'display: inline-block; width: 16px; padding: 0; margin: 0; border: none; background: none; cursor: pointer; color: inherit;';
    toggleBtn.textContent = '▼';
    toggleBtn.style.transform = 'rotate(-90deg)';
    toggleBtn.style.transition = 'transform 0.2s ease';
    content.appendChild(toggleBtn);
  } else {
    // For files, add spacer
    const spacer = document.createElement('span');
    spacer.style.cssText = 'display: inline-block; width: 16px;';
    content.appendChild(spacer);
  }

  // Add icon
  const iconSpan = document.createElement('span');
  iconSpan.className = 'tree-icon';
  iconSpan.style.cssText = 'display: inline-flex; align-items: center; flex-shrink: 0; margin-right: 8px; width: 18px; height: 18px;';
  
  if (pathEntry.itemType === 'file') {
    if (pathEntry.type === 'json') {
      iconSpan.appendChild(createSheetIcon());
    } else {
      // Document icon from SVG file
      const docImg = document.createElement('img');
      docImg.src = '/tools/plugins/fragments/img/Smock_DocumentFragment_18_N.svg';
      docImg.alt = 'Document';
      docImg.style.cssText = 'width: 18px; height: 18px;';
      iconSpan.appendChild(docImg);
    }
  } else if (pathEntry.itemType === 'folder') {
    // Folder icon from SVG file
    const folderImg = document.createElement('img');
    folderImg.src = '/tools/plugins/fragments/img/Smock_Folder_18_N.svg';
    folderImg.alt = 'Folder';
    folderImg.className = 'folder-icon-closed';
    folderImg.style.cssText = 'width: 18px; height: 18px;';
    iconSpan.appendChild(folderImg);
  }
  
  content.appendChild(iconSpan);

  // Add label
  const labelBtn = document.createElement('button');
  labelBtn.className = 'tree-label-btn';
  labelBtn.type = 'button';
  labelBtn.style.cssText = 'flex: 1; text-align: left; padding: 4px 0; border: none; background: none; cursor: pointer; color: inherit; font-size: inherit; font-family: inherit;';
  labelBtn.textContent = pathEntry.display;
  
  content.appendChild(labelBtn);

  // Add info text for folders
  if (pathEntry.itemType === 'folder') {
    const infoSpan = document.createElement('span');
    infoSpan.className = 'tree-item-info';
    infoSpan.textContent = `(${pathEntry.sheets} sheets, ${pathEntry.documents} docs)`;
    infoSpan.style.cssText = 'font-size: 12px; color: #999; margin-left: 8px; flex-shrink: 0;';
    content.appendChild(infoSpan);
  }

  li.appendChild(content);

  // Handle folder expansion/collapse
  if (pathEntry.itemType === 'folder') {
    const toggleBtn = content.querySelector('.tree-item-toggle');
    const children = document.createElement('div');
    children.className = 'tree-item-children';
    children.style.cssText = 'display: none; padding-left: 24px;';
    children.setAttribute('role', 'group');
    
    const loadingMsg = document.createElement('div');
    loadingMsg.textContent = 'Loading...';
    loadingMsg.style.cssText = 'font-size: 12px; color: #999; padding: 4px 0;';
    children.appendChild(loadingMsg);
    
    li.appendChild(children);

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', !isExpanded);
      children.style.display = isExpanded ? 'none' : 'block';
      toggleBtn.style.transform = isExpanded ? 'rotate(-90deg)' : 'rotate(0deg)';
      
      // Swap folder icon
      const folderImg = iconSpan.querySelector('img');
      if (folderImg && folderImg.classList.contains('folder-icon-closed')) {
        folderImg.src = '/tools/plugins/fragments/img/Smock_FolderOpen_18_N.svg';
        folderImg.classList.remove('folder-icon-closed');
        folderImg.classList.add('folder-icon-open');
      } else if (folderImg) {
        folderImg.src = '/tools/plugins/fragments/img/Smock_Folder_18_N.svg';
        folderImg.classList.remove('folder-icon-open');
        folderImg.classList.add('folder-icon-closed');
      }
    });

    labelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBtn.click();
    });
  } else if (pathEntry.itemType === 'file') {
    // File item - clickable for preview
    labelBtn.addEventListener('click', () => {
      const event = new CustomEvent('sheet-selected', {
        detail: { path: pathEntry.path, org, site, type: pathEntry.type },
      });
      li.dispatchEvent(event);
    });
  }

  return li;
}
