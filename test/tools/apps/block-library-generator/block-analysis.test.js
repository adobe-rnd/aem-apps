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
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createAnalysisRequest, validateAnalysisRequest, createAnalysisPrompt,
  validateBlockAnalysis, collectAnalysisInput,
} from '../../../../tools/apps/block-library-generator/block-analysis.js';
import { saveJobPointer, loadJobPointer, readJobRequest } from '../../../../tools/apps/block-library-generator/jobs.js';
import { buildBlockPage, getBlockLibraryPaths, mergeBlockIndex } from '../../../../tools/apps/block-library-generator/library-dry-run.js';
import { createLibraryPresentation, applyLibraryPresentation } from '../../../../tools/apps/block-library-generator/library-presentation.js';

const names = ['cards', 'columns', 'hero', 'header', 'footer', 'fragment', 'widget'];
const sourcePath = (name, ext = 'js') => `/blocks/${name}/${name}.${ext}`;
const input = (name) => ({
  blockName: name,
  entryPaths: [sourcePath(name)],
  prompt: 'Source-based analysis.',
  sourcePage: '/index.html',
  images: [],
  links: [{ href: '/index', label: 'Home' }],
  sources: [sourcePath(name), '/styles/styles.css', '/styles/lazy-styles.css']
    .map((id) => ({ id, content: id.endsWith('.js') ? '' : '/* CSS */' })),
  dependencyIssues: [],
});
const request = (name) => createAnalysisRequest({ environment: 'prod', input: input(name) });
const analysis = (name) => ({
  blockName: name,
  generation: { status: 'ready', reason: '' },
  analysisScope: {},
  structure: {},
  contentRules: {},
  derivedBehavior: {},
  sharedBehavior: {},
  optionAnalysis: { status: 'none-found', supportedOptions: [] },
  warnings: [],
  unknowns: [],
  examples: [{
    id: 'baseline',
    name: `${name} example`,
    description: 'Technical notes.',
    options: [],
    body: [['<p>Example</p>']],
    evidence: [sourcePath(name)],
    assumptions: [],
  }],
});
const parseHTML = () => {
  const p = {
    nodeType: 1, tagName: 'P', attributes: [], childNodes: [{ nodeType: 3, textContent: 'Example' }],
  };
  return {
    childNodes: [p],
    children: [p],
    textContent: 'Example',
    querySelectorAll: () => [p],
  };
};
const storage = () => {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
};

describe('Current-site generic block contracts', () => {
  it('supports all seven names with isolated job identities and generic prompts', () => {
    const store = storage();
    const requests = names.map(request);
    requests.forEach((value) => {
      validateAnalysisRequest(value);
      saveJobPointer(store, value);
      const saved = loadJobPointer(store, 'prod', 'analysis', value.input.blockName);
      assert.equal(saved.jobId, value.jobId);
      const prompt = createAnalysisPrompt(value);
      assert.ok(prompt.includes(`blockName must be ${value.input.blockName}.`));
      assert.match(prompt, /kind: analysis/);
      assert.match(prompt, /generation:.*status/);
      assert.ok(prompt.includes('payload.analysis.generation, alongside blockName and examples.'));
      assert.ok(prompt.includes(`"analysis": { "blockName": "${value.input.blockName}", "generation":`));
      assert.match(prompt, /payload\.analysis must contain: [^\n]+, generation\./);
      assert.match(prompt, /blocked/);
      assert.match(prompt, /Images are optional/);
      assert.match(prompt, /in warnings, not examples/);
    });
    assert.equal(new Set(requests.map((value) => value.jobId)).size, 7);
    assert.equal(loadJobPointer(store, 'stage', 'analysis', 'hero'), null);
    assert.equal(loadJobPointer(store, 'prod', 'cards'), null);
    assert.equal(loadJobPointer(store, 'prod', 'probe'), null);
  });

  it('makes empty-image requests explicitly image-free without allowing invented placeholders', () => {
    const empty = createAnalysisPrompt(request('cards'));
    const allowed = empty.match(/Allowed HTML tags: ([^\n]+)/)?.[1];
    assert.ok(allowed);
    assert.doesNotMatch(allowed, /\bIMG\b|\bPICTURE\b/);
    assert.match(empty, /No approved images were supplied/);
    assert.match(empty, /Do not output.*IMG.*PICTURE/);
    assert.match(empty, /\/placeholder/);
    assert.match(empty, /useful image-free examples/);
    assert.match(empty, /blocked.*examples: \[\]/);
    const supplied = createAnalysisPrompt(createAnalysisRequest({
      environment: 'prod',
      input: { ...input('cards'), images: [{ src: 'https://content.da.live/msagolj/ew/.index/image.jpg', alt: '' }] },
    }));
    assert.match(supplied.match(/Allowed HTML tags: ([^\n]+)/)[1], /\bIMG\b/);
    assert.match(supplied.match(/Allowed HTML tags: ([^\n]+)/)[1], /\bPICTURE\b/);
    assert.doesNotMatch(supplied, /No approved images were supplied/);
  });

  it('uses the immutable request as lossless evidence when source snapshots exceed chat transport', () => {
    const prepared = input('header');
    prepared.sources[0].content = 'const value = "FULL_SOURCE_SENTINEL";\n'.repeat(10000);
    const saved = createAnalysisRequest({ environment: 'prod', input: prepared });
    const before = JSON.stringify(saved);
    const prompt = createAnalysisPrompt(saved);
    assert.ok(new TextEncoder().encode(prompt).byteLength <= 256 * 1024);
    assert.match(prompt, /REFERENCE-BACKED INPUT/);
    assert.ok(prompt.includes(`.da/block-library-generator/jobs/${saved.jobId}/request.json`));
    assert.ok(prompt.includes('/blocks/header/header.js'));
    assert.doesNotMatch(prompt, /FULL_SOURCE_SENTINEL/);
    assert.match(prompt, /If any read is truncated or incomplete, stop/);
    assert.match(prompt, /CHAT COMPLETION/);
    assert.equal(JSON.stringify(saved), before);
  });

  it('references oversized semantic context without truncating it or weakening result write scope', () => {
    const prepared = input('header');
    prepared.prompt = 'COMPLETE_SEMANTIC_RULES\n'.repeat(15000);
    const saved = createAnalysisRequest({ environment: 'prod', input: prepared });
    const prompt = createAnalysisPrompt(saved);
    assert.ok(new TextEncoder().encode(prompt).byteLength <= 256 * 1024);
    assert.match(prompt, /REFERENCE-BACKED INPUT/);
    assert.doesNotMatch(prompt, /COMPLETE_SEMANTIC_RULES/);
    assert.ok(prompt.includes(`path: ${saved.resultPath.slice(1)}`));
    assert.match(prompt, /Keep the request file unchanged/);
    assert.match(prompt, /verify its jobId, kind, target and resultPath/);
    assert.equal(saved.input.prompt, prepared.prompt);
  });

  it('still rejects an oversized reference envelope instead of truncating its source manifest', () => {
    const prepared = input('header');
    prepared.sources.push(...Array.from({ length: 4000 }, (_, index) => ({
      id: `/scripts/${'long-name-'.repeat(8)}${index}.js`, content: 'x',
    })));
    const saved = createAnalysisRequest({ environment: 'prod', input: prepared });
    assert.throws(() => createAnalysisPrompt(saved), /256 KiB.*no truncation/);
    assert.equal(saved.input.sources.length, 4003);
  });

  it('ends each workflow prompt with chat-only return guidance after verified result persistence', () => {
    names.forEach((name) => {
      const value = request(name);
      const before = JSON.stringify(value);
      const prompt = createAnalysisPrompt(value);
      const completion = prompt.slice(prompt.indexOf('CHAT COMPLETION'));
      assert.match(completion, /Only after.*saved.*read back.*confirmed/);
      assert.ok(completion.includes(`Analysis finished. Please reopen Block Library Generator from Outline in ${value.target.org}/${value.target.site}, select ${name}, and continue.`));
      assert.match(completion, /blocked.*more input is needed/);
      assert.match(completion, /fails.*report the actual problem/);
      assert.match(completion, /Do not claim success/);
      assert.match(completion, /JSON-only.*saved result file.*not.*chat reply/);
      assert.match(completion, /Never append.*result JSON/);
      assert.match(completion, /Do not claim.*page.*created.*published.*dialog.*reopened/);
      assert.equal(JSON.stringify(value), before);
    });
  });

  it('asks for concise author-facing blocked reasons while retaining technical detail elsewhere', () => {
    const prompt = createAnalysisPrompt(request('header'));
    assert.match(prompt, /generation\.reason.*one or two short sentences/);
    assert.match(prompt, /concrete missing input/);
    assert.match(prompt, /Do not include code excerpts, source citations, line numbers/);
    assert.match(prompt, /supporting detail in the other analysis fields/);
  });

  it('distinguishes missing author inputs from unverified rendering without treating DOM clearing as ignored input', async () => {
    const prompt = createAnalysisPrompt(request('header'));
    assert.match(prompt, /An unverified rendering dependency alone is not a reason to block/);
    assert.match(prompt, /ready.*unverified authored examples/);
    assert.match(prompt, /consumed before.*cleared or replaced/);
    assert.match(prompt, /real external resource reference.*not supplied/);
    assert.match(prompt, /essential.*valid authoring structure or input/);
    assert.match(prompt, /Do not ignore observed dependency failures or known-broken output/);
    const semanticPrompt = await readFile(new URL(
      '../../../../tools/apps/block-library-generator/block-analysis-prompt.txt',
      import.meta.url,
    ), 'utf8');
    assert.match(semanticPrompt, /Values read before clearing or replacing the DOM/);
    assert.match(semanticPrompt, /module import is not itself a missing author input/);
    assert.match(semanticPrompt, /does not prove that the rendered result works/);
    assert.doesNotMatch(semanticPrompt, /commerce-account-header|frescopa|uiProvider/);
  });

  it('allows explicit blocked analysis without fake examples, but never builds a page from it', () => {
    const value = request('header');
    const blocked = {
      ...analysis('header'),
      generation: { status: 'blocked', reason: 'Needs navigation fragment; authored cells are replaced.' },
      examples: [],
    };
    assert.equal(validateBlockAnalysis(blocked, value, parseHTML).generation.status, 'blocked');
    assert.throws(() => buildBlockPage(value, blocked, parseHTML), /navigation fragment/);
    assert.throws(() => validateBlockAnalysis({
      ...blocked, examples: analysis('header').examples,
    }, value, parseHTML), /fabricated/);
    assert.throws(() => validateBlockAnalysis({
      ...analysis('header'), examples: [],
    }, value, parseHTML), /examples/);
  });

  it('accepts a source-anchored plain-text starter layout without changing the blocked verdict', () => {
    const value = request('header');
    const blocked = {
      ...analysis('header'),
      generation: {
        status: 'blocked',
        reason: 'Provide a real content-fragment path.',
        starter: {
          body: [['Content Fragment path - replace with a real value'], ['Variation (optional)']],
          evidence: ['/blocks/header/header.js'],
        },
      },
      examples: [],
    };
    assert.equal(validateBlockAnalysis(blocked, value, parseHTML).generation.status, 'blocked');
    assert.throws(() => buildBlockPage(value, blocked, parseHTML), /content-fragment/);
    const prompt = createAnalysisPrompt(value);
    assert.match(prompt, /generation\.starter/);
    assert.match(prompt, /plain-text cell labels/);
    assert.match(prompt, /not working examples/);
    const invalid = [
      { body: [['One'], ['Two', 'Three']], evidence: ['/blocks/header/header.js'] },
      { body: [['One']], evidence: ['/invented/source.js'] },
      { body: [['x'.repeat(241)]], evidence: ['/blocks/header/header.js'] },
      { body: Array.from({ length: 13 }, () => ['One']), evidence: ['/blocks/header/header.js'] },
      { body: [[42]], evidence: ['/blocks/header/header.js'] },
      { body: [['One']], evidence: [] },
      { body: [['One']], evidence: ['/blocks/header/header.js'], options: ['invented'] },
    ];
    invalid.forEach((starter) => assert.throws(() => validateBlockAnalysis({
      ...blocked, generation: { ...blocked.generation, starter },
    }, value, parseHTML), /starter/i));
    assert.throws(() => validateBlockAnalysis({
      ...analysis('header'),
      generation: { status: 'ready', reason: '', starter: blocked.generation.starter },
    }, value, parseHTML), /starter/i);
  });

  it('rejects cross-block payloads, unsafe names, undeclared sources and missing generation verdicts', () => {
    assert.throws(() => validateBlockAnalysis(analysis('hero'), request('columns'), parseHTML), /columns/);
    assert.throws(() => request('../hero'), /name/);
    assert.throws(() => createAnalysisRequest({
      input: { ...input('columns'), sources: input('hero').sources },
    }), /bundle/);
    const invalid = analysis('columns');
    delete invalid.generation;
    assert.throws(() => validateBlockAnalysis(invalid, request('columns'), parseHTML), /verdict/);
  });

  it('rejects verdicts outside the analysis object rather than silently moving them', () => {
    const value = request('hero');
    const payload = { analysis: analysis('hero'), generation: analysis('hero').generation };
    delete payload.analysis.generation;
    assert.throws(() => validateBlockAnalysis(payload.analysis, value, parseHTML), /verdict/);
    assert.equal(payload.analysis.generation, undefined);
    assert.equal(payload.generation.status, 'ready');
  });

  it('keeps generic request readback correlated even when two jobs share the same kind', async () => {
    const hero = request('hero');
    const columns = request('columns');
    await assert.rejects(readJobRequest(async () => Response.json(columns), hero.jobId, {
      environment: 'prod', kind: 'analysis',
    }), /identity/);
  });

  it('builds correct wrapper classes, paths, tags, author copy and preserved index for every name', () => {
    names.forEach((name) => {
      const value = request(name);
      const raw = analysis(name);
      const copy = createLibraryPresentation(raw, parseHTML);
      const projected = applyLibraryPresentation(raw, copy, ['baseline']);
      const html = buildBlockPage(value, projected, parseHTML);
      assert.ok(html.includes(`class="${name}"`));
      assert.ok(html.includes(`${name}, baseline`));
      if (name !== 'cards') assert.ok(html.includes(raw.examples[0].name));
      if (name !== 'cards') assert.doesNotMatch(html, /class="cards"|Text cards/);
      const paths = getBlockLibraryPaths({
        library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] },
      }, value.target, name);
      assert.equal(paths.pagePath, `/docs/library/blocks/${name}.html`);
      const index = {
        ':type': 'sheet', offset: 0, total: 0, limit: 0, data: [], extra: 'retain',
      };
      const merged = mergeBlockIndex(index, paths);
      assert.equal(merged.after.extra, 'retain');
      assert.equal(merged.addedRow.path, paths.pageURL);
      assert.equal(merged.addedRow.name.toLowerCase(), name);
      assert.throws(() => mergeBlockIndex(merged.after, paths), /registered/);
    });
  });
});

describe('Discovered source collection', () => {
  function options(name) {
    const reads = [];
    const contents = new Map();
    const paths = [sourcePath(name), sourcePath(name, 'css')];
    paths.forEach((path) => contents.set(path, ''));
    contents.set('/styles/styles.css', '');
    contents.set('/styles/lazy-styles.css', '');
    return {
      reads,
      contents,
      args: {
        environment: 'prod',
        blockName: name,
        entryPaths: paths,
        sourcePage: '/index',
        fetchLocal: async () => new Response('Semantic prompt.', { headers: { 'Content-Type': 'text/plain' } }),
        parseHTML: () => ({ querySelectorAll: () => [] }),
        daFetch: async (url) => {
          reads.push(url);
          const path = new URL(url).pathname;
          if (path.endsWith('/index.html')) return new Response('<main>Home</main>', { headers: { 'Content-Type': 'text/html' } });
          if (!contents.has(path)) return new Response(null, { status: 404 });
          return new Response(contents.get(path), { headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } });
        },
      },
    };
  }

  it('retains Hero empty JS, supports CSS-only/JS-only entry inventories and requires no image', async () => {
    const f = options('hero');
    const value = await collectAnalysisInput(f.args);
    assert.deepEqual(value.images, []);
    assert.equal(value.sources.find((source) => source.id === sourcePath('hero')).content, '');
    const cssOnly = await collectAnalysisInput({ ...f.args, entryPaths: [sourcePath('hero', 'css')] });
    assert.equal(cssOnly.sources.length, 3);
    const jsOnly = await collectAnalysisInput({ ...f.args, entryPaths: [sourcePath('hero')] });
    assert.equal(jsOnly.sources.length, 3);
    assert.throws(() => createAnalysisRequest({
      input: { ...value, entryPaths: [] },
    }), /bundle/);
  });

  it('collects current code without a launch-document reference or document-image parsing', async () => {
    const f = options('hero');
    const value = await collectAnalysisInput({
      ...f.args,
      sourcePage: undefined,
      parseHTML: () => { throw new Error('Do not inspect document images'); },
    });
    assert.equal(value.sourcePage, null);
    assert.deepEqual(value.images, []);
    assert.equal(f.reads.filter((url) => url.includes('/source/')).length, 1);
    assert.ok(f.reads.includes('https://admin.da.live/source/msagolj/ew/index.html'));
    const saved = createAnalysisRequest({ environment: 'prod', input: value });
    assert.equal(validateAnalysisRequest(saved).input.sourcePage, null);
    assert.ok(createAnalysisPrompt(saved).includes('blockName must be hero.'));
  });

  it('captures relevant local imports and framework summaries without reading preprocessing or executing code', async () => {
    const f = options('footer');
    f.contents.set(sourcePath('footer'), "import { getMetadata } from '../../scripts/aem.js';\nimport { loadFragment } from '../fragment/fragment.js';");
    f.contents.set('/blocks/fragment/fragment.js', "import { decorateMain } from '../../scripts/scripts.js';\nimport { loadSections } from '../../scripts/aem.js';");
    const value = await collectAnalysisInput(f.args);
    assert.ok(value.sources.some((source) => source.id === '/blocks/fragment/fragment.js'));
    assert.ok(value.helperContext.includes('getMetadata'));
    assert.ok(value.helperContext.includes('outside this analysis'));
    assert.ok(f.reads.every((url) => !url.endsWith('/scripts/aem.js') && !url.endsWith('/scripts/scripts.js')));
  });

  it('distinguishes configuration keys from options and checks example descriptions against their recipes', async () => {
    const prompt = createAnalysisPrompt(request('cards'));
    assert.match(prompt, /Only author-selected classes on the block belong in supportedOptions/);
    assert.match(prompt, /Configuration-row keys belong in contentRules/);
    const semanticPrompt = await readFile(new URL(
      '../../../../tools/apps/block-library-generator/block-analysis-prompt.txt',
      import.meta.url,
    ), 'utf8');
    assert.match(semanticPrompt, /Configuration-row keys.*not block options/);
    assert.match(semanticPrompt, /Do not assign an ancestor class to a particular element type/);
    assert.match(semanticPrompt, /description matches its actual recipe/);
    assert.match(semanticPrompt, /Do not invent intrinsic image dimensions/);
  });

  it('allows supported empty baselines without confusing appended content or unrelated URL overrides', async () => {
    const prompt = createAnalysisPrompt(request('cards'));
    assert.match(prompt, /No editable body values alone is not a reason to block/);
    assert.match(prompt, /omit optional route\/resource overrides/);
    const semanticPrompt = await readFile(new URL(
      '../../../../tools/apps/block-library-generator/block-analysis-prompt.txt',
      import.meta.url,
    ), 'utf8');
    assert.match(semanticPrompt, /Appending content alone does not remove existing authored cells/);
    assert.match(semanticPrompt, /no authored values can still have an empty-cell baseline/);
    assert.match(semanticPrompt, /approved but unsuitable URL/);
  });

  it('supplies the isolated output-page context instead of assuming missing metadata or companion blocks', () => {
    const prompt = createAnalysisPrompt(request('cards'));
    assert.match(prompt, /isolated library page/);
    assert.match(prompt, /No companion blocks, custom page metadata or URL\/query context is supplied/);
    assert.match(prompt, /Known required context that is not supplied blocks/);
    assert.match(prompt, /An arbitrary string accepted by a parser is not an established indexed identifier/);
    assert.match(prompt, /Use a literal empty string cell/);
  });

  it('distinguishes visible defaults from known-empty guards, API factories and background grouping', async () => {
    const semanticPrompt = await readFile(new URL(
      '../../../../tools/apps/block-library-generator/block-analysis-prompt.txt',
      import.meta.url,
    ), 'utf8');
    assert.match(semanticPrompt, /Verify that the default export can actually accept the block element/);
    assert.match(semanticPrompt, /programmatic factory/);
    assert.match(semanticPrompt, /Known-empty output is not an unverified renderer/);
    assert.match(semanticPrompt, /local mock data or a fixed visible title/);
    assert.match(semanticPrompt, /image-only first paragraph/);
    assert.match(semanticPrompt, /foreground siblings/);
    assert.match(semanticPrompt, /Do not apply this shape universally/);
    assert.match(semanticPrompt, /Equivalent link markup does not establish primary versus secondary/);
  });

  it('keeps required resource roles and fixed-position galleries honest', async () => {
    const prompt = createAnalysisPrompt(request('cards'));
    assert.match(prompt, /Required media, fragment and indexed business references/);
    assert.match(prompt, /A homepage is not a video manifest, form definition or fragment/);
    const semanticPrompt = await readFile(new URL(
      '../../../../tools/apps/block-library-generator/block-analysis-prompt.txt',
      import.meta.url,
    ), 'utf8');
    assert.match(semanticPrompt, /fixed-position instances would overlap at the same coordinates/);
    assert.match(semanticPrompt, /Do not treat a landscape image as a small icon/);
    assert.match(semanticPrompt, /invent segment, group or rule identifiers/);
  });

  it('accepts unambiguous source L-line citations while preserving source identity and range bounds', () => {
    const prepared = input('header');
    prepared.sources[0].content = 'first line\nsecond line';
    const saved = createAnalysisRequest({ environment: 'prod', input: prepared });
    const result = analysis('header');
    const id = sourcePath('header');
    [`${id}:1-2`, `${id}:L1-L2`, `${id} L1-L2`, `${id}\tL2`,
      `${id}:L1, L2`, `${id} L1, L2-L2`].forEach((reference) => {
      result.examples[0].evidence = [reference];
      assert.doesNotThrow(() => validateBlockAnalysis(result, saved, parseHTML));
      assert.deepEqual(result.examples[0].evidence, [reference]);
    });
    [`${id} L0`, `${id} L2-L1`, `${id} L1-L3`, `${id} L1-L2 extra`,
      `${id}:L1,`, `${id}:L1,,L2`, `${id}:L1,L3`,
      '/unknown.js L1-L2', 'framework.dom L1'].forEach((reference) => {
      result.examples[0].evidence = [reference];
      assert.throws(() => validateBlockAnalysis(result, saved, parseHTML), /evidence/);
    });
  });

  it('supplies readBlockConfig semantics and accepts its evidence only when the contract was supplied', async () => {
    const f = options('header');
    f.contents.set(sourcePath('header'), "import { readBlockConfig } from '../../scripts/aem.js';");
    const value = await collectAnalysisInput(f.args);
    assert.match(value.helperContext, /readBlockConfig\(block\)/);
    assert.match(value.helperContext, /direct body rows with at least two cells/);
    assert.match(value.helperContext, /first cell.*normalized key/);
    assert.match(value.helperContext, /Record ID.*record-id.*not.*recordid/);
    assert.match(value.helperContext, /not trimmed or type-coerced/);
    assert.match(value.helperContext, /normalization does not add classes/);
    assert.match(value.helperContext, /second cell.*link.*image.*paragraph.*plain text/);
    assert.match(value.helperContext, /one item.*string.*multiple.*array/);
    assert.match(value.helperContext, /Later duplicate keys overwrite/);
    assert.ok(f.reads.every((url) => !url.endsWith('/scripts/aem.js')));
    const saved = createAnalysisRequest({ environment: 'prod', input: value });
    const result = analysis('header');
    result.examples[0].evidence.push('helper.readBlockConfig');
    assert.doesNotThrow(() => validateBlockAnalysis(result, saved, parseHTML));
    assert.ok(createAnalysisPrompt(saved).includes('helper.readBlockConfig'));
    const withoutContract = {
      ...saved, input: { ...saved.input, helperContext: undefined },
    };
    assert.throws(() => validateBlockAnalysis(result, withoutContract, parseHTML), /evidence/);
  });
  it('records unavailable and runtime imports explicitly, never sends DA credentials to external import URLs', async () => {
    const f = options('widget');
    f.contents.set(sourcePath('widget'), "import { loadCSS } from '../../scripts/aem.js';\nimport missing from './missing.js';\nawait import(widgetUrl('js'));\nimport remote from 'https://untrusted.example/other.js';");
    const value = await collectAnalysisInput(f.args);
    assert.ok(value.dependencyIssues.some((issue) => issue.dependency === 'dynamic import'));
    assert.ok(value.dependencyIssues.some((issue) => issue.reason.includes('HTTP 404')));
    assert.ok(value.dependencyIssues.some((issue) => issue.dependency.includes('untrusted')));
    assert.ok(f.reads.every((url) => !url.startsWith('https://untrusted')));
    assert.match(createAnalysisPrompt(createAnalysisRequest({ environment: 'prod', input: value })), /UNRESOLVED DEPENDENCIES/);
  });

  it('does not hide missing required entries or accept cross-block source-path requests', async () => {
    const f = options('columns');
    f.contents.delete(sourcePath('columns'));
    await assert.rejects(collectAnalysisInput(f.args), /HTTP 404/);
    await assert.rejects(collectAnalysisInput({ ...f.args, entryPaths: [sourcePath('hero')] }), /verified/);
  });
});
