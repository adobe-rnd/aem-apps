const DA_SOURCE = 'https://admin.da.live/source';

async function fetchPageHTML(org, site, pagePath, token) {
  const htmlPath = pagePath.endsWith('.html') ? pagePath : `${pagePath}.html`;
  const cleanPath = htmlPath.startsWith('/') ? htmlPath.slice(1) : htmlPath;
  const url = `${DA_SOURCE}/${org}/${site}/${cleanPath}`;

  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch page ${pagePath}: ${response.status}`);
  }

  const html = await response.text();

  return html;
}

function extractBlocksFromHTML(html, blockName) {
  const instances = [];
  const openTagRegex = new RegExp(`<div([^>]*class="[^"]*\\b${blockName}\\b[^"]*"[^>]*)>`, 'gi');

  const matches = Array.from(html.matchAll(openTagRegex));

  matches.forEach((match) => {
    const openTag = match[0];
    const attributes = match[1];
    const startPos = match.index + openTag.length;

    const classMatch = attributes.match(/class="([^"]*)"/);
    const classes = classMatch ? classMatch[1].split(/\s+/) : [];
    const variant = classes.find((cls) => cls !== blockName && cls !== 'block' && cls !== 'section') || '';

    let depth = 1;
    let pos = startPos;
    const divOpenRegex = /<div[^>]*>/g;
    const divCloseRegex = /<\/div>/g;

    while (depth > 0 && pos < html.length) {
      divOpenRegex.lastIndex = pos;
      divCloseRegex.lastIndex = pos;

      const nextOpen = divOpenRegex.exec(html);
      const nextClose = divCloseRegex.exec(html);

      if (!nextClose) break;

      if (nextOpen && nextOpen.index < nextClose.index) {
        depth += 1;
        pos = nextOpen.index + nextOpen[0].length;
      } else {
        depth -= 1;
        if (depth === 0) {
          const content = html.substring(startPos, nextClose.index).trim();
          if (content) {
            instances.push({
              html: content,
              variant,
            });
          }
          break;
        }
        pos = nextClose.index + nextClose[0].length;
      }
    }
  });

  return instances;
}

/**
 * Discover all blocks from a set of pages
 * Returns unique block names with their variants
 */
export async function discoverBlocksFromContent(sitesWithPages, onProgress, token) {
  const blockDiscovery = new Map(); // blockName -> Set of variants

  const pagesList = sitesWithPages
    .filter(({ pages }) => pages && pages.length > 0)
    .flatMap(({ org, site, pages }) => pages.map((page) => ({
      org,
      site,
      pagePath: typeof page === 'string' ? page : page.path,
    })));

  const totalPages = pagesList.length;
  let processed = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (const { org, site, pagePath } of pagesList) {
    try {
      if (onProgress) {
        onProgress({
          step: 'scan',
          status: 'scanning',
          current: processed + 1,
          total: totalPages,
          page: pagePath,
        });
      }

      // eslint-disable-next-line no-await-in-loop
      const html = await fetchPageHTML(org, site, pagePath, token);

      // Find all block divs with class attribute
      const blockRegex = /<div[^>]*class="([^"]*)"[^>]*>/gi;
      const matches = Array.from(html.matchAll(blockRegex));

      matches.forEach((match) => {
        const classAttr = match[1];
        const classes = classAttr.split(/\s+/).filter(Boolean);

        // Find potential block classes (not section, block, or empty)
        const excludedClasses = new Set(['section', 'block', '']);
        const potentialBlocks = classes.filter((cls) => !excludedClasses.has(cls));

        // First class is typically the block name
        if (potentialBlocks.length > 0) {
          const blockName = potentialBlocks[0];
          const variant = potentialBlocks.slice(1).join(' '); // Rest are variants

          if (!blockDiscovery.has(blockName)) {
            blockDiscovery.set(blockName, new Set());
          }

          if (variant) {
            blockDiscovery.get(blockName).add(variant);
          }
        }
      });

      processed += 1;
    } catch (error) {
      // Skip pages that fail to load
      processed += 1;
    }
  }

  // Convert to array format
  const excludedBlocks = new Set([
    'header',
    'footer',
    'fragment',
    'metadata',
    'section-metadata',
  ]);
  const blocks = [];

  blockDiscovery.forEach((variants, name) => {
    if (!excludedBlocks.has(name.toLowerCase())) {
      blocks.push({
        name,
        variants: Array.from(variants),
        variantCount: variants.size,
      });
    }
  });

  return blocks;
}

export default async function extractExamplesWithProgress(
  sitesWithPages,
  blockNames,
  onProgress,
  token,
) {
  const examplesByBlock = {};

  blockNames.forEach((blockName) => {
    examplesByBlock[blockName] = [];
  });

  const pagesList = sitesWithPages
    .filter(({ pages }) => pages && pages.length > 0)
    .flatMap(({ org, site, pages }) => pages.map((pagePath) => ({ org, site, pagePath })));

  const totalPages = pagesList.length;
  let processed = 0;

  await pagesList.reduce(async (previousPromise, { org, site, pagePath }) => {
    await previousPromise;

    try {
      if (onProgress) {
        onProgress({
          current: processed + 1,
          total: totalPages,
          site,
          page: pagePath,
        });
      }

      const html = await fetchPageHTML(org, site, pagePath, token);

      blockNames.forEach((blockName) => {
        const instances = extractBlocksFromHTML(html, blockName);

        instances.forEach((instance) => {
          examplesByBlock[blockName].push({
            ...instance,
            source: {
              site,
              page: pagePath,
            },
          });
        });
      });

      processed += 1;
    } catch (error) {
      processed += 1;
    }
  }, Promise.resolve());

  return examplesByBlock;
}
