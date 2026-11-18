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
import { DOMParser } from 'linkedom';
import createMerger, { buildPageHtml } from '../../../../tools/plugins/proposals/merge.js';

const parse = (text) => new DOMParser().parseFromString(text, 'text/html');
const page = (...blocks) => buildPageHtml(blocks.map((block) => `<div><p>${block}</p></div>`).join(''));
const withMeta = (html, rows) => html.replace('<footer>', `<div class="da-metadata">${rows}</div><footer>`);

function setup({
  draft = page('A', 'B2'), current = page('A', 'B'), base = page('A', 'B'), skipped = 0,
  etag = '"e1"', failVersion = false,
} = {}) {
  const calls = { diff: null, writes: [], versions: [] };
  const files = new Map([['/draft.html', draft], ['/t.html', current]]);
  const store = {
    readSource: async (path) => (files.has(path) ? { html: files.get(path), etag } : null),
    readVersion: async () => base,
    writeSource: async (path, body, options) => { calls.writes.push({ path, body, options }); },
    createVersion: async (path, label) => {
      if (failVersion) throw new Error('boom');
      calls.versions.push({ path, label });
    },
  };
  const text = (doc) => [...doc.querySelectorAll('main p')].map((el) => el.textContent);
  const engine = {
    LOC_MARKERS: 'da-diff-deleted, [da-diff-added]',
    removeLocTags: () => {},
    getBlockHashes: async ({ doc }) => text(doc),
    smartMerge: async ({ source }) => ({
      html: `<div>${text(source).map((t) => `<p>${t}</p>`).join('')}</div>`, skipped,
    }),
    regionalDiff: async (upstream, local) => {
      calls.diff = { upstream: text(upstream), local: text(local) };
      const el = parse('<main><p da-diff-added="">x</p><da-diff-deleted>y</da-diff-deleted></main>').querySelector('main');
      return el;
    },
  };
  return {
    merger: createMerger({
      engine, parse, store, site: 's',
    }),
    calls,
  };
}

const entry = { draftPath: '/draft.html', target: '/t.html', baseVersionId: 'v1' };

describe('check', () => {
  it('reports skipped blocks', async () => {
    const { merger } = setup({ skipped: 2 });
    assert.deepEqual(await merger.check(entry), { skipped: 2, unchanged: false });
  });

  it('reports an unchanged proposal when the draft equals the base', async () => {
    const { merger } = setup({ draft: page('A', 'B') });
    assert.deepEqual(await merger.check(entry), { skipped: 0, unchanged: true });
  });

  it('needs a base version', async () => {
    const { merger } = setup();
    await assert.rejects(merger.check({ ...entry, baseVersionId: null }), /no base version/);
  });

  it('refuses a target with unresolved markers', async () => {
    const { merger } = setup({
      current: buildPageHtml('<div><p da-diff-added="">A</p></div>'),
    });
    await assert.rejects(merger.check(entry), /unresolved change markers/);
  });

  it('refuses content that is not a sectioned page', async () => {
    const { merger } = setup({ draft: '<body><main>loose text</main></body>' });
    await assert.rejects(merger.check(entry), /not a page that can be merged/);
  });

  it('reports a missing draft', async () => {
    const { merger } = setup();
    await assert.rejects(merger.check({ ...entry, draftPath: '/gone.html' }), /The draft \/gone.html was not found/);
  });
});

describe('preview', () => {
  it('compares the merge result as upstream with the current page as local', async () => {
    const { merger, calls } = setup();
    const result = await merger.preview(entry);
    assert.deepEqual(calls.diff, { upstream: ['A', 'B2'], local: ['A', 'B'] });
    assert.equal(result.differences, 2);
    assert.match(result.html, /da-diff-added/);
    assert.deepEqual(calls.writes, []);
  });

  it('keeps the target metadata', async () => {
    const { merger } = setup({
      current: withMeta(page('A', 'B'), '<div><div>template</div><div>news</div></div>'),
    });
    const result = await merger.preview(entry);
    assert.match(result.html, /<div>template<\/div><div>news<\/div>/);
  });

  it('has nothing to show for an unchanged proposal', async () => {
    const { merger } = setup({ draft: page('A', 'B') });
    assert.deepEqual(await merger.preview(entry), { unchanged: true, skipped: 0, differences: 0 });
  });
});

describe('merge', () => {
  it('writes the merged page with If-Match, then saves a labelled version', async () => {
    const { merger, calls } = setup({ skipped: 1 });
    const result = await merger.merge(entry);
    assert.equal(calls.writes.length, 1);
    assert.equal(calls.writes[0].path, '/t.html');
    assert.deepEqual(calls.writes[0].options, { ifMatch: '"e1"' });
    assert.match(calls.writes[0].body, /<p>B2<\/p>/);
    assert.deepEqual(calls.versions, [{ path: '/t.html', label: 'Merged from /draft.html' }]);
    assert.deepEqual(result, {
      written: true, unchanged: false, skipped: 1, label: 'Merged from /draft.html',
    });
  });

  it('keeps the target metadata in the written page', async () => {
    const { merger, calls } = setup({
      current: withMeta(page('A', 'B'), '<div><div>template</div><div>news</div></div>'),
    });
    await merger.merge(entry);
    assert.match(calls.writes[0].body, /<div>template<\/div><div>news<\/div>/);
  });

  it('writes nothing when the proposal adds nothing', async () => {
    const { merger, calls } = setup({ draft: page('A', 'B') });
    assert.deepEqual(await merger.merge(entry), { written: false, unchanged: true, skipped: 0 });
    assert.deepEqual(calls.writes, []);
  });

  it('says so when the version could not be saved', async () => {
    const { merger } = setup({ failVersion: true });
    await assert.rejects(merger.merge(entry), /was merged, but its version could not be saved: boom/);
  });
});
