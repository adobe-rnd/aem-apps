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
import { getProbeTarget, requestBlockName, assertBlockName } from './jobs.js';
import { parseInertHTML, validateAnalysisRequest, validateBlockAnalysis } from './block-analysis.js';

function escapeHTML(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function serializeNode(node) {
  if (node.nodeType === 3) return escapeHTML(node.textContent);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  const attrs = [...node.attributes].map(({ name, value }) => ` ${name}="${escapeHTML(value)}"`).join('');
  const opening = `<${tag}${attrs}>`;
  if (['img', 'br'].includes(tag)) return opening;
  return `${opening}${[...node.childNodes].map(serializeNode).join('')}</${tag}>`;
}

function renderBlockPage(blockName, examples, introduction = '') {
  const sections = examples.map((example) => {
    const rows = example.body.map((row) => {
      const cells = row.map((content) => `          <div>${content}</div>`).join('\n');
      return `        <div>\n${cells}\n        </div>`;
    }).join('\n');
    const metadata = [
      ['name', example.name],
      ['description', example.description],
      ['searchtags', `${blockName}, ${example.id}`],
    ].map(([key, value]) => (
      `        <div><div><p>${key}</p></div><div><p>${escapeHTML(value)}</p></div></div>`
    )).join('\n');
    return `    <div>
      <h2>${escapeHTML(example.name)}</h2>
      <div class="${[blockName, ...example.options].join(' ')}">
${rows}
      </div>
      <div class="library-metadata">
${metadata}
      </div>
    </div>`;
  }).join('\n');
  return `<body>
  <header></header>
  <main>
${introduction}${sections}
  </main>
  <footer></footer>
</body>`;
}

export function buildBlockPage(request, analysis, parseHTML = parseInertHTML) {
  validateBlockAnalysis(analysis, request, parseHTML);
  if (!analysis.examples.length) throw new Error(analysis.generation?.reason || 'This analysis cannot generate a page.');
  const blockName = requestBlockName(request);
  const examples = analysis.examples.map((example) => ({
    ...example,
    body: example.body.map((row) => row.map((markup) => (
      [...parseHTML(markup).childNodes].map(serializeNode).join('')
    ))),
  }));
  return renderBlockPage(blockName, examples);
}

export function buildBlockStarterPage(request, analysis, parseHTML = parseInertHTML) {
  validateBlockAnalysis(analysis, request, parseHTML);
  if (analysis.generation?.status !== 'blocked') {
    throw new Error('A default starter requires a blocked analysis.');
  }
  const { starter } = analysis.generation;
  const blockName = requestBlockName(request);
  const label = `${blockName} starter - author input required`;
  const instructions = starter
    ? 'Replace the cell instructions with real values'
    : 'No layout was inferred, so this block starts with one empty cell. Add the required rows, cells and usable values';
  const description = `Unfinished starter, not a working example. ${instructions} and configure required external content before using it. It may render empty or report errors until completed.`;
  const example = {
    id: 'starter',
    name: label,
    description,
    options: [],
    body: (starter?.body ?? [['']]).map((row) => row.map((cell) => (
      cell.trim() ? `<p>${escapeHTML(cell)}</p>` : ''
    ))),
  };
  const introduction = `    <div>
      <h1>${escapeHTML(blockName)} starter page</h1>
      <p>${description}</p>
      <p>${escapeHTML(analysis.generation.reason)}</p>
    </div>\n`;
  return renderBlockPage(blockName, [example], introduction);
}

export function getBlockLibraryPaths(config, target, blockName = 'cards') {
  assertBlockName(blockName);
  const expected = getProbeTarget(target);
  if (!target || Object.keys(expected).some((key) => target[key] !== expected[key])) {
    throw new Error('Library dry run target does not match the confirmed site target.');
  }
  const entries = config?.library?.data;
  if (Array.isArray(entries) && ((config.library.total !== undefined
    && config.library.total !== entries.length)
    || (config.library.offset !== undefined && config.library.offset !== 0))) {
    throw new Error('The site library configuration is partial; the Blocks registration is not confirmed.');
  }
  const blocks = Array.isArray(entries)
    ? entries.filter((entry) => typeof entry?.title === 'string'
      && entry.title.trim().toLowerCase() === 'blocks') : [];
  if (blocks.length !== 1 || typeof blocks[0].path !== 'string') {
    throw new Error('Dry run requires one existing site Blocks registration; no default will be guessed.');
  }
  const contentOrigin = target.environment === 'prod' ? 'https://content.da.live' : 'https://stage-content.da.live';
  const siteRoot = `/${target.org}/${target.site}`;
  let url;
  try {
    url = new URL(blocks[0].path);
  } catch (cause) {
    throw new Error('The Blocks registration must be an absolute site content URL.', { cause });
  }
  const indexPath = url.pathname.slice(siteRoot.length);
  if (url.origin !== contentOrigin || !url.pathname.startsWith(`${siteRoot}/`)
    || url.username || url.password || url.search || url.hash
    || indexPath.includes('//') || !/^\/[a-z0-9/_-]+\.json$/i.test(indexPath)) {
    throw new Error('The Blocks registration is not a safe JSON index in the selected site/environment.');
  }
  const directory = indexPath.slice(0, indexPath.lastIndexOf('/'));
  const pagePath = `${directory}/blocks/${blockName}.html`;
  return {
    indexPath,
    pagePath,
    indexURL: url.href,
    pageURL: `${contentOrigin}${siteRoot}${pagePath.slice(0, -5)}`,
  };
}

export function validateLibraryIndex(index) {
  if (!index || index[':type'] !== 'sheet' || index[':names'] !== undefined
    || !Array.isArray(index.data)
    || index.offset !== 0 || index.total !== index.data.length
    || !Number.isInteger(index.limit) || index.limit < index.data.length
    || index.data.some((row) => !row || typeof row.name !== 'string' || !row.name.trim()
      || typeof row.path !== 'string' || !row.path.trim())) {
    throw new Error('Dry run requires a complete root-sheet index; partial or unsupported formats are not rebuilt.');
  }
  return index;
}

export function mergeBlockIndex(index, paths, { allowRegistered = false } = {}) {
  validateLibraryIndex(index);
  const blockName = assertBlockName(paths.pagePath.split('/').at(-1).replace(/\.html$/, ''));
  const displayName = blockName.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  const plannedURL = new URL(paths.pageURL);
  const alreadyRegistered = index.data.some((row) => {
    if (row.name.trim().toLowerCase().replace(/\s+/g, '-') === blockName) return true;
    let url;
    try {
      url = new URL(row.path, paths.indexURL);
    } catch (cause) {
      throw new Error('The existing index contains an invalid page URL.', { cause });
    }
    const path = url.pathname.replace(/\/$/, '').replace(/\.html$/, '');
    return url.origin === plannedURL.origin && path === plannedURL.pathname;
  });
  if (alreadyRegistered && allowRegistered) {
    const matching = index.data.filter((row) => {
      const url = new URL(row.path, paths.indexURL);
      return url.origin === plannedURL.origin
        && url.pathname.replace(/\/$/, '').replace(/\.html$/, '') === plannedURL.pathname;
    });
    const sameName = (row) => row.name.trim().toLowerCase().replace(/\s+/g, '-') === blockName;
    if (matching.length === 1 && index.data.filter(sameName).length <= 1
      && !index.data.some((row) => sameName(row) && row !== matching[0])) {
      return { addedRow: null, after: { ...index, data: [...index.data] } };
    }
  }
  if (alreadyRegistered) throw new Error(`${displayName} is already registered; refusing to propose a duplicate or replacement.`);
  const addedRow = { name: displayName, path: paths.pageURL };
  const data = [...index.data, addedRow];
  return {
    addedRow,
    after: {
      ...index, data, total: data.length, limit: Math.max(index.limit, data.length),
    },
  };
}

export async function readLibraryResource(daFetch, url, signal) {
  const timeout = AbortSignal.timeout(15000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  combined.throwIfAborted();
  const response = await daFetch(url, {
    method: 'GET', cache: 'no-store', redirect: 'error', signal: combined,
  });
  combined.throwIfAborted();
  return { response, signal: combined };
}

export async function readLibraryText(daFetch, url, signal, expectedType, {
  allowMissing = false,
} = {}) {
  const read = await readLibraryResource(daFetch, url, signal);
  if (allowMissing && read.response.status === 404) {
    await read.response.body?.cancel();
    read.signal.throwIfAborted();
    return { text: null, etag: null, missing: true };
  }
  if (!read.response.ok) throw new Error(`Library source read failed (HTTP ${read.response.status}): ${url}`);
  if (!expectedType.test(read.response.headers.get('content-type') || '')) {
    throw new Error(`Library source returned an unexpected content type: ${url}`);
  }
  const text = await read.response.text();
  read.signal.throwIfAborted();
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
    throw new Error(`Library source exceeds the 1 MiB limit: ${url}`);
  }
  return { text, etag: read.response.headers.get('etag') };
}

export async function readLibraryJSON(daFetch, url, signal, options) {
  const read = await readLibraryText(daFetch, url, signal, /application\/json/i, options);
  if (read.missing) return { value: null, etag: null, missing: true };
  try {
    return { value: JSON.parse(read.text), etag: read.etag };
  } catch (cause) {
    throw new Error(`Library source contains invalid JSON: ${url}`, { cause });
  }
}

export async function prepareBlockLibraryDryRun({
  daFetch, request, analysis, parseHTML = parseInertHTML, signal, allowRegistered = false,
  starter = false,
}) {
  signal?.throwIfAborted();
  validateAnalysisRequest(request);
  const pageHTML = starter
    ? buildBlockStarterPage(request, analysis, parseHTML)
    : buildBlockPage(request, analysis, parseHTML);
  const { target } = request;
  const { value: config } = await readLibraryJSON(daFetch, `${target.adminOrigin}/config/${target.org}/${target.site}`, signal);
  const paths = getBlockLibraryPaths(config, target, requestBlockName(request));
  const sourceRoot = `${target.adminOrigin}/source/${target.org}/${target.site}`;
  const [indexRead, pageRead] = await Promise.all([
    readLibraryJSON(daFetch, `${sourceRoot}${paths.indexPath}`, signal),
    readLibraryResource(daFetch, `${sourceRoot}${paths.pagePath}`, signal),
  ]);
  const index = indexRead.value;
  await pageRead.response.body?.cancel();
  pageRead.signal.throwIfAborted();
  if (pageRead.response.ok) throw new Error('The example page already exists; dry run will not propose an overwrite.');
  if (pageRead.response.status !== 404) {
    throw new Error(`Checking the example page failed (HTTP ${pageRead.response.status}); absence is not confirmed.`);
  }
  const { after, addedRow } = mergeBlockIndex(index, paths, { allowRegistered });
  signal?.throwIfAborted();
  return {
    mode: 'dry-run',
    jobId: request.jobId,
    target: { ...target },
    writesPerformed: 0,
    configChangeRequired: false,
    ...(starter ? { starter: true } : {}),
    destinations: paths,
    operations: [
      {
        operation: 'create', sourcePath: paths.pagePath, contentType: 'text/html', content: pageHTML,
      },
      {
        operation: 'update', sourcePath: paths.indexPath, contentType: 'application/json', before: index, after, addedRow,
      },
    ],
    warnings: [
      'This is a proposal only, not a created, rendered or published page.',
      'Semantic review and visual verification are separate from recipe validation.',
      'A future write must re-read registration, index and destination to detect conflicts.',
    ],
  };
}

export {
  buildBlockPage as buildCardsPage,
  getBlockLibraryPaths as getCardsLibraryPaths,
  mergeBlockIndex as mergeCardsIndex,
  prepareBlockLibraryDryRun as prepareCardsLibraryDryRun,
};
