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
import { getProbeTarget } from '../../../../tools/apps/block-library-generator/jobs.js';
import {
  prepareLibraryAction, deleteLibraryPage, replaceLibraryPage,
} from '../../../../tools/apps/block-library-generator/library-lifecycle.js';

const target = getProbeTarget('prod');
const pageURL = `${target.adminOrigin}/source/msagolj/ew/docs/library/blocks/cards.html`;
const indexURL = `${target.adminOrigin}/source/msagolj/ew/docs/library/blocks.json`;
async function fixture({ registered = true } = {}) {
  const state = {
    page: '<body>Author edits</body>',
    pageETag: 'W/"page1"',
    indexETag: '"index1"',
    index: {
      ':type': 'sheet',
      total: registered ? 2 : 1,
      limit: registered ? 2 : 1,
      offset: 0,
      ':colWidths': [100, 300],
      custom: 'preserve',
      data: [
        { name: 'Columns', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/columns' },
        ...(registered ? [{ name: 'Cards', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/cards' }] : []),
      ],
    },
    calls: [],
    receipts: [],
  };
  const config = { library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] } };
  const daFetch = async (url, options) => {
    state.calls.push({ url, method: options.method, headers: options.headers });
    if (options.method === 'GET') {
      if (url.includes('/config/')) return Response.json(config);
      if (url === indexURL) {
        return Response.json(state.index, { headers: { ETag: state.indexETag } });
      }
      assert.equal(url, pageURL);
      return state.page === null ? new Response(null, { status: 404 })
        : new Response(state.page, {
          headers: { ETag: state.pageETag, 'Content-Type': 'text/html' },
        });
    }
    if (options.method === 'DELETE') {
      assert.equal(url, pageURL);
      state.page = null;
      return new Response(null, { status: 204 });
    }
    assert.equal(options.method, 'PUT');
    const text = await options.body.get('data').text();
    if (url === pageURL) {
      assert.equal(options.headers['If-Match'], state.pageETag ? '"page1"' : undefined);
      state.page = text;
      state.pageETag = '"page2"';
    } else {
      assert.equal(url, indexURL);
      assert.equal(options.headers['If-Match'], '"index1"');
      state.index = JSON.parse(text);
      state.indexETag = '"index2"';
    }
    return new Response(null, { status: 200 });
  };
  const snapshot = await prepareLibraryAction({
    daFetch, target, name: 'cards', pagePath: '/docs/library/blocks/cards.html',
  });
  state.calls = [];
  return {
    state, daFetch, config, snapshot, onProgress: (receipt) => state.receipts.push(receipt),
  };
}

describe('One-shot page lifecycle', () => {
  it('deletes exactly the page and removes only its index row, preserving metadata', async () => {
    const f = await fixture();
    const result = await deleteLibraryPage(f);
    assert.equal(result.status, 'completed');
    assert.equal(f.state.page, null);
    assert.equal(f.state.index.data.length, 1);
    assert.equal(f.state.index.data[0].name, 'Columns');
    assert.equal(f.state.index.custom, 'preserve');
    assert.deepEqual(f.state.index[':colWidths'], [100, 300]);
    assert.equal(f.state.index.total, 1);
    assert.equal(f.state.calls.filter((call) => call.method === 'DELETE').length, 1);
  });

  it('refuses a changed page, index or registration before deletion or replacement', async () => {
    await Promise.all(['page', 'index', 'registration'].map(async (change) => {
      const f = await fixture();
      if (change === 'page') f.state.page = '<body>New author edits</body>';
      if (change === 'index') f.state.index.custom = 'Other edit';
      if (change === 'registration') f.config.library.data[0].path = 'https://content.da.live/msagolj/ew/other.json';
      await assert.rejects(deleteLibraryPage(f), /changed|match|registration/i);
      assert.ok(f.state.calls.every((call) => call.method === 'GET'));
    }));
  });

  it('keeps the old page until replacement is explicitly executed, then uses If-Match', async () => {
    const f = await fixture();
    assert.equal(f.state.page, '<body>Author edits</body>');
    const oldIndex = JSON.stringify(f.state.index);
    const result = await replaceLibraryPage({ ...f, html: '<body>Fresh generation</body>' });
    assert.equal(result.status, 'completed');
    assert.equal(f.state.page, '<body>Fresh generation</body>');
    assert.equal(JSON.stringify(f.state.index), oldIndex);
    assert.equal(f.state.calls.filter((call) => call.method === 'PUT').length, 1);
    assert.ok(f.state.calls.every((call) => call.method !== 'DELETE'));
  });

  it('registers a recreated orphan page while preserving every existing row', async () => {
    const f = await fixture({ registered: false });
    await replaceLibraryPage({ ...f, html: '<body>New</body>' });
    assert.deepEqual(f.state.index.data.map((row) => row.name), ['Columns', 'Cards']);
    assert.equal(f.state.index.custom, 'preserve');
  });

  it('reports partial deletion if the index changes after deleting, without rollback', async () => {
    const f = await fixture();
    const original = f.daFetch;
    f.daFetch = async (url, options) => {
      const response = await original(url, options);
      if (options.method === 'DELETE') f.state.index.custom = 'Concurrent change';
      return response;
    };
    await assert.rejects(deleteLibraryPage(f), (error) => {
      assert.equal(error.outcome.status, 'partial');
      assert.equal(error.outcome.page, 'deleted');
      assert.equal(error.outcome.index, 'not-attempted');
      return true;
    });
    assert.equal(f.state.page, null);
    assert.equal(f.state.index.data.length, 2);
  });

  it('does not accept a success-shaped DELETE response unless the page reads back404', async () => {
    const f = await fixture();
    const original = f.daFetch;
    f.daFetch = (url, options) => (options.method === 'DELETE'
      ? new Response(null, { status: 204 }) : original(url, options));
    await assert.rejects(deleteLibraryPage(f), /still exists|deletion/i);
    assert.equal(f.state.index.data.length, 2);
    assert.equal(f.state.calls.filter((call) => call.method === 'PUT').length, 0);
  });

  it('does not retry replacement412 or overwrite a mismatched readback', async () => {
    const f = await fixture();
    const original = f.daFetch;
    f.daFetch = (url, options) => (options.method === 'PUT'
      ? new Response(null, { status: 412 }) : original(url, options));
    await assert.rejects(replaceLibraryPage({ ...f, html: '<body>New</body>' }), /412/);
    assert.equal(f.state.page, '<body>Author edits</body>');
  });

  it('requires receipts and current ETags before mutating and rejects unsafe destinations', async () => {
    const f = await fixture();
    await assert.rejects(deleteLibraryPage({ ...f, onProgress: null }), /receipt/i);
    await assert.rejects(prepareLibraryAction({
      ...f, target, name: 'cards', pagePath: '/blocks/cards/cards.js',
    }), /page|destination/i);
    f.state.indexETag = '';
    await assert.rejects(deleteLibraryPage(f), /ETag/i);
    assert.ok(f.state.calls.every((call) => call.method === 'GET'));
  });

  it('supports the explicitly approved hash-check mode when HTML has no ETag', async () => {
    const f = await fixture();
    f.state.pageETag = '';
    f.snapshot = await prepareLibraryAction({
      ...f, target, name: 'cards', pagePath: '/docs/library/blocks/cards.html',
    });
    assert.equal(f.snapshot.pageETag, null);
    await assert.rejects(replaceLibraryPage({ ...f, html: '<body>New</body>' }), /explicit/);
    assert.ok(f.state.calls.every((call) => call.method === 'GET'));
    const result = await replaceLibraryPage({
      ...f, html: '<body>New</body>', allowNonAtomicReplace: true,
    });
    assert.equal(result.status, 'completed');
    assert.equal(f.state.page, '<body>New</body>');
    const race = await fixture();
    race.state.pageETag = '';
    race.snapshot = await prepareLibraryAction({
      ...race, target, name: 'cards', pagePath: '/docs/library/blocks/cards.html',
    });
    race.state.page = '<body>Concurrent author edit</body>';
    await assert.rejects(replaceLibraryPage({
      ...race, html: '<body>New</body>', allowNonAtomicReplace: true,
    }), /changed/);
    assert.equal(race.state.page, '<body>Concurrent author edit</body>');
  });

  it('preserves the page if pre-write receipt storage fails', async () => {
    const f = await fixture();
    await assert.rejects(deleteLibraryPage({
      ...f, onProgress: () => { throw new Error('Storage blocked'); },
    }), /Storage blocked/);
    assert.equal(f.state.page, '<body>Author edits</body>');
    assert.ok(f.state.calls.every((call) => call.method === 'GET'));
  });

  it('stops on DELETE403 and does not remove the index row', async () => {
    const f = await fixture();
    const original = f.daFetch;
    f.daFetch = (url, options) => (options.method === 'DELETE'
      ? new Response(null, { status: 403 }) : original(url, options));
    await assert.rejects(deleteLibraryPage(f), /403/);
    assert.equal(f.state.page, '<body>Author edits</body>');
    assert.equal(f.state.index.data.length, 2);
    assert.ok(f.state.calls.every((call) => call.method === 'GET'));
  });

  it('reports partial outcome on conditional index412 after a verified deletion', async () => {
    const f = await fixture();
    const original = f.daFetch;
    f.daFetch = (url, options) => (options.method === 'PUT'
      ? new Response(null, { status: 412 }) : original(url, options));
    await assert.rejects(deleteLibraryPage(f), (error) => {
      assert.equal(error.outcome.page, 'deleted');
      assert.equal(error.outcome.index, 'attempted');
      assert.match(error.message, /412/);
      return true;
    });
    assert.equal(f.state.index.data.length, 2);
  });

  it('rejects mismatched replacement readback and cancelled operations without hidden retries', async () => {
    const f = await fixture();
    const original = f.daFetch;
    f.daFetch = async (url, options) => {
      const response = await original(url, options);
      if (options.method === 'PUT') f.state.page = '<body>Other bytes</body>';
      return response;
    };
    await assert.rejects(replaceLibraryPage({ ...f, html: '<body>New</body>' }), /readback/);
    assert.equal(f.state.calls.filter((call) => call.method === 'PUT').length, 1);
    const cancelled = await fixture();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(deleteLibraryPage({ ...cancelled, signal: controller.signal }), /abort/i);
    assert.equal(cancelled.state.calls.length, 0);
  });
});
