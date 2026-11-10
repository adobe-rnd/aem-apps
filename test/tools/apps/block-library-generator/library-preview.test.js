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
import { getProbeTarget } from '../../../../tools/apps/block-library-generator/jobs.js';
import { getBlockLibraryPaths } from '../../../../tools/apps/block-library-generator/library-dry-run.js';
import {
  previewLibraryContent, saveLibraryPreviewReceipt, loadLibraryPreviewReceipts,
  clearLibraryPagePreviewReceipt,
} from '../../../../tools/apps/block-library-generator/library-preview.js';

const target = getProbeTarget('prod', { org: 'example-org', site: 'demo', branch: 'review' });
const paths = getBlockLibraryPaths({
  library: { data: [{ title: 'Blocks', path: 'https://content.da.live/example-org/demo/custom/library.json' }] },
}, target, 'columns');
const completion = () => ({
  kind: 'library-creation',
  target,
  blockName: 'columns',
  status: 'completed',
  page: 'verified',
  index: 'verified',
  destinations: paths,
});
const root = 'https://admin.hlx.page';

function fixture() {
  const calls = [];
  const progress = [];
  const values = new Map();
  return {
    calls,
    progress,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    async daFetch(url, options) {
      calls.push({ url, ...options });
      return Response.json({ preview: { status: 200 } });
    },
    onProgress(receipt) { progress.push(structuredClone(receipt)); },
  };
}

describe('Verified library Preview, never Publish', () => {
  it('previews the verified page before the exact custom index, and verifies both statuses', async () => {
    const data = fixture();
    const receipts = await previewLibraryContent({ ...data, completion: completion() });
    assert.deepEqual(data.calls.map(({ url, method }) => [method, url]), [
      ['POST', `${root}/preview/example-org/demo/review/custom/blocks/columns`],
      ['GET', `${root}/status/example-org/demo/review/custom/blocks/columns?editUrl=auto`],
      ['POST', `${root}/preview/example-org/demo/review/custom/library.json`],
      ['GET', `${root}/status/example-org/demo/review/custom/library.json?editUrl=auto`],
    ]);
    assert.ok(data.calls.every((call) => call.signal && call.cache === 'no-store' && call.redirect === 'error'));
    assert.ok(receipts.every((receipt) => receipt.status === 'completed'));
    assert.deepEqual(
      data.progress.slice(0, 2).map((receipt) => receipt.status),
      ['pending', 'pending'],
    );
    const previewPaths = receipts.map((receipt) => receipt.sourcePath);
    assert.deepEqual(previewPaths, [paths.pagePath, paths.indexPath]);
  });

  it('previews only the index after setup, including preserved indexes', async () => {
    const data = fixture();
    await previewLibraryContent({
      ...data,
      completion: {
        kind: 'library-setup',
        target,
        paths,
        status: 'completed',
        index: 'preserved',
        registration: 'verified',
      },
    });
    assert.equal(data.calls.length, 2);
    assert.ok(data.calls.every(({ url }) => url.includes('/custom/library.json')));
  });

  it('refreshes only the index after Delete and includes the page after Recreate', async () => {
    await Promise.all(['delete', 'recreate'].map(async (mode) => {
      const data = fixture();
      const receipts = await previewLibraryContent({
        ...data,
        completion: {
          mode,
          target,
          name: 'columns',
          pagePath: paths.pagePath,
          indexPath: paths.indexPath,
          status: 'completed',
          page: mode === 'delete' ? 'deleted' : 'verified',
          index: 'verified',
        },
      });
      assert.equal(receipts.length, mode === 'delete' ? 1 : 2);
      assert.ok(data.calls.every(({ method }) => ['GET', 'POST'].includes(method)));
      assert.ok(data.calls.every(({ url }) => !url.includes('/live/')));
    }));
  });

  it('reports a page Preview failure but still makes the index available for insertion', async () => {
    const data = fixture();
    const receipts = await previewLibraryContent({
      ...data,
      completion: completion(),
      daFetch: async (url, options) => {
        data.calls.push({ url, ...options });
        return url.endsWith('/columns')
          ? new Response(null, { status: 403 }) : Response.json({ preview: { status: 200 } });
      },
    });
    assert.equal(receipts[0].status, 'failed');
    assert.match(receipts[0].error, /403/);
    assert.equal(receipts[1].status, 'completed');
    assert.equal(data.calls.filter(({ method }) => method === 'POST').length, 2);
    assert.ok(data.calls.every(({ method }) => !['PUT', 'DELETE'].includes(method)));
  });

  it('does not equate an accepted POST or malformed status response with verified Preview', async () => {
    await Promise.all([
      Response.json({ preview: { status: 404 } }),
      Response.json({}),
      new Response('not json'),
      new Response(null, { status: 401 }),
    ].map(async (response) => {
      const data = fixture();
      const receipts = await previewLibraryContent({
        ...data,
        completion: completion(),
        daFetch: async (url, options) => (
          options.method === 'POST' ? Response.json({}) : response.clone()
        ),
      });
      assert.ok(receipts.every((receipt) => receipt.status === 'failed' && receipt.error));
    }));
  });

  it('does not report an asynchronous acceptance as completed Preview', async () => {
    const data = fixture();
    const receipts = await previewLibraryContent({
      ...data,
      completion: completion(),
      daFetch: async (url, options) => {
        data.calls.push({ url, ...options });
        return new Response(null, { status: 202 });
      },
    });
    assert.ok(receipts.every((receipt) => receipt.status === 'failed'));
    assert.ok(receipts.every((receipt) => /accepted.*not confirmed/.test(receipt.error)));
    assert.ok(data.calls.every((call) => call.method === 'POST'));
  });

  it('persists pending outcomes before requests and stops further requests on interruption', async () => {
    const data = fixture();
    const controller = new AbortController();
    const receipts = await previewLibraryContent({
      ...data,
      completion: completion(),
      signal: controller.signal,
      daFetch: async () => {
        assert.equal(data.progress.length, 2);
        controller.abort();
        throw new Error('Connection interrupted');
      },
    });
    assert.equal(receipts[0].status, 'failed');
    assert.equal(receipts[1].status, 'pending');
    assert.match(receipts[0].error, /interrupted/);
  });

  it('does not send requests if durable pending-status storage fails', async () => {
    const data = fixture();
    await assert.rejects(previewLibraryContent({
      ...data,
      completion: completion(),
      onProgress: () => { throw new Error('Storage unavailable'); },
    }), /Storage unavailable/);
    assert.equal(data.calls.length, 0);
  });

  it('rejects unverified, foreign, unsafe and unsupported outcomes before any request', async () => {
    const invalid = [
      { ...completion(), status: 'partial' },
      { ...completion(), page: 'written' },
      { ...completion(), index: 'unknown' },
      { ...completion(), kind: 'unrelated' },
      { ...completion(), target: { ...target, adminOrigin: 'https://other.example' } },
      { ...completion(), target: getProbeTarget('stage', target) },
      { ...completion(), destinations: { ...paths, indexURL: 'https://content.da.live/other/site/library.json' } },
      { ...completion(), destinations: { ...paths, pagePath: '/private/../../index.html' } },
      { ...completion(), destinations: { ...paths, indexPath: '/another.json' } },
    ];
    await Promise.all(invalid.map(async (outcome) => {
      const data = fixture();
      await assert.rejects(previewLibraryContent({ ...data, completion: outcome }));
      assert.equal(data.calls.length, 0);
    }));
  });

  it('restores scoped warnings without requests and shares only the latest index status', async () => {
    const data = fixture();
    const receipts = await previewLibraryContent({ ...data, completion: completion() });
    receipts[0].status = 'failed';
    receipts[0].error = 'Page Preview denied';
    receipts.forEach((receipt) => saveLibraryPreviewReceipt(data.storage, receipt));
    const count = data.calls.length;
    const restored = loadLibraryPreviewReceipts(data.storage, target, 'columns');
    assert.equal(restored.length, 2);
    assert.ok(restored.some((receipt) => receipt.error === 'Page Preview denied'));
    assert.equal(loadLibraryPreviewReceipts(data.storage, target, 'cards').length, 1);
    assert.equal(loadLibraryPreviewReceipts(data.storage, getProbeTarget('prod'), 'columns').length, 0);
    assert.equal(data.calls.length, count);
    assert.throws(() => saveLibraryPreviewReceipt(data.storage, {
      ...receipts[0], sourcePath: '/another-site/../index.html',
    }));
    clearLibraryPagePreviewReceipt(data.storage, target, 'columns');
    const afterDelete = loadLibraryPreviewReceipts(data.storage, target, 'columns');
    assert.equal(afterDelete.length, 1);
    assert.equal(afterDelete[0].blockName, null);
  });
});
