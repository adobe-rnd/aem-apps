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
import { CARDS_SOURCE_PATHS, createCardsRequest } from '../../../../tools/apps/block-library-generator/cards-analysis.js';
import { createAnalysisRequest } from '../../../../tools/apps/block-library-generator/block-analysis.js';
import { getProbeTarget } from '../../../../tools/apps/block-library-generator/jobs.js';
import { prepareCardsLibraryDryRun } from '../../../../tools/apps/block-library-generator/library-dry-run.js';
import {
  createCardsLibrary, checkLibraryCreation, LibraryCreationError,
  saveCreationReceipt, loadCreationReceipt,
} from '../../../../tools/apps/block-library-generator/library-creation.js';

const root = 'https://admin.da.live';
const configURL = `${root}/config/msagolj/ew`;
const pageURL = `${root}/source/msagolj/ew/docs/library/blocks/cards.html`;
const indexURL = `${root}/source/msagolj/ew/docs/library/blocks.json`;
const jsonResponse = (value, etag = '"v1"') => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json', ETag: etag },
});
const parseHTML = () => {
  const p = {
    nodeType: 1, tagName: 'P', attributes: [], childNodes: [{ nodeType: 3, textContent: 'Example' }],
  };
  return { children: [p], childNodes: [p], querySelectorAll: () => [p] };
};

async function fixture({ starter = false } = {}) {
  const request = (starter ? createAnalysisRequest : createCardsRequest)({
    environment: 'prod',
    input: {
      ...(starter ? { blockName: 'cards', entryPaths: CARDS_SOURCE_PATHS.slice(0, 2) } : {}),
      prompt: 'Saved prompt.',
      sourcePage: '/index.html',
      sources: CARDS_SOURCE_PATHS.map((id) => ({ id, content: 'Source.' })),
      images: [{ src: 'https://content.da.live/msagolj/ew/.index/image.jpg', alt: '' }],
      links: [{ href: '/index', label: 'Home' }],
    },
  });
  const analysis = {
    blockName: 'cards',
    analysisScope: {},
    structure: {},
    contentRules: {},
    derivedBehavior: {},
    sharedBehavior: {},
    warnings: [],
    unknowns: [],
    optionAnalysis: { status: 'none-found', supportedOptions: [] },
    examples: [{
      id: 'text',
      name: 'Text',
      description: 'Example.',
      options: [],
      body: [['<p>Example</p>']],
      evidence: [CARDS_SOURCE_PATHS[0]],
      assumptions: [],
    }],
  };
  if (starter) {
    analysis.generation = {
      status: 'blocked',
      reason: 'Provide real content-fragment data.',
      starter: {
        body: [['Content Fragment path - enter a real value'], ['Variation (optional)']],
        evidence: [CARDS_SOURCE_PATHS[0]],
      },
    };
    analysis.examples = [];
  }
  const config = {
    library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] },
  };
  const index = {
    ':type': 'sheet',
    ':colWidths': [142, 652],
    total: 1,
    limit: 1,
    offset: 0,
    data: [{ name: 'Columns', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/columns' }],
  };
  const state = {
    page: null, index, config, indexETag: 'W/"v1"', calls: [], progress: [],
  };
  const daFetch = async (url, options) => {
    state.calls.push({ url, ...options });
    if (options.method === 'GET') {
      if (url === configURL) return jsonResponse(state.config);
      if (url === indexURL) return jsonResponse(state.index, state.indexETag);
      assert.equal(url, pageURL);
      return state.page === null ? new Response(null, { status: 404 })
        : new Response(state.page, { headers: { 'Content-Type': 'text/html' } });
    }
    assert.equal(options.method, 'PUT');
    const content = await options.body.get('data').text();
    if (url === pageURL) {
      assert.equal(options.headers['If-None-Match'], '*');
      if (state.page !== null) return new Response(null, { status: 412 });
      state.page = content;
    } else {
      assert.equal(url, indexURL);
      assert.equal(options.headers['If-Match'], state.indexETag.replace(/^W\//, ''));
      state.index = JSON.parse(content);
      state.indexETag = '"v2"';
    }
    return new Response(null, { status: 201 });
  };
  const proposal = await prepareCardsLibraryDryRun({
    daFetch, request, analysis, parseHTML, starter,
  });
  state.calls = [];
  return {
    state,
    options: {
      request,
      starter,
      analysis,
      proposal,
      parseHTML,
      daFetch,
      onProgress: (value) => state.progress.push(value),
    },
  };
}

describe('Conditional library creation', () => {
  it('creates a clearly unfinished inferred starter with normal conditions and immutable blocked analysis', async () => {
    const { state, options } = await fixture({ starter: true });
    const before = JSON.stringify(options.analysis);
    const result = await createCardsLibrary(options);
    assert.equal(result.starter, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.page, 'verified');
    assert.equal(result.index, 'verified');
    assert.equal(JSON.stringify(options.analysis), before);
    assert.match(state.page, /Content Fragment path/);
    assert.match(state.page, /not a working example/);
    assert.doesNotMatch(state.page, /<a\b|<img\b/);
    assert.equal((state.page.match(/class="cards"/g) || []).length, 1);
    assert.deepEqual(state.calls.filter((call) => call.method === 'PUT').map((call) => call.url), [
      pageURL, indexURL,
    ]);
    assert.ok(state.index.data.some((row) => row.name === 'Cards'));
    assert.equal(state.index.data[0].name, 'Columns');
  });

  it('will not overwrite a page or accept a stale starter draft and cannot bypass the blocked example gate', async () => {
    await Promise.all(['existing', 'changed', 'not-starter'].map(async (scenario) => {
      const { state, options } = await fixture({ starter: true });
      if (scenario === 'existing') state.page = '<body>Author content</body>';
      if (scenario === 'changed') options.analysis.generation.starter.body[0][0] = 'Changed input';
      if (scenario === 'not-starter') options.starter = false;
      await assert.rejects(createCardsLibrary(options));
      assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0);
    }));
  });

  it('creates only the approved page and index, verifies readback and preserves Columns', async () => {
    const { state, options } = await fixture();
    const result = await createCardsLibrary(options);
    assert.equal(result.status, 'completed');
    assert.equal(result.page, 'verified');
    assert.equal(result.index, 'verified');
    assert.equal(state.index.data[0].name, 'Columns');
    assert.deepEqual(state.index[':colWidths'], [142, 652]);
    assert.deepEqual(
      state.calls.filter((call) => call.method === 'PUT').map((call) => call.url),
      [pageURL, indexURL],
    );
    assert.ok(state.progress.some((value) => value.page === 'attempted' && value.index === 'not-attempted'));
    assert.ok(state.progress.some((value) => value.page === 'verified' && value.index === 'attempted'));
    assert.ok(state.calls.filter((call) => call.method === 'GET')
      .every((call) => call.cache === 'no-store'));
  });

  it('refuses stale page content, stale index data or changed registration before any PUT', async () => {
    await Promise.all(['page', 'index', 'registration'].map(async (change) => {
      const { state, options } = await fixture();
      if (change === 'page') state.page = '<body>Existing</body>';
      if (change === 'index') state.index.custom = 'concurrent edit';
      if (change === 'registration') state.config.library.data[0].path = 'https://content.da.live/msagolj/ew/other/blocks.json';
      await assert.rejects(createCardsLibrary(options));
      assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0);
    }));
  });

  it('requires an ETag before creating the page; never downgrades the conditional index write', async () => {
    const { state, options } = await fixture();
    state.indexETag = '';
    await assert.rejects(createCardsLibrary(options), /ETag/i);
    assert.equal(state.page, null);
    assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0);
  });

  it('stops on a page create race and never touches the index', async () => {
    const { state, options } = await fixture();
    const original = options.daFetch;
    options.daFetch = (url, init) => {
      if (url === pageURL && init.method === 'PUT') state.page = '<body>Concurrent writer</body>';
      return original(url, init);
    };
    await assert.rejects(createCardsLibrary(options), /412/);
    assert.equal(state.index.data.length, 1);
    assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 1);
  });

  it('reports a verified orphan page if the index changes after page creation', async () => {
    const { state, options } = await fixture();
    const original = options.daFetch;
    options.daFetch = async (url, init) => {
      const response = await original(url, init);
      if (url === pageURL && init.method === 'PUT') {
        state.index.other = 'concurrent change';
        state.indexETag = '"other"';
      }
      return response;
    };
    await assert.rejects(createCardsLibrary(options), (error) => {
      assert.ok(error instanceof LibraryCreationError);
      assert.equal(error.outcome.status, 'partial');
      assert.equal(error.outcome.page, 'verified');
      assert.equal(error.outcome.index, 'not-attempted');
      return true;
    });
    assert.equal(state.index.data.length, 1);
    assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 1);
  });

  it('reports index412 as partial and never retries, deletes or rolls back the page', async () => {
    const { state, options } = await fixture();
    const original = options.daFetch;
    options.daFetch = (url, init) => (url === indexURL && init.method === 'PUT'
      ? new Response(null, { status: 412 }) : original(url, init));
    await assert.rejects(createCardsLibrary(options), (error) => {
      assert.equal(error.outcome.status, 'partial');
      assert.equal(error.outcome.page, 'verified');
      assert.equal(error.outcome.index, 'attempted');
      return true;
    });
    assert.ok(state.page);
    assert.equal(state.index.data.length, 1);
  });

  it('does not register an unverified page or call a mismatched index readback success', async () => {
    await Promise.all(['page', 'index'].map(async (step) => {
      const { state, options } = await fixture();
      const original = options.daFetch;
      options.daFetch = async (url, init) => {
        const response = await original(url, init);
        if (init.method === 'PUT' && url === (step === 'page' ? pageURL : indexURL)) {
          if (step === 'page') state.page = '<body>Different content</body>';
          else state.index.custom = 'Unexpected change';
        }
        return response;
      };
      await assert.rejects(createCardsLibrary(options), /readback|match/i);
      if (step === 'page') assert.equal(state.index.data.length, 1);
    }));
  });

  it('retains an uncertain outcome when cancellation occurs during a write', async () => {
    const { state, options } = await fixture();
    const controller = new AbortController();
    const original = options.daFetch;
    options.daFetch = async (url, init) => {
      const response = await original(url, init);
      if (url === pageURL && init.method === 'PUT') controller.abort();
      return response;
    };
    await assert.rejects(createCardsLibrary({ ...options, signal: controller.signal }), (error) => {
      assert.equal(error.outcome.status, 'partial');
      assert.equal(error.outcome.index, 'not-attempted');
      return true;
    });
    assert.ok(state.page);
    assert.equal(state.index.data.length, 1);
  });

  it('persists an isolated receipt and checks it using GET only without retrying writes', async () => {
    const { state, options } = await fixture();
    const outcome = await createCardsLibrary(options);
    const data = new Map();
    const storage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    };
    saveCreationReceipt(storage, outcome);
    assert.equal(loadCreationReceipt(storage, 'stage'), null);
    const receipt = loadCreationReceipt(storage, 'prod');
    const before = state.calls.length;
    const checked = await checkLibraryCreation({ daFetch: options.daFetch, receipt });
    assert.equal(checked.status, 'completed');
    assert.ok(state.calls.slice(before).every((call) => call.method === 'GET'));
  });

  it('reports changed content during read-only recovery and never repairs automatically', async () => {
    const { state, options } = await fixture();
    const receipt = await createCardsLibrary(options);
    state.page = '<body>Changed later</body>';
    const before = state.calls.length;
    await assert.rejects(checkLibraryCreation({ daFetch: options.daFetch, receipt }), /match/i);
    assert.ok(state.calls.slice(before).every((call) => call.method === 'GET'));
    assert.equal(state.page, '<body>Changed later</body>');
  });

  it('does not write if storing the pre-write receipt fails', async () => {
    const { state, options } = await fixture();
    options.onProgress = () => { throw new Error('Storage blocked'); };
    await assert.rejects(createCardsLibrary(options), /Storage blocked/);
    assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 0);
  });

  it('restores an absent page with an existing exact index row without duplicating or writing the index', async () => {
    const { state, options } = await fixture();
    state.index.data.push({ name: 'Cards', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/cards', extra: 'keep' });
    state.index.total = 2;
    state.index.limit = 2;
    const before = JSON.stringify(state.index);
    options.allowRegistered = true;
    options.proposal = await prepareCardsLibraryDryRun({ ...options, allowRegistered: true });
    state.calls = [];
    const result = await createCardsLibrary(options);
    assert.equal(result.status, 'completed');
    assert.equal(JSON.stringify(state.index), before);
    assert.deepEqual(state.calls.filter((call) => call.method === 'PUT').map((call) => call.url), [pageURL]);
  });

  it('creates Columns and Hero across sites with block/branch-isolated receipt recovery', async () => {
    const stored = new Map();
    const storage = {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    };
    const another = getProbeTarget('prod', { org: 'example-org', site: 'demo', branch: 'release' });
    await Promise.all([
      { name: 'columns', target: getProbeTarget('prod') },
      { name: 'hero', target: getProbeTarget('prod') },
      { name: 'hero', target: another },
    ].map(async ({ name, target }) => {
      const old = await fixture();
      const input = {
        ...old.options.request.input,
        blockName: name,
        images: [],
        entryPaths: [`/blocks/${name}/${name}.css`],
        sources: [`/blocks/${name}/${name}.css`, '/styles/styles.css', '/styles/lazy-styles.css']
          .map((id) => ({ id, content: '' })),
      };
      const request = createAnalysisRequest({ target, input });
      const analysis = {
        ...old.options.analysis,
        blockName: name,
        generation: { status: 'ready', reason: '' },
        examples: [{ ...old.options.analysis.examples[0], evidence: [input.entryPaths[0]] }],
      };
      const state = {
        page: null,
        index: { ...old.state.index, data: [{ name: 'Keep', path: '/kept-page' }] },
        indexETag: '"v1"',
        writes: [],
      };
      const siteRoot = `${target.org}/${target.site}`;
      const ownURL = `${root}/source/${siteRoot}/docs/library/blocks/${name}.html`;
      const ownIndexURL = `${root}/source/${siteRoot}/docs/library/blocks.json`;
      const ownConfigURL = `${root}/config/${siteRoot}`;
      const ownConfig = {
        library: { data: [{ title: 'Blocks', path: `https://content.da.live/${siteRoot}/docs/library/blocks.json` }] },
      };
      const daFetch = async (url, options) => {
        if (options.method === 'GET') {
          if (url === ownConfigURL) return jsonResponse(ownConfig);
          if (url === ownIndexURL) return jsonResponse(state.index, state.indexETag);
          assert.equal(url, ownURL);
          return state.page === null ? new Response(null, { status: 404 })
            : new Response(state.page, { headers: { 'Content-Type': 'text/html' } });
        }
        assert.equal(options.method, 'PUT');
        state.writes.push(url);
        const body = await options.body.get('data').text();
        if (url === ownURL) {
          assert.equal(options.headers['If-None-Match'], '*');
          state.page = body;
        } else {
          assert.equal(url, ownIndexURL);
          assert.equal(options.headers['If-Match'], '"v1"');
          state.index = JSON.parse(body);
          state.indexETag = '"v2"';
        }
        return new Response(null, { status: 201 });
      };
      const proposal = await prepareCardsLibraryDryRun({
        daFetch, request, analysis, parseHTML,
      });
      const result = await createCardsLibrary({
        daFetch,
        request,
        analysis,
        proposal,
        parseHTML,
        onProgress: (receipt) => saveCreationReceipt(storage, receipt),
      });
      assert.equal(result.status, 'completed');
      assert.equal(result.blockName, name);
      assert.ok(state.page.includes(`class="${name}"`));
      assert.equal(state.index.data[0].name, 'Keep');
      assert.equal(state.index.data.at(-1).path, `https://content.da.live/${siteRoot}/docs/library/blocks/${name}`);
      const receipt = loadCreationReceipt(storage, target, name);
      assert.equal(receipt.blockName, name);
      assert.equal((await checkLibraryCreation({ daFetch, receipt })).status, 'completed');
      assert.ok(state.writes.every((url) => url === ownURL || url === ownIndexURL));
    }));
    assert.equal(loadCreationReceipt(storage, 'prod', 'cards'), null);
    assert.equal(loadCreationReceipt(storage, 'prod', 'hero').blockName, 'hero');
    assert.equal(loadCreationReceipt(storage, 'prod', 'columns').blockName, 'columns');
    assert.equal(loadCreationReceipt(storage, another, 'hero').target.branch, 'release');
    assert.notEqual(
      loadCreationReceipt(storage, another, 'hero').jobId,
      loadCreationReceipt(storage, 'prod', 'hero').jobId,
    );
  });
});
