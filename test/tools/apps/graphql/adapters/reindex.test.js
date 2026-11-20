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
import { createReindexNotifier } from '../../../../../tools/apps/graphql/adapters/reindex.js';

const SERVICE = 'https://reindex.example.com';
const tick = () => new Promise((resolve) => { setTimeout(resolve); });

describe('createReindexNotifier', () => {
  it('posts the published page path to the configured service, for the live tier', async () => {
    const calls = [];
    const sites = [];
    const notify = createReindexNotifier({
      loadUrl: async (site) => { sites.push(site); return SERVICE; },
      fetchFn: async (...args) => { calls.push(args); },
    });
    notify('/acme/web/.da/graphql/endpoints/main/endpoint.html');
    await tick();
    assert.deepEqual(sites, [{ org: 'acme', site: 'web' }]);
    const [[url, opts]] = calls;
    assert.equal(url, `${SERVICE}/acme/web/reindex`);
    assert.equal(opts.method, 'POST');
    assert.deepEqual(JSON.parse(opts.body), {
      tiers: ['live'], paths: ['/.da/graphql/endpoints/main/endpoint'],
    });
  });

  it('sends nothing without a configured URL', async () => {
    const calls = [];
    const notify = createReindexNotifier({
      loadUrl: async () => undefined,
      fetchFn: async (...args) => { calls.push(args); },
    });
    notify('/acme/web/x.html');
    await tick();
    assert.equal(calls.length, 0);
  });

  it('never throws, whether the config or fetch fails', async () => {
    const ok = async () => SERVICE;
    createReindexNotifier({ loadUrl: () => Promise.reject(new Error('403')) })('/acme/web/x.html');
    createReindexNotifier({ loadUrl: () => { throw new Error('boom'); } })('/acme/web/x.html');
    createReindexNotifier({ loadUrl: ok, fetchFn: () => Promise.reject(new Error('offline')) })('/acme/web/x.html');
    createReindexNotifier({ loadUrl: ok, fetchFn: () => { throw new Error('blocked'); } })('/acme/web/x.html');
    await tick();
  });
});
