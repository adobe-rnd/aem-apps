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
import { registerHooks } from 'node:module';
import {
  mergeFromSource, setMergeCopy, setEditUrlOrigin,
} from '../../../../../tools/apps/msm/core/operations.js';
import { setDaFetch } from '../../../../../tools/apps/msm/core/fetch.js';

const publicCopyUrl = 'https://da.live/nx/public/utils/loc.js';
const mockModule = `
  export let factoryCount = 0;
  export const createMergeCopy = ({ fetch, daOrigin }) => {
    factoryCount += 1;
    return async (url, title) => {
      const [, org, site] = url.destination.split('/');
      await fetch(daOrigin + '/source/' + org + '/' + site + '/.da/translate.json');
      return fetch(daOrigin + '/source' + url.destination, { method: 'POST', body: title });
    };
  };
`;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === publicCopyUrl) {
      return { url: `data:text/javascript,${encodeURIComponent(mockModule)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

after(() => {
  hook.deregister();
  setDaFetch(undefined);
  setMergeCopy(undefined);
});

describe('MSM public merge integration', () => {
  beforeEach(() => {
    setMergeCopy(undefined);
    setDaFetch(undefined);
    setEditUrlOrigin('https://da.live');
  });

  it('loads the public copy utility and injects SDK fetch with destination config', async () => {
    const requests = [];
    setDaFetch(async (url, opts) => {
      requests.push([url, opts]);
      return { ok: true, json: async () => ({ config: { data: [] } }) };
    });
    const result = await mergeFromSource('org', 'source', 'target', '/en/page');
    assert.deepEqual(result, {
      ok: true, editUrl: 'https://da.live/edit#/org/target/en/page',
    });
    assert.deepEqual(requests.map(([url]) => url), [
      'https://admin.da.live/source/org/target/.da/translate.json',
      'https://admin.da.live/source/org/target/en/page.html',
    ]);
    assert.equal(requests[1][1].body, 'MSM Merge');
  });

  it('reports missing SDK initialization instead of importing private auth', async () => {
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.equal(result.error, 'MSM requires SDK fetch initialization');
  });

  it('retains copy error details for the caller', async () => {
    setMergeCopy(async () => ({ ok: false, status: 401, error: 'Source read failed (401)' }));
    const result = await mergeFromSource('org', 'source', 'target', '/page');
    assert.equal(result.error, 'Source read failed (401)');
  });

  it('uses the current SDK fetch after initialization changes', async () => {
    setDaFetch(async () => ({ ok: true, json: async () => ({ config: { data: [] } }) }));
    assert.equal((await mergeFromSource('org', 'source', 'target', '/page')).ok, true);
    let calls = 0;
    setDaFetch(async () => {
      calls += 1;
      return { ok: true, json: async () => ({ config: { data: [] } }) };
    });
    assert.equal((await mergeFromSource('org', 'source', 'target', '/page')).ok, true);
    assert.equal(calls, 2);
  });

  it('shares one lazily initialized copy instance across concurrent merges', async () => {
    const mock = await import(publicCopyUrl);
    const before = mock.factoryCount;
    setDaFetch(async () => ({ ok: true, json: async () => ({ config: { data: [] } }) }));
    const results = await Promise.all(Array.from({ length: 6 }, () => (
      mergeFromSource('org', 'source', 'target', '/page')
    )));
    assert.ok(results.every((result) => result.ok));
    assert.equal(mock.factoryCount - before, 1);
  });
});
