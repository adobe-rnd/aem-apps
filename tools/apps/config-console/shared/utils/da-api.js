// External imports from da.live CDN - unresolved at lint time
/* eslint-disable import/no-unresolved */

import { CONTENT_DA_LIVE_BASE } from '../constants.js';
import { normalizeLibraryData } from './url-normalizer.js';

// Use DA's daFetch which automatically handles IMS tokens
const { getDaAdmin } = await import('https://da.live/nx/public/utils/constants.js');
const { daFetch: daFetchUtil } = await import('https://da.live/nx/utils/daFetch.js');

const DA_ADMIN = getDaAdmin();
const LIBRARY_BLOCKS_PATH = 'library/blocks';

/**
 * Sanitize a DA path segment to prevent path traversal.
 * Strips leading slashes, collapses repeated slashes, and rejects '..'.
 * @param {string} path
 * @returns {string}
 */
export function sanitizePath(path) {
  if (!path) return '';
  if (path.includes('..')) {
    throw new Error(`Invalid path: '${path}' contains path traversal sequence`);
  }
  return path.replace(/\/+/g, '/').replace(/^\//, '');
}

// Library item order priority (Blocks must always be first)
const LIBRARY_ORDER = {
  Blocks: 0,
  Templates: 1,
  Icons: 2,
  Placeholders: 3,
};

/**
 * Normalize URL by prepending https:// if protocol is missing
 * @param {string} url - The URL to normalize
 * @returns {string} - The normalized URL
 */
export function normalizeUrl(url) {
  if (!url) return '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * Strip protocol from URL to get hostname only
 * @param {string} url - The URL to strip protocol from
 * @returns {string} - The hostname without protocol
 */
export function stripProtocol(url) {
  if (!url) return '';
  return url.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/**
 * Validate AEM Repository ID (hostname without protocol)
 * @param {string} repositoryId - The repository ID to validate
 * @returns {Promise<{valid: boolean, normalized: string, error: string|null}>}
 */
export async function validateRepositoryId(repositoryId) {
  if (!repositoryId) {
    return { valid: false, normalized: '', error: 'Repository ID is required' };
  }

  const normalized = stripProtocol(repositoryId);

  if (!normalized.startsWith('author-') && !normalized.startsWith('delivery-')) {
    return {
      valid: false,
      normalized,
      error: 'Repository ID must start with "author-" or "delivery-"',
    };
  }

  const testUrl = `https://${normalized}`;

  try {
    const response = await fetch(testUrl, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-cache',
    });

    const valid = response.ok || response.status === 401;
    return {
      valid,
      normalized,
      error: valid ? null : `Server returned ${response.status}`,
    };
  } catch (error) {
    try {
      await fetch(testUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-cache',
      });
      return {
        valid: true,
        normalized,
        error: null,
      };
    } catch (noCorsError) {
      return {
        valid: false,
        normalized,
        error: error.message || 'Unable to reach URL',
      };
    }
  }
}

/**
 * Validate Production Origin URL (full URL with protocol)
 * @param {string} url - The URL to validate
 * @returns {Promise<{valid: boolean, normalized: string, error: string|null}>}
 */
export async function validateProductionOrigin(url) {
  if (!url) {
    return { valid: false, normalized: '', error: 'URL is required' };
  }

  const normalized = normalizeUrl(url);

  try {
    const response = await fetch(normalized, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-cache',
    });

    const valid = response.ok || response.status === 401;
    return {
      valid,
      normalized,
      error: valid ? null : `Server returned ${response.status}`,
    };
  } catch (error) {
    try {
      await fetch(normalized, {
        method: 'HEAD',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-cache',
      });
      return {
        valid: true,
        normalized,
        error: null,
      };
    } catch (noCorsError) {
      return {
        valid: false,
        normalized,
        error: error.message || 'Unable to reach URL',
      };
    }
  }
}

function sortLibraryData(libraryData) {
  return libraryData.sort((a, b) => {
    const orderA = LIBRARY_ORDER[a.title] ?? 999;
    const orderB = LIBRARY_ORDER[b.title] ?? 999;
    return orderA - orderB;
  });
}

// Use DA's daFetch which handles IMS tokens automatically
async function daFetch(url, options = {}) {
  return daFetchUtil(url, options);
}

export async function fetchSiteConfig(org, site) {
  const url = `${DA_ADMIN}/config/${org}/${site}`;

  try {
    const response = await daFetch(url);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch config.json: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    return null;
  }
}

const LIBRARY_TYPE_FILENAMES = {
  Blocks: 'blocks.json',
  Templates: 'templates.json',
  Icons: 'icons.json',
  Placeholders: 'placeholders.json',
};

const LIBRARY_TYPE_DEFAULTS = {
  Blocks: (org, site) => `${org}/${site}/library/blocks.json`,
  Templates: (org, site) => `${org}/${site}/library/templates.json`,
  Icons: (org, site) => `${org}/${site}/library/icons.json`,
  Placeholders: (org, site) => `${org}/${site}/placeholders.json`,
};

/** Derive library base dir from path (e.g. '.../library/blocks.json' -> '.../library') */
function getLibraryBaseFromPath(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return null;
  const withoutHost = pathStr.replace(/^https:\/\/[^/]+/i, '').replace(/^\//, '');
  const parts = withoutHost.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  parts.pop();
  return parts.join('/');
}

/**
 * Resolve path for a library type from site config, or default.
 * @param {string} org
 * @param {string} site
 * @param {'Blocks'|'Templates'|'Icons'|'Placeholders'} type
 * @param {string} token
 * @returns {Promise<string>} Path for DA source API (e.g. 'org/site/docs/library/blocks.json')
 */
export async function getLibraryPathForType(org, site, type) {
  const config = await fetchSiteConfig(org, site);
  const entry = config?.library?.data?.find((e) => e.title === type);
  if (entry?.path) {
    return entry.path.replace(/^https:\/\/content\.da\.live\/?/i, '').replace(/^\//, '');
  }
  const anyEntry = config?.library?.data?.find((e) => e?.path);
  if (anyEntry?.path) {
    const base = getLibraryBaseFromPath(anyEntry.path);
    const filename = LIBRARY_TYPE_FILENAMES[type];
    if (base && filename) return `${base}/${filename}`;
  }
  return LIBRARY_TYPE_DEFAULTS[type](org, site);
}

/**
 * Resolve library base directory from config (any configured type), or default.
 * @param {string} org
 * @param {string} site
 * @param {string} token
 * @returns {Promise<string>} e.g. 'org/site/docs/library' or 'org/site/library'
 */
export async function getLibraryBase(org, site) {
  const pathForBlocks = await getLibraryPathForType(org, site, 'Blocks');
  const base = getLibraryBaseFromPath(pathForBlocks);
  return base || `${org}/${site}/library`;
}

async function checkBlockDocExists(blocksDirPath, blockName) {
  const path = `${blocksDirPath}/${blockName}`;
  const url = `${DA_ADMIN}/source${path}.html`;

  try {
    const response = await daFetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function createBlockDocVersion(blocksDirPath, blockName) {
  const path = `${blocksDirPath}/${blockName}`;
  const url = `${DA_ADMIN}/versionsource${path}.html`;

  try {
    const response = await daFetch(url, { method: 'POST' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

export async function uploadBlockDoc(org, site, blockName, htmlContent) {
  const base = await getLibraryBase(org, site);
  const blocksDirPath = `/${base}/blocks`;
  const path = `${blocksDirPath}/${blockName}`;
  const url = `${DA_ADMIN}/source${path}.html`;

  try {
    const exists = await checkBlockDocExists(blocksDirPath, blockName);
    if (exists) {
      await createBlockDocVersion(blocksDirPath, blockName);
    }

    const formData = new FormData();
    const blob = new Blob([htmlContent], { type: 'text/html' });
    formData.set('data', blob);

    const response = await daFetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }

    return {
      success: true,
      path,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      path,
      error: error.message,
    };
  }
}

export async function fetchBlocksJSON(org, site) {
  const path = await getLibraryPathForType(org, site, 'Blocks');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const response = await daFetch(url, {});

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch blocks.json: ${response.status}`);
    }

    const data = await response.json();

    // Transparently normalize preview URLs to content.da.live format
    // This handles blocks.json from migrated projects
    if (data?.blocks?.data && Array.isArray(data.blocks.data)) {
      const normalized = normalizeLibraryData(data.blocks.data);
      return { ...data, blocks: { ...data.blocks, data: normalized.data } };
    }

    if (data?.data && Array.isArray(data.data)) {
      const normalized = normalizeLibraryData(data.data);
      return { ...data, data: normalized.data };
    }

    return data;
  } catch {
    return null;
  }
}

export async function updateBlocksJSON(org, site, config) {
  const path = await getLibraryPathForType(org, site, 'Blocks');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await daFetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update blocks.json: ${response.status}`);
    }

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function batchUploadBlocks(
  org,
  site,
  blocks,
  onProgress,
  batchSize = 5,
  token = null,
) {
  const results = [];
  let processed = 0;

  const batches = [];
  for (let i = 0; i < blocks.length; i += batchSize) {
    batches.push({
      blocks: blocks.slice(i, i + batchSize),
      startIndex: i,
    });
  }

  await batches.reduce(async (previousPromise, { blocks: batch, startIndex }) => {
    await previousPromise;

    const processBatch = async (block, batchIndex) => {
      const currentIndex = startIndex + batchIndex;
      if (onProgress) {
        onProgress({
          current: currentIndex + 1,
          total: blocks.length,
          blockName: block.name,
          status: 'uploading',
        });
      }

      const result = await uploadBlockDoc(
        org,
        site,
        block.name,
        block.html,
        token,
      );
      processed += 1;

      if (onProgress) {
        onProgress({
          current: processed,
          total: blocks.length,
          blockName: block.name,
          status: result.success ? 'success' : 'error',
        });
      }

      return {
        name: block.name,
        ...result,
      };
    };

    const batchResults = await Promise.all(batch.map(processBatch));
    results.push(...batchResults);
  }, Promise.resolve());

  return results;
}

export async function validateSite(org, site) {
  const url = `https://admin.hlx.page/config/${org}/sites/${site}.json`;

  try {
    const response = await daFetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

export async function updateSiteConfig(org, site, config) {
  const url = `${DA_ADMIN}/config/${org}/${site}`;

  try {
    const formData = new FormData();
    formData.append('config', JSON.stringify(config));

    const response = await daFetch(url, {
      method: 'PUT',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update config.json: ${response.status}`);
    }

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function registerLibrary(org, site) {
  try {
    let config = await fetchSiteConfig(org, site);
    const blocksPath = `${CONTENT_DA_LIVE_BASE}/${org}/${site}/${LIBRARY_BLOCKS_PATH}.json`;
    let wasCreated = false;

    if (!config) {
      config = {
        ':version': 3,
        ':names': ['library'],
        ':type': 'multi-sheet',
        library: {
          total: 1,
          limit: 1,
          offset: 0,
          data: [
            {
              title: 'Blocks',
              path: blocksPath,
            },
          ],
        },
      };

      const result = await updateSiteConfig(org, site, config);
      return {
        success: result.success,
        created: true,
        error: result.error,
      };
    }

    const configType = config[':type'];

    if (configType === 'sheet') {
      const existingData = config.data || [];
      const existingColWidths = config[':colWidths'];

      config = {
        ':version': 3,
        ':names': ['data', 'library'],
        ':type': 'multi-sheet',
        data: {
          total: existingData.length,
          limit: existingData.length,
          offset: 0,
          data: existingData,
        },
        library: {
          total: 1,
          limit: 1,
          offset: 0,
          data: [
            {
              title: 'Blocks',
              path: blocksPath,
            },
          ],
        },
      };

      if (existingColWidths) {
        config.data[':colWidths'] = existingColWidths;
      }

      wasCreated = true;
    } else if (configType === 'multi-sheet') {
      if (!config.library) {
        if (!config[':names'].includes('library')) {
          config[':names'].push('library');
        }

        config.library = {
          total: 1,
          limit: 1,
          offset: 0,
          data: [
            {
              title: 'Blocks',
              path: blocksPath,
            },
          ],
        };

        wasCreated = true;
      } else {
        const libraryData = config.library.data || [];
        const blocksIndex = libraryData.findIndex((entry) => entry.title === 'Blocks');

        if (blocksIndex === -1) {
          libraryData.push({
            title: 'Blocks',
            path: blocksPath,
          });

          config.library.data = libraryData;
          config.library.total = libraryData.length;
          config.library.limit = libraryData.length;
          wasCreated = true;
        } else {
          // Blocks already configured; keep existing path (e.g. docs/library) - do not overwrite
          return {
            success: true,
            created: false,
            error: null,
          };
        }
      }
    } else {
      config = {
        ':version': 3,
        ':names': ['library'],
        ':type': 'multi-sheet',
        library: {
          total: 1,
          limit: 1,
          offset: 0,
          data: [
            {
              title: 'Blocks',
              path: blocksPath,
            },
          ],
        },
      };

      wasCreated = true;
    }

    if (!config[':version']) {
      config[':version'] = 3;
    }

    const result = await updateSiteConfig(org, site, config);
    return {
      success: result.success,
      created: wasCreated,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      created: false,
      error: error.message,
    };
  }
}

/**
 * Ensure the library sheet exists in site config; register it if missing.
 * Use in Refresh mode so config is repaired when library folder exists but config was never set.
 * @param {string} org
 * @param {string} site
 * @param {string} token
 * @returns {Promise<{ success: boolean, created?: boolean, error?: string }>}
 */
export async function ensureLibraryRegistered(org, site) {
  const config = await fetchSiteConfig(org, site);
  if (config?.library) {
    return { success: true, created: false };
  }
  return registerLibrary(org, site);
}

export async function registerTemplatesInConfig(org, site) {
  try {
    const config = await fetchSiteConfig(org, site);

    if (!config || !config.library) {
      return {
        success: false,
        error: 'Site config not initialized. Run Blocks setup first.',
      };
    }

    const pathSegment = await getLibraryPathForType(org, site, 'Templates');
    const templatesPath = `${CONTENT_DA_LIVE_BASE}/${pathSegment}`;

    const libraryData = config.library.data || [];
    const templatesIndex = libraryData.findIndex((entry) => entry.title === 'Templates');

    if (templatesIndex === -1) {
      libraryData.push({
        title: 'Templates',
        path: templatesPath,
      });
    } else {
      libraryData[templatesIndex].path = templatesPath;
    }

    const sortedData = sortLibraryData(libraryData);
    config.library.data = sortedData;
    config.library.total = sortedData.length;
    config.library.limit = sortedData.length;

    const result = await updateSiteConfig(org, site, config);
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function uploadTemplateDoc(org, site, templateName, sourcePath) {
  const base = await getLibraryBase(org, site);
  const sourceUrl = `${DA_ADMIN}/source/${org}/${site}${sourcePath}.html`;
  const targetPath = `/${base}/templates/${templateName}`;
  const targetUrl = `${DA_ADMIN}/source${targetPath}.html`;

  try {
    const sourceResponse = await daFetch(sourceUrl, {});
    if (!sourceResponse.ok) {
      throw new Error(`Failed to fetch source page: ${sourceResponse.status}`);
    }

    const htmlContent = await sourceResponse.text();

    const formData = new FormData();
    const blob = new Blob([htmlContent], { type: 'text/html' });
    formData.set('data', blob);

    const targetResponse = await daFetch(targetUrl, {
      method: 'POST',
      body: formData,
    });

    if (!targetResponse.ok) {
      throw new Error(`Upload failed: ${targetResponse.status}`);
    }

    return {
      success: true,
      path: targetPath,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error.message,
    };
  }
}

export async function fetchTemplatesJSON(org, site) {
  const path = await getLibraryPathForType(org, site, 'Templates');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const response = await daFetch(url, {});

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch templates.json: ${response.status}`);
    }

    const data = await response.json();

    // Transparently normalize preview URLs to content.da.live format
    // This handles templates.json from migrated projects
    if (data?.data && Array.isArray(data.data)) {
      const normalized = normalizeLibraryData(data.data);
      return { ...data, data: normalized.data };
    }

    return data;
  } catch (error) {
    return null;
  }
}

export async function updateTemplatesJSON(org, site, config) {
  const path = await getLibraryPathForType(org, site, 'Templates');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await daFetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update templates.json: ${response.status}`);
    }

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function fetchIconsJSON(org, site) {
  const path = await getLibraryPathForType(org, site, 'Icons');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const response = await daFetch(url, {});

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch icons.json: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    return null;
  }
}

export async function updateIconsJSON(org, site, config) {
  const path = await getLibraryPathForType(org, site, 'Icons');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await daFetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update icons.json: ${response.status}`);
    }

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function uploadIconDoc(org, site, iconName, sourcePath) {
  const base = await getLibraryBase(org, site);
  const sourceUrl = `${DA_ADMIN}/source/${org}/${site}${sourcePath}`;
  const targetPath = `/${base}/icons/${iconName}`;
  const targetUrl = `${DA_ADMIN}/source${targetPath}.svg`;

  try {
    const sourceResponse = await daFetch(sourceUrl, {});
    if (!sourceResponse.ok) {
      throw new Error(`Failed to fetch source icon: ${sourceResponse.status}`);
    }

    const svgContent = await sourceResponse.text();

    const formData = new FormData();
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    formData.set('data', blob);

    const targetResponse = await daFetch(targetUrl, {
      method: 'POST',
      body: formData,
    });

    if (!targetResponse.ok) {
      throw new Error(`Upload failed: ${targetResponse.status}`);
    }

    return {
      success: true,
      path: targetPath,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      path: targetPath,
      error: error.message,
    };
  }
}

export async function fetchPlaceholdersJSON(org, site) {
  const path = await getLibraryPathForType(org, site, 'Placeholders');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const response = await daFetch(url, {});

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch placeholders.json: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    return null;
  }
}

export async function updatePlaceholdersJSON(org, site, config) {
  const path = await getLibraryPathForType(org, site, 'Placeholders');
  const url = `${DA_ADMIN}/source/${path}`;

  try {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
    formData.set('data', blob);

    const response = await daFetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to update placeholders.json: ${response.status}`);
    }

    return {
      success: true,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function registerIconsInConfig(org, site) {
  try {
    const config = await fetchSiteConfig(org, site);

    if (!config || !config.library) {
      return {
        success: false,
        error: 'Site config not initialized. Run Blocks setup first.',
      };
    }

    const pathSegment = await getLibraryPathForType(org, site, 'Icons');
    const iconsPath = `${CONTENT_DA_LIVE_BASE}/${pathSegment}`;

    const libraryData = config.library.data || [];
    const iconsIndex = libraryData.findIndex((entry) => entry.title === 'Icons');

    if (iconsIndex === -1) {
      libraryData.push({
        title: 'Icons',
        path: iconsPath,
        format: ':<content>:',
      });
    } else {
      libraryData[iconsIndex].path = iconsPath;
      libraryData[iconsIndex].format = ':<content>:';
    }

    const sortedData = sortLibraryData(libraryData);
    config.library.data = sortedData;
    config.library.total = sortedData.length;
    config.library.limit = sortedData.length;

    const result = await updateSiteConfig(org, site, config);
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function registerPlaceholdersInConfig(org, site) {
  try {
    const config = await fetchSiteConfig(org, site);

    if (!config || !config.library) {
      return {
        success: false,
        error: 'Site config not initialized. Run Blocks setup first.',
      };
    }

    const pathSegment = await getLibraryPathForType(org, site, 'Placeholders');
    const placeholdersPath = `${CONTENT_DA_LIVE_BASE}/${pathSegment}`;

    const libraryData = config.library.data || [];
    const placeholdersIndex = libraryData.findIndex((entry) => entry.title === 'Placeholders');

    if (placeholdersIndex === -1) {
      libraryData.push({
        title: 'Placeholders',
        path: placeholdersPath,
        format: '{{<content>}}',
      });
    } else {
      libraryData[placeholdersIndex].path = placeholdersPath;
      libraryData[placeholdersIndex].format = '{{<content>}}';
    }

    const sortedData = sortLibraryData(libraryData);
    config.library.data = sortedData;
    config.library.total = sortedData.length;
    config.library.limit = sortedData.length;

    const result = await updateSiteConfig(org, site, config);
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function fetchAemAssetsConfig(org, site) {
  try {
    const config = await fetchSiteConfig(org, site);

    if (!config || !config.data || !config.data.data) {
      return {
        repositoryId: '',
        prodOrigin: '',
        imageType: false,
        renditionsSelect: false,
        dmDelivery: false,
        smartCropSelect: false,
        exists: false,
      };
    }

    const dataItems = config.data.data;

    const configMap = new Map(
      dataItems
        .filter((item) => {
          if (!item || typeof item !== 'object' || Object.keys(item).length === 0) {
            return false;
          }
          if (item.key === 'Key' || item.key === 'key') {
            return false;
          }
          if (!item.key || item.key.trim() === '') {
            return false;
          }
          return true;
        })
        .map((item) => [item.key, item.value]),
    );

    const repositoryId = configMap.get('aem.repositoryId') || '';
    const hasConfig = repositoryId !== '';

    return {
      repositoryId,
      prodOrigin: configMap.get('aem.assets.prod.origin') || '',
      imageType: configMap.get('aem.assets.image.type') === 'link',
      renditionsSelect: configMap.get('aem.assets.renditions.select') === 'on',
      dmDelivery: configMap.get('aem.asset.dm.delivery') === 'on',
      smartCropSelect: configMap.get('aem.asset.smartcrop.select') === 'on',
      exists: hasConfig,
    };
  } catch (error) {
    return {
      repositoryId: '',
      prodOrigin: '',
      imageType: false,
      renditionsSelect: false,
      dmDelivery: false,
      smartCropSelect: false,
      exists: false,
    };
  }
}

export async function updateAemAssetsConfig(org, site, aemConfig) {
  try {
    let config = await fetchSiteConfig(org, site);

    if (!config) {
      config = {
        ':version': 3,
        ':type': 'multi-sheet',
        ':names': ['data'],
        data: {
          total: 0,
          limit: 0,
          offset: 0,
          data: [],
        },
      };
    }

    if (!config.data) {
      config.data = {
        total: 0,
        limit: 0,
        offset: 0,
        data: [],
      };
    }

    if (!config.data.data) {
      config.data.data = [];
    }

    const dataItems = [...config.data.data];

    const aemKeys = [
      'aem.repositoryId',
      'aem.assets.prod.origin',
      'aem.assets.image.type',
      'aem.assets.renditions.select',
      'aem.asset.dm.delivery',
      'aem.asset.smartcrop.select',
    ];

    // Helper function to check if an object is empty or has no meaningful data
    const isEmptyOrInvalid = (item) => {
      if (!item || typeof item !== 'object') return true;
      const keys = Object.keys(item);
      if (keys.length === 0) return true;
      if ('key' in item && (!item.key || item.key.trim() === '')) return true;
      return false;
    };

    // Preserve all non-AEM data, filter out empty objects, AEM keys, and header rows
    // Note: DA.live automatically adds the header row in the UI, so we don't need to include it
    const filteredData = dataItems.filter(
      (item) => {
        if (isEmptyOrInvalid(item)) return false;
        if (aemKeys.includes(item.key)) return false;
        if (item.key === 'Key' || item.key === 'key') return false;
        return true;
      },
    );
    if (aemConfig.repositoryId) {
      filteredData.push({
        key: 'aem.repositoryId',
        value: aemConfig.repositoryId,
      });
    }

    if (aemConfig.prodOrigin) {
      filteredData.push({
        key: 'aem.assets.prod.origin',
        value: aemConfig.prodOrigin,
      });
    }

    if (aemConfig.imageType) {
      filteredData.push({
        key: 'aem.assets.image.type',
        value: 'link',
      });
    }

    if (aemConfig.renditionsSelect) {
      filteredData.push({
        key: 'aem.assets.renditions.select',
        value: 'on',
      });
    }

    if (aemConfig.dmDelivery) {
      filteredData.push({
        key: 'aem.asset.dm.delivery',
        value: 'on',
      });
    }

    if (aemConfig.smartCropSelect) {
      filteredData.push({
        key: 'aem.asset.smartcrop.select',
        value: 'on',
      });
    }

    config.data.data = filteredData;
    config.data.total = filteredData.length;
    config.data.limit = filteredData.length;

    if (!config[':names']) {
      config[':names'] = ['data'];
    }
    if (!config[':names'].includes('data')) {
      config[':names'].push('data');
    }

    const result = await updateSiteConfig(org, site, config);
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function fetchTranslationConfig(org, site) {
  try {
    const config = await fetchSiteConfig(org, site);
    if (!config || !config.data || !config.data.data) {
      return {
        translateBehavior: 'overwrite',
        translateStaging: 'off',
        rolloutBehavior: 'overwrite',
      };
    }

    const dataItems = config.data.data;
    const configMap = new Map(dataItems.map((item) => [item.key, item.value]));

    return {
      translateBehavior: configMap.get('translate.behavior') || 'overwrite',
      translateStaging: configMap.get('translate.staging') || 'off',
      rolloutBehavior: configMap.get('rollout.behavior') || 'overwrite',
    };
  } catch (error) {
    return {
      translateBehavior: 'overwrite',
      translateStaging: 'off',
      rolloutBehavior: 'overwrite',
    };
  }
}

export async function updateTranslationConfig(org, site, translationConfig) {
  try {
    let config = await fetchSiteConfig(org, site);

    if (!config) {
      config = {
        ':version': 3,
        ':type': 'multi-sheet',
        ':names': ['data'],
        data: {
          total: 0,
          limit: 0,
          offset: 0,
          data: [],
        },
      };
    }

    if (!config.data) {
      config.data = {
        total: 0,
        limit: 0,
        offset: 0,
        data: [],
      };
    }

    if (!config.data.data) {
      config.data.data = [];
    }

    const dataItems = [...config.data.data];

    const needsHeader = dataItems.length === 0;

    const translationKeys = [
      'translate.behavior',
      'translate.staging',
      'rollout.behavior',
    ];

    const filteredData = dataItems.filter((item) => !translationKeys.includes(item.key));
    if (needsHeader) {
      filteredData.push({
        key: 'Key',
        value: 'Value',
      });
    }

    filteredData.push({
      key: 'translate.behavior',
      value: translationConfig.translateBehavior,
    });

    filteredData.push({
      key: 'translate.staging',
      value: translationConfig.translateStaging,
    });

    filteredData.push({
      key: 'rollout.behavior',
      value: translationConfig.rolloutBehavior,
    });

    config.data.data = filteredData;
    config.data.total = filteredData.length;
    config.data.limit = filteredData.length;

    if (!config[':names']) {
      config[':names'] = ['data'];
    }
    if (!config[':names'].includes('data')) {
      config[':names'].push('data');
    }

    const result = await updateSiteConfig(org, site, config);
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function fetchUniversalEditorConfig(org, site) {
  try {
    const config = await fetchSiteConfig(org, site);
    if (!config || !config.data || !config.data.data) {
      return {
        editorPath: '',
      };
    }

    const dataItems = config.data.data;
    const configMap = new Map(dataItems.map((item) => [item.key, item.value]));

    return {
      editorPath: configMap.get('editor.path') || '',
    };
  } catch (error) {
    return {
      editorPath: '',
    };
  }
}

export async function updateUniversalEditorConfig(org, site, ueConfig) {
  try {
    let config = await fetchSiteConfig(org, site);

    if (!config) {
      config = {
        ':version': 3,
        ':type': 'multi-sheet',
        ':names': ['data'],
        data: {
          total: 0,
          limit: 0,
          offset: 0,
          data: [],
        },
      };
    }

    if (!config.data) {
      config.data = {
        total: 0,
        limit: 0,
        offset: 0,
        data: [],
      };
    }

    if (!config.data.data) {
      config.data.data = [];
    }

    const dataItems = [...config.data.data];

    const needsHeader = dataItems.length === 0;

    const ueKeys = ['editor.path'];

    const filteredData = dataItems.filter((item) => !ueKeys.includes(item.key));
    if (needsHeader) {
      filteredData.push({
        key: 'Key',
        value: 'Value',
      });
    }

    if (ueConfig.editorPath) {
      filteredData.push({
        key: 'editor.path',
        value: ueConfig.editorPath,
      });
    }

    config.data.data = filteredData;
    config.data.total = filteredData.length;
    config.data.limit = filteredData.length;

    if (!config[':names']) {
      config[':names'] = ['data'];
    }
    if (!config[':names'].includes('data')) {
      config[':names'].push('data');
    }

    const result = await updateSiteConfig(org, site, config);
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}
