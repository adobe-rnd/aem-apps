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
import {
  after, beforeEach, describe, it,
} from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFromSource, mergeFromSource, setMergeCopy, setEditUrlOrigin,
} from '../../../../../tools/apps/msm/core/operations.js';
import { setDaFetch, daFetch, DA_ORIGIN } from '../../../../../tools/apps/msm/core/fetch.js';

after(() => {
  setDaFetch(undefined);
  setMergeCopy(undefined);
});

describe('MSM copy from source', () => {
  beforeEach(() => {
    setDaFetch(undefined);
  });

  it('reads the source with no-store and writes it to the target', async () => {
    const requests = [];
    setDaFetch(async (url, opts) => {
      requests.push({ url, opts });
      if (!opts?.method) {
        return { ok: true, blob: async () => new Blob(['<main>source</main>']) };
      }
      return { ok: true };
    });
    assert.deepEqual(await copyFromSource('org', 'source', 'target', '/en/page'), { ok: true });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], {
      url: `${DA_ORIGIN}/source/org/source/en/page.html`,
      opts: { cache: 'no-store' },
    });
    assert.equal(requests[1].url, `${DA_ORIGIN}/source/org/target/en/page.html`);
    assert.equal(requests[1].opts.method, 'PUT');
    assert.equal(requests[1].opts.cache, undefined);
    const data = requests[1].opts.body.get('data');
    assert.equal(data.type, 'text/html');
    assert.equal(await data.text(), '<main>source</main>');
  });

  it('does not write when the source read fails', async () => {
    const requests = [];
    setDaFetch(async (url, opts) => {
      requests.push({ url, opts });
      return { ok: false, status: 404 };
    });
    assert.deepEqual(await copyFromSource('org', 'source', 'target', '/page'), {
      error: 'Failed to fetch source content (404)',
    });
    assert.deepEqual(requests, [{
      url: `${DA_ORIGIN}/source/org/source/page.html`,
      opts: { cache: 'no-store' },
    }]);
  });

  it('reports a failed target write', async () => {
    setDaFetch(async (url, opts) => (opts?.method === 'PUT'
      ? { ok: false, status: 403 }
      : { ok: true, blob: async () => new Blob(['{}']) }));
    assert.deepEqual(await copyFromSource('org', 'source', 'target', '/data', 'json'), {
      error: 'Failed to copy from source (403)',
    });
  });
});

describe('MSM public loc merge', () => {
  beforeEach(() => {
    setMergeCopy(undefined);
    setDaFetch(undefined);
    setEditUrlOrigin('https://da.live');
  });

  it('passes SDK fetch, DA origin, paths, and message to mergeCopy', async () => {
    let args;
    setMergeCopy(async (options) => {
      args = options;
      return { ok: true, status: 200 };
    });
    const result = await mergeFromSource('org', 'source', 'target', '/en/page');
    assert.deepEqual(result, {
      ok: true, editUrl: 'https://da.live/edit#/org/target/en/page',
    });
    assert.deepEqual(args, {
      fetch: daFetch,
      daOrigin: DA_ORIGIN,
      urlSource: '/org/source/en/page.html',
      urlTarget: '/org/target/en/page.html',
      msg: 'MSM Merge',
    });
  });

  it('routes merge requests through the SDK fetch', async () => {
    const requests = [];
    setDaFetch(async (url) => {
      requests.push(url);
      return { ok: true };
    });
    setMergeCopy(async ({ fetch, daOrigin, urlTarget }) => fetch(`${daOrigin}/source${urlTarget}`));
    assert.equal((await mergeFromSource('org', 'source', 'target', '/page')).ok, true);
    assert.deepEqual(requests, [`${DA_ORIGIN}/source/org/target/page.html`]);
  });

  it('retains copy error details for the caller', async () => {
    setMergeCopy(async () => ({ ok: false, status: 401, error: 'Source read failed (401)' }));
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.equal(result.error, 'Source read failed (401)');
  });

  it('uses the current mergeCopy after it is replaced', async () => {
    setMergeCopy(async () => ({ ok: true }));
    assert.equal((await mergeFromSource('org', 'source', 'target', '/page')).ok, true);
    let calls = 0;
    setMergeCopy(async () => {
      calls += 1;
      return { ok: true };
    });
    assert.equal((await mergeFromSource('org', 'source', 'target', '/page')).ok, true);
    assert.equal(calls, 1);
  });

  it('shares mergeCopy across concurrent merges', async () => {
    let calls = 0;
    setMergeCopy(async () => {
      calls += 1;
      return { ok: true };
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => (
      mergeFromSource('org', 'source', 'target', '/page')
    )));
    assert.ok(results.every((result) => result.ok));
    assert.equal(calls, 6);
  });

  it('preserves transport denial details for the caller', async () => {
    setMergeCopy(async () => ({
      ok: false, status: 500, error: 'Outside permitted scope', code: 'denied',
    }));
    assert.deepEqual(await mergeFromSource('org', 'source', 'target', '/page'), {
      error: 'Outside permitted scope', code: 'denied',
    });
  });

  it('reports a rejected merge without retrying', async () => {
    let calls = 0;
    setMergeCopy(async () => {
      calls += 1;
      throw Object.assign(new Error('Host connection closed'), { code: 'closed' });
    });
    assert.deepEqual(await mergeFromSource('org', 'source', 'target', '/page'), {
      error: 'Host connection closed', code: 'closed',
    });
    assert.equal(calls, 1);
  });
});
