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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS_SOURCE_PATHS, createCardsRequest, createCardsPrompt, validateCardsAnalysis,
  collectCardsInput, validateCellHTML,
} from '../../../../tools/apps/block-library-generator/cards-analysis.js';
import { loadJobPointer, saveJobPointer, loadProbePointer } from '../../../../tools/apps/block-library-generator/jobs.js';

const image = 'https://content.da.live/msagolj/ew/.index/example.jpg';
const input = () => ({
  prompt: 'Saved analysis prompt.',
  sourcePage: '/index.html',
  sources: CARDS_SOURCE_PATHS.map((path) => ({ id: path, content: 'Source text.' })),
  images: [{ src: image, alt: 'Example image' }],
  links: [{ href: '/index', label: 'Test site home' }],
});
const request = () => createCardsRequest({ environment: 'prod', input: input() });
const recipe = () => ({
  id: 'text-only',
  name: 'Text cards',
  description: 'Rich text.',
  options: [],
  body: [['<p>Example</p>']],
  evidence: [CARDS_SOURCE_PATHS[0]],
  assumptions: [],
});
const analysis = () => ({
  blockName: 'cards',
  analysisScope: {},
  optionAnalysis: { status: 'none-found', supportedOptions: [] },
  structure: {},
  contentRules: [],
  derivedBehavior: {},
  sharedBehavior: {},
  examples: [recipe()],
  warnings: [],
  unknowns: [],
});
const element = (tag, attrs = {}) => ({
  tagName: tag.toUpperCase(),
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  hasAttribute: (name) => Object.hasOwn(attrs, name),
  getAttribute: (name) => attrs[name] ?? null,
});
// These fixtures test element-policy evaluation, not browser HTML parsing.
const fragment = (...elements) => ({
  querySelectorAll: () => elements,
  children: elements,
});
const parseText = () => fragment(element('p'));

describe('Cards analysis protocol', () => {
  it('creates a separate kind and embeds source/image snapshots', () => {
    const value = request();
    assert.equal(value.kind, 'cards');
    assert.equal(value.target.environment, 'prod');
    assert.equal(value.input.sources.length, 4);
    assert.equal(value.input.images[0].src, image);
    assert.equal(value.input.links[0].href, '/index');
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, val) => values.set(key, val),
    };
    saveJobPointer(storage, value);
    assert.equal(loadJobPointer(storage, 'prod', 'cards').jobId, value.jobId);
    assert.equal(loadProbePointer(storage, 'prod'), null);
  });

  it('rejects missing sources, missing images and unsupported source pages', () => {
    [
      { ...input(), sources: [] },
      { ...input(), images: [] },
      { ...input(), sourcePage: '//untrusted.example/index.html' },
      { ...input(), sourcePage: '//index' },
      { ...input(), sourcePage: '/folder//index' },
    ].forEach((value) => {
      assert.throws(() => createCardsRequest({ input: value }), /source|image|page/i);
    });
  });

  it('includes the unchanged saved prompt and explicit HTML/image/output rules', () => {
    const value = request();
    const prompt = createCardsPrompt(value);
    assert.ok(prompt.includes(value.input.prompt));
    assert.ok(prompt.includes(image));
    assert.ok(prompt.includes(`path: ${value.resultPath.slice(1)}`));
    assert.match(prompt, /kind.*cards/i);
    assert.match(prompt, /No library page/i);
    assert.match(prompt, /library.*configuration/i);
    assert.match(prompt, /rectangle|rectangular/i);
    assert.match(prompt, /application\/json/);
    assert.match(prompt, /APPROVED LINK DESTINATIONS/);
    assert.match(prompt, /"href": "\/index"/);
    assert.match(prompt, /only.*approved.*href/i);
  });

  it('presents numbered source lines without changing the raw request snapshots', () => {
    const data = input();
    data.sources[0].content = 'first\n\nthird\n';
    const value = createCardsRequest({ input: data });
    const prompt = createCardsPrompt(value);
    assert.ok(prompt.includes(`SOURCE ${CARDS_SOURCE_PATHS[0]}\nL1: first\nL2: \nL3: third\nL4: `));
    assert.equal(value.input.sources[0].content, 'first\n\nthird\n');
    assert.match(prompt, /line labels are not source text/i);
    assert.match(prompt, /cite.*actual.*support/i);
  });

  it('retains the prompt transport limit without silently truncating numbered sources', () => {
    const data = input();
    data.sources[0].content = 'x'.repeat(256 * 1024);
    const value = createCardsRequest({ input: data });
    const prompt = createCardsPrompt(value);
    assert.ok(new TextEncoder().encode(prompt).byteLength <= 256 * 1024);
    assert.match(prompt, /REFERENCE-BACKED INPUT/);
    assert.ok(prompt.includes(`.da/block-library-generator/jobs/${value.jobId}/request.json`));
    assert.equal(value.input.sources[0].content, data.sources[0].content);
  });

  it('rejects malformed or unapproved trial-link snapshots', () => {
    [[], null, [{ href: '/invented', label: 'Invented' }], [{ href: '/index' }]].forEach((links) => {
      assert.throws(() => createCardsRequest({ input: { ...input(), links } }), /link/i);
    });
  });

  it('enforces exact approved href values in new results without breaking legacy results', () => {
    const data = input();
    const value = createCardsRequest({ input: data });
    const withLink = (href) => ({
      ...analysis(), examples: [{ ...recipe(), body: [[`<p><a href="${href}">Home</a></p>`]] }],
    });
    const parseLink = (href) => () => fragment(element('a', { href }));
    assert.doesNotThrow(() => validateCardsAnalysis(withLink('/index'), value, parseLink('/index')));
    ['/games/invented', '/index.html', '/index#made-up', '#', 'https://example.com'].forEach((href) => {
      assert.throws(() => validateCardsAnalysis(withLink(href), value, parseLink(href)), /approved link/i);
    });
    delete data.links;
    const legacy = createCardsRequest({ input: data });
    assert.doesNotThrow(() => {
      validateCardsAnalysis(withLink('/games/invented'), legacy, parseLink('/games/invented'));
    });
    assert.match(createCardsPrompt(legacy), /Legacy request.*no approved link snapshot/i);
  });

  it('includes general reasoning checks for all six reviewed semantic failures', async () => {
    const promptURL = new URL('../../../../tools/apps/block-library-generator/block-analysis-prompt.txt', import.meta.url);
    const semanticPrompt = await readFile(promptURL, 'utf8');
    assert.match(semanticPrompt, /moving whole cells/i);
    assert.match(semanticPrompt, /normalized DOM,\s+predicate, result trace/i);
    assert.match(semanticPrompt, /no enforced count\s+limit/i);
    assert.match(semanticPrompt, /fewer rows.*shorter copy/i);
    assert.match(semanticPrompt, /minimum track/i);
    assert.match(semanticPrompt, /verify each cited line/i);
    assert.match(semanticPrompt, /approved link/i);
  });

  it('instructs literal apostrophe copying and still rejects a percent-encoded substitution', () => {
    const literalImage = image.replace('example.jpg', "demon's%20souls.jpg");
    const encodedImage = literalImage.replace("'", '%27');
    const value = createCardsRequest({
      input: { ...input(), images: [{ src: literalImage, alt: '' }] },
    });
    const prompt = createCardsPrompt(value);
    assert.ok(prompt.includes(literalImage));
    assert.match(prompt, /byte-for-byte/);
    assert.match(prompt, /Never change a literal apostrophe/);
    const parseImage = (src) => () => ({
      children: [{}],
      querySelectorAll: () => [element('img', { src, alt: '' })],
    });
    const literalHTML = `<img src="${literalImage}" alt="">`;
    const encodedHTML = `<img src="${encodedImage}" alt="">`;
    assert.doesNotThrow(() => {
      validateCellHTML(literalHTML, [literalImage], parseImage(literalImage));
    });
    assert.throws(() => {
      validateCellHTML(encodedHTML, [literalImage], parseImage(encodedImage));
    }, /approved source/i);
  });

  it('accepts shaped analysis and rejects ragged rows, duplicate IDs and unsupported options', () => {
    const value = request();
    assert.equal(validateCardsAnalysis(analysis(), value, parseText).blockName, 'cards');
    [
      { ...recipe(), body: [['<p>one</p>'], ['<p>two</p>', '']] },
      { ...recipe(), options: ['invented'] },
      { ...recipe(), evidence: ['unprovided-source.js'] },
      { ...recipe(), body: [[42]] },
    ].forEach((badRecipe) => {
      const candidate = { ...analysis(), examples: [badRecipe] };
      assert.throws(() => validateCardsAnalysis(candidate, value, parseText));
    });
    assert.throws(() => validateCardsAnalysis({
      ...analysis(), examples: [recipe(), recipe()],
    }, value, parseText), /unique/i);
  });

  it('rejects a different block and missing analysis fields', () => {
    assert.throws(() => validateCardsAnalysis({ ...analysis(), blockName: 'hero' }, request(), parseText));
    const value = analysis();
    delete value.structure;
    assert.throws(() => validateCardsAnalysis(value, request(), parseText), /structure/i);
  });

  it('rejects malformed analysis containers before accepting recipes', () => {
    [
      { analysisScope: [] }, { structure: null }, { contentRules: 'invented' },
      { derivedBehavior: 42 }, { warnings: 'none' }, { unknowns: null },
    ].forEach((change) => {
      const candidate = { ...analysis(), ...change };
      assert.throws(() => validateCardsAnalysis(candidate, request(), parseText));
    });
  });
});

describe('HTML element policy', () => {
  it('explains empty image approvals without blaming a valid decorative alt attribute', () => {
    ['img', 'picture'].forEach((tag) => {
      assert.throws(() => validateCellHTML(
        '<picture><img src="/placeholder" alt=""></picture>',
        [],
        () => fragment(element(tag, tag === 'img' ? { src: '/placeholder', alt: '' } : {})),
      ), /No approved images.*image-free.*placeholder/);
    });
    assert.throws(() => validateCellHTML(`<img src="${image}">`, [image], () => fragment(element('img', { src: image }))), /alt attribute/);
  });

  it('accepts simple rich text and allowlisted pictures with explicit alt', () => {
    validateCellHTML('<p>Example</p>', [image], parseText);
    validateCellHTML('<picture><img></picture>', [image], () => fragment(element('picture'), element('img', { src: image, alt: '' })));
    validateCellHTML('', [image], () => { throw new Error('Empty cells need no parser'); });
  });

  describe('Cards input collection', () => {
    function options() {
      return {
        environment: 'prod',
        sourcePage: '/index',
        fetchLocal: async () => new Response('Saved prompt.', {
          headers: { 'Content-Type': 'text/plain' },
        }),
        daFetch: async (url) => {
          const extension = url.split('.').at(-1);
          const types = { html: 'text/html', css: 'text/css', js: 'text/javascript' };
          return new Response(extension === 'html' ? '<body></body>' : '', {
            headers: { 'Content-Type': types[extension] },
          });
        },
        parseHTML: () => ({
          querySelectorAll: () => [element('img', { src: image, alt: '' })],
        }),
      };
    }

    it('retains empty source files, exact image URLs and the original saved prompt', async () => {
      const value = await collectCardsInput(options());
      assert.equal(value.sourcePage, '/index.html');
      assert.equal(value.prompt, 'Saved prompt.');
      assert.ok(value.sources.every((source) => source.content === ''));
      assert.equal(value.images[0].src, image);
      assert.deepEqual(value.links, [{ href: '/index', label: 'Test site home' }]);
    });

    it('verifies the approved destination through DA source when launched from another page', async () => {
      const reads = [];
      const base = options();
      const value = await collectCardsInput({
        ...base,
        sourcePage: '/another',
        daFetch: async (url, init) => { reads.push(url); return base.daFetch(url, init); },
      });
      assert.equal(value.sourcePage, '/another.html');
      assert.ok(reads.includes('https://admin.da.live/source/msagolj/ew/index.html'));
      assert.equal(value.links[0].href, '/index');
    });

    it('fails rather than substituting links when the approved source page is missing or empty', async () => {
      const base = options();
      const responses = [new Response('', { status: 404 }), new Response('', {
        headers: { 'Content-Type': 'text/html' },
      })];
      await Promise.all(responses.map((response) => assert.rejects(collectCardsInput({
        ...base,
        sourcePage: '/another',
        daFetch: async (url, init) => (url.endsWith('/index.html')
          ? response : base.daFetch(url, init)),
      }), /404|approved link/i)));
    });

    it('fails explicitly if the launch document supplies no approved site images', async () => {
      await assert.rejects(collectCardsInput({
        ...options(),
        parseHTML: () => ({
          querySelectorAll: () => [element('img', { src: 'https://untrusted.example/image.jpg' })],
        }),
      }), /images/i);
    });

    it('does not mistake a 200 HTML error page for JavaScript or CSS', async () => {
      await assert.rejects(collectCardsInput({
        ...options(),
        daFetch: async () => new Response('<html>Error</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      }), /content type/i);
    });

    it('honors cancellation before starting collection', async () => {
      const controller = new AbortController();
      controller.abort();
      let called = false;
      await assert.rejects(collectCardsInput({
        ...options(),
        signal: controller.signal,
        daFetch: async () => { called = true; return new Response(''); },
      }), /abort/i);
      assert.equal(called, false);
    });
  });

  it('rejects executable elements and unsupported attributes', () => {
    [
      element('script'), element('iframe'), element('svg'), element('style'),
      element('p', { onclick: 'alert(1)' }), element('p', { style: 'color:red' }),
      element('p', { class: 'invented' }), element('img', { src: image, alt: '', srcset: image }),
    ].forEach((node) => {
      assert.throws(() => validateCellHTML('<p>Example</p>', [image], () => fragment(node)));
    });
  });

  it('rejects arbitrary images, missing alt and unsafe links', () => {
    [
      element('img', { src: 'https://untrusted.example/image.jpg', alt: '' }),
      element('img', { src: image }),
      // eslint-disable-next-line no-script-url
      element('a', { href: 'javascript:alert(1)' }),
      element('a', { href: '//untrusted.example/' }),
    ].forEach((node) => {
      assert.throws(() => validateCellHTML('<p>Example</p>', [image], () => fragment(node)));
    });
  });
});
