const STRUCTURE_PATTERNS = {
  hasImage: ['image', 'img', 'picture', 'photo'],
  hasHeading: ['title', 'heading', 'headline'],
  hasButton: ['button', 'btn', 'cta', 'action'],
  hasMultipleItems: ['item', 'card', 'column'],
};

function detectStructureFeatures(classes) {
  const features = {};

  Object.entries(STRUCTURE_PATTERNS).forEach(([feature, patterns]) => {
    features[feature] = classes.some((className) => (
      patterns.some((pattern) => className.includes(pattern))
    ));
  });

  features.isBEM = classes.some((c) => c.includes('__') || c.includes('--'));

  return features;
}

function extractVariantsFromCSS(cssContent, blockName) {
  if (!cssContent) return [];

  const variantPattern = new RegExp(`\\.${blockName}\\.(\\w+)`, 'g');
  const variants = new Set();
  const matches = cssContent.matchAll(variantPattern);

  Array.from(matches).forEach((match) => {
    if (match[1] !== blockName) {
      variants.add(match[1]);
    }
  });

  return Array.from(variants);
}

function extractDescriptionFromJS(jsContent) {
  if (!jsContent) return null;

  const jsdocMatch = jsContent.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\n/);
  if (jsdocMatch) {
    return jsdocMatch[1];
  }

  return null;
}

function extractClassesFromCSS(cssContent) {
  if (!cssContent) return [];

  const allClasses = new Set();
  const classMatches = cssContent.matchAll(/\.([a-zA-Z0-9_-]+)/g);

  Array.from(classMatches).forEach((match) => {
    allClasses.add(match[1]);
  });

  return Array.from(allClasses);
}

export function generateAutoDescription(blockName, structure, variants) {
  const parts = [];

  if (structure.hasMultipleItems) {
    parts.push('Multi-item layout');
  }

  const content = [];
  if (structure.hasImage) content.push('images');
  if (structure.hasHeading) content.push('headings');
  if (structure.hasButton) content.push('buttons');

  if (content.length > 0) {
    parts.push(`with ${content.join(', ')}`);
  }

  if (variants?.length > 0) {
    parts.push(`Variants: ${variants.join(', ')}`);
  }

  return parts.length > 0
    ? parts.join(' ')
    : `${blockName.charAt(0).toUpperCase() + blockName.slice(1)} block`;
}

function generateCellContent(blockName, cellIndex, structure) {
  const parts = [];

  if (cellIndex === 0 && structure.hasHeading) {
    parts.push('<h3>Block Title</h3>');
  } else if (structure.hasImage && cellIndex === 1) {
    parts.push('<picture>');
    parts.push('  <img src=\'https://via.placeholder.com/400x300\' alt=\'Placeholder\'>');
    parts.push('</picture>');
  } else if (structure.hasButton && cellIndex === structure.columns - 1) {
    parts.push('<p><a href=\'#\'>Call to Action</a></p>');
  } else {
    parts.push(`<p>Column ${cellIndex + 1} content</p>`);
  }

  return `            <div>
              ${parts.join('\n              ')}
            </div>`;
}

function generateStructuredPlaceholder(blockName, structure) {
  const { rows, columns } = structure;
  const rowElements = [];

  for (let r = 0; r < rows; r += 1) {
    const cells = [];
    for (let c = 0; c < columns; c += 1) {
      cells.push(generateCellContent(blockName, c, structure));
    }

    rowElements.push(`        <div>
${cells.join('\n')}
        </div>`);
  }

  return rowElements.join('\n');
}

function detectRowColumnStructure(jsContent) {
  if (!jsContent) {
    return { rows: 1, columns: 1 };
  }

  const querySelectorAllLinks = /querySelectorAll\(['"]a['"]\)/.test(jsContent);
  if (querySelectorAllLinks && /links\.find/.test(jsContent)) {
    const findMatches = (jsContent.match(/links\.find/g) || []).length;
    if (findMatches >= 2) {
      return { rows: findMatches, columns: 1 };
    }
  }

  const hasRowIteration = /\.forEach\(\(row[,)]/i.test(jsContent)
    || /\[\.\.\.block\.children\]\.forEach/i.test(jsContent)
    || /querySelectorAll\(['"]:scope\s*>\s*div['"]\)/i.test(jsContent);

  const columnMatches = jsContent.match(/row\.children\[(\d+)\]/g);
  let maxColumns = 1;
  if (columnMatches) {
    columnMatches.forEach((match) => {
      const colIndex = parseInt(match.match(/\[(\d+)\]/)[1], 10);
      if (colIndex + 1 > maxColumns) {
        maxColumns = colIndex + 1;
      }
    });
  }

  const hasColumnIteration = /row\.querySelectorAll\(['"]:scope\s*>\s*div['"]\)/i.test(jsContent)
    || /row\.children\]/i.test(jsContent)
    || /child\.children\]/i.test(jsContent)
    || /li\.children\]/i.test(jsContent)
    || /\[\.\.\.row\.children\]/i.test(jsContent)
    || /\[\.\.\.child\.children\]/i.test(jsContent)
    || /\[\.\.\.li\.children\]/i.test(jsContent);

  if (maxColumns === 1 && hasColumnIteration) {
    maxColumns = 2;
  }

  return {
    rows: hasRowIteration ? 2 : 1,
    columns: maxColumns,
  };
}

export async function analyzeBlock(api, blockName, blockPath = null) {
  // Default to standard blocks path if not provided
  const basePath = blockPath || `blocks/${blockName}`;

  const result = {
    blockName,
    description: null,
    variants: [],
    hasJS: false,
    hasCSS: false,
    structure: {
      classes: [],
      hasImage: false,
      hasHeading: false,
      hasButton: false,
      hasMultipleItems: false,
      isBEM: false,
      rows: 1,
      columns: 1,
    },
  };

  try {
    const jsContent = await api.fetchFileContents(`${basePath}/${blockName}.js`);
    if (jsContent) {
      result.hasJS = true;
      result.description = extractDescriptionFromJS(jsContent);

      const exportMatch = jsContent.match(/export\s+default\s+(?:async\s+)?function\s+(\w+)/);
      if (exportMatch) {
        const [, functionName] = exportMatch;
        result.structure.functionName = functionName;
      }

      const rowColStructure = detectRowColumnStructure(jsContent);
      result.structure.rows = rowColStructure.rows;
      result.structure.columns = rowColStructure.columns;
    }
  } catch (error) {
    // ignore
  }

  try {
    const cssContent = await api.fetchFileContents(`${basePath}/${blockName}.css`);
    if (cssContent) {
      result.hasCSS = true;
      result.structure.classes = extractClassesFromCSS(cssContent);
      result.variants = extractVariantsFromCSS(cssContent, blockName);
      Object.assign(result.structure, detectStructureFeatures(result.structure.classes));
    }
  } catch (error) {
    // ignore
  }

  return result;
}

export function generateBlockPlaceholder(blockName, analysis) {
  const autoDescription = analysis.description
    || generateAutoDescription(blockName, analysis.structure, analysis.variants);

  return {
    description: autoDescription,
    variants: analysis.variants,
    placeholder: generateStructuredPlaceholder(blockName, analysis.structure),
  };
}
