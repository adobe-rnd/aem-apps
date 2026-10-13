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
import {
  listFolder, readSource, writeSource, snapshotSource, deleteSource,
} from '../../../../tools/apps/content-backflow/api.js';

const loc = { org: 'org', site: 'site' };

/** A daFetch fake answering calls in order with `{ status, body, token, retryAfter }`. */
function fakeFetch(responses) {
  const calls = [];
  const daFetch = async (url, options = {}) => {
    calls.push({ url, options, at: Date.now() });
    const {
      status = 200, body, token, retryAfter,
    } = responses.shift() || {};
    const headers = { 'da-continuation-token': token, 'retry-after': retryAfter };
    return {
      status,
      ok: status < 300,
      json: async () => body,
      blob: async () => new Blob([body ?? '']),
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    };
  };
  return { calls, daFetch };
}

describe('listFolder', () => {
  it('merges pages and normalizes items to site-relative paths', async () => {
    const { calls, daFetch } = fakeFetch([
      { body: [{ path: '/org/site/blog/a', name: 'a' }], token: 't1' },
      {
        body: [{
          path: '/org/site/blog/b.html', name: 'b', ext: 'html', lastModified: 5,
        }],
      },
    ]);
    const items = await listFolder({ ...loc, path: '/blog/' }, daFetch);
    assert.deepEqual(items, [
      {
        path: '/blog/a', name: 'a', ext: '', isFolder: true, lastModified: null,
      },
      {
        path: '/blog/b.html', name: 'b.html', ext: 'html', isFolder: false, lastModified: 5,
      },
    ]);
    assert.equal(calls[0].url, 'https://admin.da.live/list/org/site/blog');
    assert.equal(calls[0].options.headers['da-continuation-token'], undefined);
    assert.equal(calls[1].options.headers['da-continuation-token'], 't1');
  });

  it('lists the root, reads a missing folder as empty, throws on other errors', async () => {
    const root = fakeFetch([{ body: [] }]);
    await listFolder(loc, root.daFetch);
    assert.equal(root.calls[0].url, 'https://admin.da.live/list/org/site/');
    assert.deepEqual(await listFolder({ ...loc, path: '/x' }, fakeFetch([{ status: 404 }]).daFetch), []);
    await assert.rejects(listFolder(loc, fakeFetch([{ status: 500 }]).daFetch), /list failed: 500/);
  });
});

describe('source operations', () => {
  const file = { ...loc, path: '/blog/a.html' };

  it('reads, writes as form data, snapshots with a label and deletes', async () => {
    const { calls, daFetch } = fakeFetch([{ body: 'hi' }, {}, {}, {}]);
    assert.equal(await (await readSource(file, daFetch)).text(), 'hi');
    await writeSource(file, new Blob(['x'], { type: 'text/html' }), daFetch);
    await snapshotSource(file, 'Label', daFetch);
    await deleteSource(file, daFetch);
    assert.deepEqual(calls.map(({ url, options }) => [options.method || 'GET', url]), [
      ['GET', 'https://admin.da.live/source/org/site/blog/a.html'],
      ['PUT', 'https://admin.da.live/source/org/site/blog/a.html'],
      ['POST', 'https://admin.da.live/versionsource/org/site/blog/a.html'],
      ['DELETE', 'https://admin.da.live/source/org/site/blog/a.html'],
    ]);
    assert.ok(calls[1].options.body.get('data') instanceof Blob);
    assert.deepEqual(JSON.parse(calls[2].options.body), { label: 'Label' });
  });

  it('throws when DA refuses', async () => {
    await assert.rejects(snapshotSource(file, 'L', fakeFetch([{ status: 422 }]).daFetch), /version failed: 422/);
    await assert.rejects(writeSource(file, new Blob([]), fakeFetch([{ status: 403 }]).daFetch), /write failed: 403/);
  });
});

describe('retries', () => {
  const file = { ...loc, path: '/blog/a.html' };

  it('retries a 429 once after Retry-After, then succeeds', async () => {
    const { calls, daFetch } = fakeFetch([{ status: 429, retryAfter: '0' }, {}]);
    await writeSource(file, new Blob(['x']), daFetch);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(({ options }) => options.method === 'PUT'));
  });

  it('retries list pages too', async () => {
    const { calls, daFetch } = fakeFetch([
      { status: 429, retryAfter: '0' }, { body: [{ path: '/org/site/a.html', name: 'a', ext: 'html' }] },
    ]);
    assert.equal((await listFolder(loc, daFetch)).length, 1);
    assert.equal(calls.length, 2);
  });

  it('never retries more than once', async () => {
    const throttled = { status: 429, retryAfter: '0' };
    const { calls, daFetch } = fakeFetch([throttled, throttled, {}]);
    await assert.rejects(deleteSource(file, daFetch), /delete failed: 429/);
    assert.equal(calls.length, 2);
  });

  it('does not retry other errors, including 503', async () => {
    const { calls, daFetch } = fakeFetch([{ status: 503 }, {}]);
    await assert.rejects(readSource(file, daFetch), /read failed: 503/);
    assert.equal(calls.length, 1);
  });

  it('a 429 pauses every request until Retry-After', async () => {
    const { calls, daFetch } = fakeFetch([{ status: 429, retryAfter: '0.1' }, {}, {}]);
    const throttled = writeSource(file, new Blob(['x']), daFetch);
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    await deleteSource(file, daFetch);
    await throttled;
    const [first, ...later] = calls;
    assert.equal(later.length, 2);
    later.forEach(({ at }) => assert.ok(at - first.at >= 90, `${at - first.at}ms`));
  });
});
