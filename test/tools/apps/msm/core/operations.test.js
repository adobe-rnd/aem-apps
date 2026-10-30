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
  mergeFromSource, setMergeCopy, setEditUrlOrigin,
} from '../../../../../tools/apps/msm/core/operations.js';
import { setDaFetch } from '../../../../../tools/apps/msm/core/fetch.js';

after(() => {
  setDaFetch(undefined);
  setMergeCopy(undefined);
});

describe('MSM SDK localization integration', () => {
  beforeEach(() => {
    setMergeCopy(undefined);
    setDaFetch(undefined);
    setEditUrlOrigin('https://da.live');
  });

  it('uses the injected SDK loc action without app-side transport wiring', async () => {
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
      urlSource: '/org/source/en/page.html',
      urlTarget: '/org/target/en/page.html',
      msg: 'MSM Merge',
    });
  });

  it('reports missing SDK initialization instead of importing private auth', async () => {
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.equal(result.error, 'MSM requires SDK localization initialization');
  });

  it('retains copy error details for the caller', async () => {
    setMergeCopy(async () => ({ ok: false, status: 401, error: 'Source read failed (401)' }));
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.equal(result.error, 'Source read failed (401)');
  });

  it('uses the current SDK loc action after initialization changes', async () => {
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

  it('passes only operation data to the SDK loc action', async () => {
    let args;
    setMergeCopy(async (options) => {
      args = options;
      return { ok: true };
    });
    assert.equal((await mergeFromSource('org', 'source', 'target', '/page')).ok, true);
    assert.deepEqual(args, {
      urlSource: '/org/source/page.html',
      urlTarget: '/org/target/page.html',
      msg: 'MSM Merge',
    });
  });

  it('shares the injected SDK loc action across concurrent merges', async () => {
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

  it('preserves SDK denial details for the caller', async () => {
    setMergeCopy(async () => ({
      ok: false, status: 500, error: 'Outside permitted scope', code: 'denied',
    }));
    assert.deepEqual(await mergeFromSource('org', 'source', 'target', '/page'), {
      error: 'Outside permitted scope', code: 'denied',
    });
  });

  it('reports a rejected SDK action without retrying', async () => {
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
