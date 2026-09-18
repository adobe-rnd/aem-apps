/**
 * URL Normalizer utility for handling both content.da.live and preview URLs
 *
 * Many projects migrated from other systems have library JSON files with preview URLs
 * (e.g., https://main--site--org.aem.live/library/blocks/accordion)
 * instead of content.da.live URLs
 * (e.g., https://content.da.live/org/site/library/blocks/accordion)
 *
 * This utility provides transparent handling of both formats.
 */

/**
 * Parse AEM preview URL hostname to extract org and site
 * Format: {ref}--{site}--{org}.aem.{tld}
 * Examples:
 *   main--sling--da-pilot.aem.live -> { ref: 'main', site: 'sling', org: 'da-pilot' }
 *   feature--mysite--myorg.aem.page -> { ref: 'feature', site: 'mysite', org: 'myorg' }
 *
 * @param {string} hostname - The hostname to parse
 * @returns {{ref: string, site: string, org: string} | null} - Parsed components or null if invalid
 */
export function parsePreviewHostname(hostname) {
  if (!hostname) return null;

  // Remove .aem.live or .aem.page suffix
  const withoutTld = hostname.replace(/\.aem\.(live|page)$/, '');

  // Split by -- delimiter
  const parts = withoutTld.split('--');

  // Must have exactly 3 parts: ref--site--org
  if (parts.length !== 3) return null;

  const [ref, site, org] = parts;

  // Validate all parts exist
  if (!ref || !site || !org) return null;

  return { ref, site, org };
}

/**
 * Normalize a library item URL to content.da.live format
 * Handles both preview URLs and content.da.live URLs
 *
 * Preview URL format: https://main--site--org.aem.live/path/to/item
 * Content URL format: https://content.da.live/org/site/path/to/item
 *
 * @param {string} url - The URL to normalize
 * @returns {string | null} - Normalized content.da.live URL, or null if invalid
 */
export function normalizeLibraryUrl(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);
    const { hostname, pathname } = urlObj;

    // If already a content.da.live URL, return as-is
    if (hostname === 'content.da.live') {
      return url;
    }

    // Try to parse as preview URL
    const parsed = parsePreviewHostname(hostname);
    if (!parsed) {
      // Not a valid preview URL format
      return null;
    }

    const { org, site } = parsed;

    // Construct content.da.live URL
    // Original: https://main--sling--da-pilot.aem.live/library/blocks/accordion
    // Result: https://content.da.live/da-pilot/sling/library/blocks/accordion
    return `https://content.da.live/${org}/${site}${pathname}`;
  } catch (error) {
    // Invalid URL
    return null;
  }
}

/**
 * Extract org, site, and path from a library item URL (preview or content.da.live)
 *
 * @param {string} url - The URL to parse
 * @returns {{org: string, site: string, path: string, itemName: string} | null}
 */
export function parseLibraryUrl(url) {
  if (!url) return null;

  try {
    // First normalize to content.da.live format
    const normalized = normalizeLibraryUrl(url);
    if (!normalized) return null;

    const urlObj = new URL(normalized);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    // content.da.live format: /org/site/path/to/itemname
    if (pathParts.length < 3) return null;

    const org = pathParts[0];
    const site = pathParts[1];
    const itemName = pathParts[pathParts.length - 1];

    // Get the directory path (everything except org, site, and itemname)
    const pathSegments = pathParts.slice(2, -1);
    const path = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '';

    return {
      org,
      site,
      path,
      itemName,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Normalize library JSON data by converting all preview URLs to content.da.live URLs
 * Useful for fixing migrated library JSON files
 *
 * @param {Array} libraryData - Array of library entries with path fields
 * @returns {{data: Array, hasPreviewUrls: boolean, migratedCount: number}}
 */
export function normalizeLibraryData(libraryData) {
  if (!Array.isArray(libraryData)) {
    return { data: libraryData, hasPreviewUrls: false, migratedCount: 0 };
  }

  let hasPreviewUrls = false;
  let migratedCount = 0;

  const normalizedData = libraryData.map((item) => {
    if (!item.path) {
      return item;
    }

    const normalized = normalizeLibraryUrl(item.path);

    // Check if this was a preview URL
    if (normalized && normalized !== item.path) {
      hasPreviewUrls = true;
      migratedCount += 1;
      return {
        ...item,
        path: normalized,
      };
    }

    return item;
  });

  return {
    data: normalizedData,
    hasPreviewUrls,
    migratedCount,
  };
}

/**
 * Check if a URL is a preview URL (*.aem.live or *.aem.page)
 *
 * @param {string} url - The URL to check
 * @returns {boolean}
 */
export function isPreviewUrl(url) {
  if (!url) return false;

  try {
    const urlObj = new URL(url);
    return urlObj.hostname.endsWith('.aem.live') || urlObj.hostname.endsWith('.aem.page');
  } catch (error) {
    return false;
  }
}
