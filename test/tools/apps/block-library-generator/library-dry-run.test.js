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
import { CARDS_SOURCE_PATHS, createCardsRequest } from '../../../../tools/apps/block-library-generator/cards-analysis.js';
import {
  getCardsLibraryPaths, buildCardsPage, mergeCardsIndex, prepareCardsLibraryDryRun,
  buildBlockStarterPage,
} from '../../../../tools/apps/block-library-generator/library-dry-run.js';

const request = () => createCardsRequest({
  environment: 'prod',
  input: {
    prompt: 'Analysis prompt.',
    sourcePage: '/index.html',
    sources: CARDS_SOURCE_PATHS.map((id) => ({ id, content: 'Source.' })),
    images: [{ src: 'https://content.da.live/msagolj/ew/.index/image.jpg', alt: '' }],
    links: [{ href: '/index', label: 'Home' }],
  },
});
const analysis = () => ({
  blockName: 'cards',
  analysisScope: {},
  optionAnalysis: { status: 'none-found', supportedOptions: [] },
  structure: {},
  contentRules: {},
  derivedBehavior: {},
  sharedBehavior: {},
  warnings: [],
  unknowns: [],
  examples: [{
    id: 'text-only',
    name: 'Text & cards',
    description: 'A <useful> example.',
    options: [],
    body: [['<p>Example</p>']],
    evidence: [CARDS_SOURCE_PATHS[0]],
    assumptions: [],
  }],
});
const config = () => ({
  library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] },
});
const index = () => ({
  ':type': 'sheet',
  ':sheetname': 'data',
  ':colWidths': [142, 652],
  custom: { retained: true },
  total: 1,
  limit: 1,
  offset: 0,
  data: [{ name: 'Columns', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/columns', tags: 'keep' }],
});
const paths = () => getCardsLibraryPaths(config(), request().target);

// Element fixtures exercise serialization/policy, not an HTML parser.
const text = (value) => ({ nodeType: 3, textContent: value });
function element(tagName, attrs = {}, childNodes = []) {
  return {
    nodeType: 1,
    tagName,
    childNodes,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    hasAttribute: (name) => Object.hasOwn(attrs, name),
    getAttribute: (name) => attrs[name] ?? null,
  };
}
function parseFixture(markup) {
  assert.ok(['<p>Example</p>', '</div><p>Example</p>'].includes(markup));
  const p = element('P', {}, [text('Example')]);
  return { childNodes: [p], children: [p], querySelectorAll: () => [p] };
}

describe('Cards library page construction', () => {
  it('uses the confirmed same-site Blocks registration rather than a guessed default', () => {
    assert.deepEqual(paths(), {
      indexPath: '/docs/library/blocks.json',
      pagePath: '/docs/library/blocks/cards.html',
      indexURL: 'https://content.da.live/msagolj/ew/docs/library/blocks.json',
      pageURL: 'https://content.da.live/msagolj/ew/docs/library/blocks/cards',
    });
  });

  it('rejects missing, ambiguous, foreign or unsafe library registrations', () => {
    [
      {}, { library: { data: [] } },
      { library: { ...config().library, total: 5, offset: 0 } },
      { library: { data: [...config().library.data, ...config().library.data] } },
      { library: { data: [{ title: 'Blocks', path: 'https://content.da.live/other/site/blocks.json' }] } },
      { library: { data: [{ title: 'Blocks', path: 'https://example.com/msagolj/ew/blocks.json' }] } },
      { library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/blocks.json?secret=x' }] } },
    ].forEach((value) => assert.throws(() => getCardsLibraryPaths(value, request().target)));
  });

  it('keeps Stage destinations on the Stage content origin', () => {
    const target = { ...request().target, environment: 'stage', adminOrigin: 'https://stage-admin.da.live' };
    const value = config();
    value.library.data[0].path = 'https://stage-content.da.live/msagolj/ew/docs/library/blocks.json';
    assert.equal(
      getCardsLibraryPaths(value, target).pageURL,
      'https://stage-content.da.live/msagolj/ew/docs/library/blocks/cards',
    );
    assert.throws(() => getCardsLibraryPaths(config(), target), /environment/);
  });

  it('generates authorable rows/cells and adjacent consumer metadata without decorating cells', () => {
    const data = analysis();
    const before = JSON.stringify(data);
    const html = buildCardsPage(request(), data, parseFixture);
    assert.ok(html.startsWith('<body>'));
    assert.match(html, /<header><\/header>/);
    assert.match(html, /<main>/);
    assert.match(html, /<h2>Text &amp; cards<\/h2>/);
    assert.doesNotMatch(html, /<h2\b[^>]*\bid=/);
    assert.match(html, /<div class="cards">/);
    assert.match(html, /<div><p>Example<\/p><\/div>/);
    assert.match(html, /class="library-metadata"/);
    assert.match(html, /A &lt;useful&gt; example\./);
    assert.match(html, /searchtags/);
    assert.doesNotMatch(html, /cards-card-body|cards-wrapper|<ul|<table/);
    assert.equal(JSON.stringify(data), before);
  });

  it('keeps the block name first and adds only validated authored options', () => {
    const data = analysis();
    data.optionAnalysis = { status: 'found', supportedOptions: ['alternate'] };
    data.examples[0].options = ['alternate'];
    assert.match(buildCardsPage(request(), data, parseFixture), /class="cards alternate"/);
  });

  it('builds one clearly unfinished block from inferred text cells, without fabricated links or a ready verdict', () => {
    const value = request();
    value.kind = 'analysis';
    value.input.blockName = 'cards';
    value.input.entryPaths = CARDS_SOURCE_PATHS.slice(0, 2);
    value.input.dependencyIssues = [];
    const data = {
      ...analysis(),
      generation: {
        status: 'blocked',
        reason: 'A real external content path is needed.',
        starter: {
          body: [['Content path <replace me>'], ['Variation & other settings']],
          evidence: [CARDS_SOURCE_PATHS[0]],
        },
      },
      examples: [],
    };
    const before = JSON.stringify(data);
    const html = buildBlockStarterPage(value, data, parseFixture);
    assert.equal((html.match(/<div class="cards">/g) || []).length, 1);
    assert.match(html, /Content path &lt;replace me&gt;/);
    assert.match(html, /Variation &amp; other settings/);
    assert.match(html, /not a working example/i);
    assert.match(html, /library-metadata/);
    assert.doesNotMatch(html, /<a\b|<img\b|<h2[^>]*\bid=/);
    assert.equal(JSON.stringify(data), before);
    [undefined, null].forEach((starter) => {
      const fallback = {
        ...data,
        generation: { status: 'blocked', reason: data.generation.reason, starter },
      };
      const unchanged = JSON.stringify(fallback);
      const page = buildBlockStarterPage(value, fallback, parseFixture);
      assert.match(page, /<div class="cards">\s*<div>\s*<div><\/div>\s*<\/div>\s*<\/div>/);
      assert.match(page, /one empty cell/);
      assert.match(page, /not a working example/);
      assert.doesNotMatch(page, /<a\b|<img\b|Content path &lt;replace me&gt;/);
      assert.equal(JSON.stringify(fallback), unchanged);
    });
  });

  it('serializes parsed nodes instead of interpolating boundary-breaking raw markup', () => {
    const data = analysis();
    data.examples[0].body = [['</div><p>Example</p>']];
    assert.equal(
      buildCardsPage(request(), data, parseFixture),
      buildCardsPage(request(), analysis(), parseFixture),
    );
  });

  it('rejects invalid recipe shapes before constructing output', () => {
    const data = analysis();
    data.examples[0].body = [['<p>Example</p>'], ['<p>Example</p>', '']];
    assert.throws(() => buildCardsPage(request(), data, parseFixture), /rectangular/);
  });
});

describe('Preserving the complete existing index', () => {
  it('adds one Cards row while preserving every prior row and extension field', () => {
    const current = index();
    current.data.push({ name: 'Header', path: '/header', extra: 'preserve infrastructure too' });
    current.total = 2;
    current.limit = 2;
    const before = JSON.stringify(current);
    const merged = mergeCardsIndex(current, paths());
    assert.equal(JSON.stringify(current), before);
    assert.deepEqual(merged.after.data.slice(0, 2), current.data);
    assert.deepEqual(merged.after[':colWidths'], [142, 652]);
    assert.deepEqual(merged.after.custom, { retained: true });
    assert.equal(merged.after[':sheetname'], 'data');
    assert.deepEqual(merged.addedRow, { name: 'Cards', path: paths().pageURL });
    assert.equal(merged.after.total, 3);
    assert.equal(merged.after.limit, 3);
    assert.equal(merged.after.offset, 0);
  });

  it('rejects existing Cards names or equivalent destination URLs without overwriting', () => {
    [
      { name: 'cArDs', path: '/somewhere-else' },
      { name: 'Alias', path: `${paths().pageURL}.html` },
      { name: 'Alias', path: `${paths().pageURL}/` },
    ].forEach((row) => {
      const current = index();
      current.data = [row];
      assert.throws(() => mergeCardsIndex(current, paths()), /already registered/i);
    });

    it('retains an exact existing row when restoring a missing page without duplicating registration', () => {
      const current = index();
      current.data.push({ name: 'Cards', path: paths().pageURL, extra: 'keep' });
      current.total = 2;
      current.limit = 2;
      const merged = mergeCardsIndex(current, paths(), { allowRegistered: true });
      assert.equal(merged.addedRow, null);
      assert.deepEqual(merged.after, current);
      current.data[1].path = 'https://content.da.live/msagolj/ew/another/cards';
      assert.throws(() => mergeCardsIndex(current, paths(), { allowRegistered: true }), /registered/);
    });
  });

  it('rejects partial, malformed and unsupported index formats instead of rebuilding them', () => {
    [
      {}, [], { ...index(), offset: 1 }, { ...index(), total: 5 },
      { ...index(), limit: 0 }, { ...index(), data: [{ name: 'Missing path' }] },
      { ':names': ['blocks'], blocks: index() },
      { ...index(), ':names': ['other'], other: index() },
    ].forEach((value) => assert.throws(() => mergeCardsIndex(value, paths())));
  });
});

describe('Read-only dry-run preparation', () => {
  function fixture() {
    const { target } = request();
    const responses = new Map([
      [`${target.adminOrigin}/config/msagolj/ew`, new Response(JSON.stringify(config()), {
        headers: { 'Content-Type': 'application/json' },
      })],
      [`${target.adminOrigin}/source/msagolj/ew${paths().indexPath}`, new Response(JSON.stringify(index()), {
        headers: { 'Content-Type': 'application/json' },
      })],
      [`${target.adminOrigin}/source/msagolj/ew${paths().pagePath}`, new Response(null, { status: 404 })],
    ]);
    const calls = [];
    return {
      responses,
      calls,
      options: {
        request: request(),
        analysis: analysis(),
        parseHTML: parseFixture,
        daFetch: async (url, options) => {
          calls.push({ url, method: options.method });
          assert.equal(options.method, 'GET', 'Dry run must never write');
          return responses.get(url);
        },
      },
    };
  }

  it('returns exact proposed page/index changes using GET only', async () => {
    const { options, calls } = fixture();
    const preview = await prepareCardsLibraryDryRun(options);
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.writesPerformed, 0);
    assert.equal(preview.configChangeRequired, false);
    assert.equal(preview.operations[0].operation, 'create');
    assert.equal(preview.operations[0].sourcePath, paths().pagePath);
    assert.equal(preview.operations[0].contentType, 'text/html');
    assert.equal(preview.operations[1].operation, 'update');
    assert.deepEqual(preview.operations[1].before, index());
    assert.equal(preview.operations[1].after.data.length, 2);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.method === 'GET'));
  });

  it('requires explicit404 for the page, not an existing page or a failed check', async () => {
    await Promise.all([200, 400, 403, 500].map(async (status) => {
      const { options, responses } = fixture();
      responses.set(
        `${options.request.target.adminOrigin}/source/msagolj/ew${paths().pagePath}`,
        new Response('', { status }),
      );
      await assert.rejects(prepareCardsLibraryDryRun(options), /exists|HTTP/);
    }));
  });

  it('does not initialize a missing index or mask malformed JSON', async () => {
    await Promise.all([
      new Response('', { status: 404 }),
      new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
      new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
    ].map(async (response) => {
      const { options, responses } = fixture();
      responses.set(`${options.request.target.adminOrigin}/source/msagolj/ew${paths().indexPath}`, response);
      await assert.rejects(prepareCardsLibraryDryRun(options), /HTTP 404|JSON|content type/);
    }));
  });

  it('does not fetch anything for invalid recipes or a cancelled operation', async () => {
    const { options, calls } = fixture();
    options.analysis.blockName = 'hero';
    await assert.rejects(prepareCardsLibraryDryRun(options), /Cards/);
    assert.equal(calls.length, 0);
    options.analysis = analysis();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(prepareCardsLibraryDryRun({ ...options, signal: controller.signal }), /abort/i);
    assert.equal(calls.length, 0);
  });
});
