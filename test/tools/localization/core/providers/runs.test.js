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
import createRunsProvider from '../../../../../tools/localization/core/providers/runs.js';
import createLegacyApi from '../../../../../tools/localization/core/api/legacy.js';

const DA_ORIGIN = 'https://admin.example';

function createStore() {
  const stored = new Map();
  const fetch = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    if (method === 'POST') {
      stored.set(url, await options.body.get('data').text());
      return new Response('', { status: 201 });
    }
    if (url.startsWith(`${DA_ORIGIN}/list/`)) {
      const folder = url.replace(`${DA_ORIGIN}/list`, `${DA_ORIGIN}/source`);
      const items = [...stored.keys()]
        .filter((key) => key.startsWith(`${folder}/`))
        .map((key, number) => {
          const name = key.split('/').pop().replace('.json', '');
          return { name, ext: 'json', lastModified: number };
        });
      return new Response(JSON.stringify(items), { status: 200 });
    }
    if (!stored.has(url)) return new Response('', { status: 404 });
    return new Response(stored.get(url), { status: 200 });
  };
  return { fetch, stored };
}

describe('runs provider', () => {
  it('saves, reads and lists runs under .da/loc/runs, newest first', async () => {
    const store = createStore();
    const runs = createRunsProvider({ org: 'acme', api: createLegacyApi({ fetch: store.fetch, daOrigin: DA_ORIGIN }) });
    await runs.save({ id: 'run-a', site: 'gamebox', items: [] });
    await runs.save({ id: 'run-b', site: 'gamebox', items: [] });
    assert.ok(store.stored.has(`${DA_ORIGIN}/source/acme/gamebox/.da/loc/runs/run-a.json`));
    assert.deepEqual(await runs.read('gamebox', 'run-a'), { id: 'run-a', site: 'gamebox', items: [] });
    assert.equal(await runs.read('gamebox', 'missing'), null);
    assert.deepEqual((await runs.list('gamebox')).map((entry) => entry.id), ['run-b', 'run-a']);
  });

  it('lists nothing when the runs folder does not exist', async () => {
    const fetch = async () => new Response('', { status: 404 });
    const runs = createRunsProvider({ org: 'acme', api: createLegacyApi({ fetch, daOrigin: DA_ORIGIN }) });
    assert.deepEqual(await runs.list('gamebox'), []);
  });

  it('throws other listing failures', async () => {
    const fetch = async () => new Response('', { status: 401 });
    const runs = createRunsProvider({ org: 'acme', api: createLegacyApi({ fetch, daOrigin: DA_ORIGIN }) });
    await assert.rejects(runs.list('gamebox'), /401/);
  });
});
