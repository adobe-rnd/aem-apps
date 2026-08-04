// Base paths
export const DEFAULT_LIBRARY_BASE_PATH = 'library';
export const BLOCKS_PATH = 'blocks';
export const TEMPLATES_PATH = 'templates';
export const ICONS_PATH = 'icons';

// DA.live endpoints
export const DA_LIVE_BASE = 'https://da.live';
export const DA_LIVE_EDIT_BASE = `${DA_LIVE_BASE}/edit`;
export const CONTENT_DA_LIVE_BASE = 'https://content.da.live';
export const ADMIN_DA_LIVE_BASE = 'https://admin.da.live';
export const ADMIN_HLX_PAGE = 'https://admin.hlx.page';

// Config keys for inheritance
export const CONFIG_KEYS = {
  LIBRARY_BASE_PATH: 'library.basePath',
  AEM_REPOSITORY_ID: 'aem.repositoryId',
  AEM_PROD_ORIGIN: 'aem.assets.prod.origin',
  AEM_PROD_BASEPATH: 'aem.assets.prod.basepath',
  AEM_IMAGE_TYPE: 'aem.assets.image.type',
  AEM_DM_DELIVERY: 'aem.asset.dm.delivery',
  AEM_SMARTCROP_SELECT: 'aem.asset.smartcrop.select',
  AEM_MIME_RENDITIONS: 'aem.asset.mime.renditions',
  TRANSLATE_BEHAVIOR: 'translate.behavior',
  TRANSLATE_STAGING: 'translate.staging',
  ROLLOUT_BEHAVIOR: 'rollout.behavior',
  EDITOR_PATH: 'editor.path',
  EW_ENABLED: 'ew.enabled',
  EW_CHAT: 'ew.chat',
  EW_CANVAS_DEFAULT: 'ew.canvas.default',
  EW_PANEL_DEFAULT: 'ew.panel.default',
};

// Error messages
export const ERROR_MESSAGES = {
  DA_SDK_FAILED: 'Failed to load DA SDK. Please refresh the page.',
  SECTION_LOAD_FAILED: 'Failed to load section. Please try again.',
  CONFIG_FETCH_FAILED: 'Failed to fetch configuration.',
  CONFIG_SAVE_FAILED: 'Failed to save configuration.',
  GITHUB_AUTH_FAILED: 'GitHub authentication required for private repositories.',
  INVALID_REPOSITORY: 'Invalid GitHub repository URL.',
  NO_BLOCKS_FOUND: 'No blocks found in repository.',
};

// Library type filenames
export const LIBRARY_TYPE_FILENAMES = {
  Blocks: 'blocks.json',
  Templates: 'templates.json',
  Icons: 'icons.json',
  Placeholders: 'placeholders.json',
};

// Helper functions for building URLs
export function getLibraryBlocksURL(org, repo, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `${DA_LIVE_BASE}/#/${org}/${repo}/${basePath}/${BLOCKS_PATH}`;
}

export function getBlockEditURL(org, repo, blockName, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `${DA_LIVE_EDIT_BASE}#/${org}/${repo}/${basePath}/${BLOCKS_PATH}/${blockName}`;
}

export function getBlockPreviewURL(org, repo, blockName, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `https://main--${repo}--${org}.aem.page/${basePath}/${BLOCKS_PATH}/${blockName}`;
}

export function getContentBlockPath(org, site, blockName, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `${CONTENT_DA_LIVE_BASE}/${org}/${site}/${basePath}/${BLOCKS_PATH}/${blockName}`;
}

export function getBlocksJSONPath(org, site, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `${org}/${site}/${basePath}/blocks.json`;
}

export function getTemplatesJSONPath(org, site, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `${org}/${site}/${basePath}/templates.json`;
}

export function getIconsJSONPath(org, site, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `${org}/${site}/${basePath}/icons.json`;
}

export function getPlaceholdersJSONPath(org, site) {
  return `${org}/${site}/placeholders.json`;
}

export function getContentTemplatePath(
  org,
  site,
  templateName,
  basePath = DEFAULT_LIBRARY_BASE_PATH,
) {
  return `${CONTENT_DA_LIVE_BASE}/${org}/${site}/${basePath}/${TEMPLATES_PATH}/${templateName}`;
}

export function getContentIconPath(org, site, iconName, basePath = DEFAULT_LIBRARY_BASE_PATH) {
  return `${CONTENT_DA_LIVE_BASE}/${org}/${site}/${basePath}/${ICONS_PATH}/${iconName}.svg`;
}
