import { generateBlockPlaceholder } from './block-analysis.js';
import { getContentBlockPath } from '../constants.js';

export function generateBlockHTML(block, examples = []) {
  const {
    name, variants = [], analysis = null,
  } = block;

  let detectedVariants = variants;
  let placeholderContent = `        <div>
          <div>
            <p>Add your ${name} content here</p>
          </div>
        </div>`;

  if (analysis && examples.length === 0) {
    const blockData = generateBlockPlaceholder(name, analysis);
    detectedVariants = analysis.variants && analysis.variants.length > 0
      ? analysis.variants
      : variants;
    placeholderContent = blockData.placeholder;
  }

  const variantsToGenerate = detectedVariants.length > 0 ? detectedVariants : [''];

  const examplesByVariant = {};
  examples.forEach((example) => {
    const variant = example.variant || '';
    if (!examplesByVariant[variant]) {
      examplesByVariant[variant] = [];
    }
    examplesByVariant[variant].push(example);
  });

  const blockSections = variantsToGenerate.map((variant) => {
    const classAttr = variant ? ` ${variant}` : '';

    const variantExamples = examplesByVariant[variant] || [];

    let content;
    if (variantExamples.length > 0) {
      content = variantExamples[0].html;
    } else {
      content = placeholderContent;
    }

    return `    <div>
      <div class="${name}${classAttr}">
${content}
      </div>
    </div>`;
  }).join('\n');

  return `<body>
  <header></header>
  <main>
${blockSections}
  </main>
  <footer></footer>
</body>`;
}

function toDisplayName(name) {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export function generateBlocksJSON(blocks, org, site) {
  const dataSheet = blocks.map((block) => ({
    name: toDisplayName(block.name),
    path: block.path || getContentBlockPath(org, site, block.name),
  }));

  return {
    ':version': 3,
    ':type': 'sheet',
    total: dataSheet.length,
    limit: dataSheet.length,
    offset: 0,
    data: dataSheet,
  };
}
