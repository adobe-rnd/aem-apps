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
// Publish, bulk publish and job polling cases shared by the v1 and v2 inbox
// tests: their api.js files have the same publish functions.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pingFetch, stubDaFetch } from './da-fetch-stub.js';

const PROXY = 'https://da-etc.adobeaem.workers.dev/cors';
const HLX6 = ['org/hlx6-site'];

/**
 * @param {string} name - suite name
 * @param {() => Promise<object>} load - imports the inbox api.js
 */
export default function describeInboxPublish(name, load) {
  describe(name, () => {
    it('publishes a legacy page through the proxied admin.hlx.page call', async (test) => {
      const api = await load();
      test.mock.method(global, 'fetch', pingFetch(HLX6));
      const calls = stubDaFetch(() => Response.json({ live: { status: 200 } }));
      const result = await api.publishContent('org', 'legacy-site', '/drafts/x');
      assert.equal(result.success, true);
      assert.deepEqual(calls.map(({ url, opts }) => [url, opts.method]), [
        [`${PROXY}?url=https://admin.hlx.page/live/org/legacy-site/main/drafts/x`, 'POST'],
      ]);
    });

    it('publishes a Helix 6 page on api.aem.live', async (test) => {
      const api = await load();
      test.mock.method(global, 'fetch', pingFetch(HLX6));
      const calls = stubDaFetch(() => Response.json({ live: { status: 200 } }));
      const result = await api.publishContent('org', 'hlx6-site', 'drafts/x');
      assert.equal(result.success, true);
      assert.deepEqual(result.data, { live: { status: 200 } });
      assert.deepEqual(calls.map(({ url, opts }) => [url, opts.method]), [
        ['https://api.aem.live/org/sites/hlx6-site/live/drafts/x', 'POST'],
      ]);
    });

    it('bulk publishes legacy pages through the proxied admin.hlx.page call', async (test) => {
      const api = await load();
      test.mock.method(global, 'fetch', pingFetch(HLX6));
      const self = 'https://admin.hlx.page/job/org/legacy-site/main/publish/job-1';
      const calls = stubDaFetch(() => Response.json({ job: { state: 'created' }, links: { self } }, { status: 202 }));
      const result = await api.bulkPublishContent('org', 'legacy-site', ['/a', 'b']);
      assert.equal(result.success, true);
      assert.equal(result.links.self, self);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `${PROXY}?url=https://admin.hlx.page/live/org/legacy-site/main/*`);
      assert.equal(calls[0].opts.method, 'POST');
      assert.equal(calls[0].opts.body, JSON.stringify({ paths: ['/a', '/b'] }));
    });

    it('bulk publishes Helix 6 pages on api.aem.live as a job it can poll', async (test) => {
      const api = await load();
      test.mock.method(global, 'fetch', pingFetch(HLX6));
      const self = 'https://api.aem.live/org/sites/hlx6-site/jobs/live-publish/job-1';
      const calls = stubDaFetch(() => Response.json({ job: { state: 'created' }, links: { self } }, { status: 202 }));
      const result = await api.bulkPublishContent('org', 'hlx6-site', ['/a', 'b']);
      assert.equal(result.success, true);
      assert.equal(result.links.self, self);
      assert.equal(calls.length, 1);
      // api.aem.live takes bulk paths at the resource root; it answers /* with a 400.
      assert.equal(calls[0].url, 'https://api.aem.live/org/sites/hlx6-site/live/');
      assert.equal(calls[0].opts.method, 'POST');
      assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
      // Without forceAsync, Helix 6 runs up to 200 paths synchronously and
      // keeps no job, so the inbox's /details poll would fail.
      assert.deepEqual(JSON.parse(calls[0].opts.body), { paths: ['/a', '/b'], forceAsync: true });
    });

    it('publishes through the proxied admin.hlx.page call when the admin ping fails', async (test) => {
      const api = await load();
      test.mock.method(global, 'fetch', async () => new Response(null, { status: 503, headers: { 'retry-after': '0' } }));
      const calls = stubDaFetch(() => Response.json({ live: { status: 200 } }, { status: 202 }));
      const single = await api.publishContent('org', 'ping-down', '/drafts/x');
      const bulk = await api.bulkPublishContent('org', 'ping-down', ['/a']);
      assert.deepEqual([single.success, bulk.success], [true, true]);
      assert.deepEqual(calls.map(({ url, opts }) => [url, opts.method, opts.body]), [
        [`${PROXY}?url=https://admin.hlx.page/live/org/ping-down/main/drafts/x`, 'POST', undefined],
        [`${PROXY}?url=https://admin.hlx.page/live/org/ping-down/main/*`, 'POST', JSON.stringify({ paths: ['/a'] })],
      ]);
    });

    it('polls a legacy job through the proxy', async () => {
      const api = await load();
      const self = 'https://admin.hlx.page/job/org/legacy-site/main/publish/job-1';
      const calls = stubDaFetch(() => Response.json({ state: 'stopped', data: { resources: [] } }));
      const result = await api.pollJobStatus(self, 1000, 1);
      assert.equal(result.success, true);
      assert.deepEqual(calls.map(({ url }) => url), [`${PROXY}?url=${encodeURIComponent(self)}/details`]);
    });

    it('polls a Helix 6 job on api.aem.live directly', async () => {
      const api = await load();
      const self = 'https://api.aem.live/org/sites/hlx6-site/jobs/live-publish/job-1';
      let polls = 0;
      const calls = stubDaFetch(() => {
        polls += 1;
        return Response.json({ state: polls < 2 ? 'running' : 'stopped', data: { resources: [{ path: '/a', status: 200 }] } });
      });
      const result = await api.pollJobStatus(self, 1000, 1);
      assert.equal(result.success, true);
      assert.deepEqual(result.job.data.resources, [{ path: '/a', status: 200 }]);
      assert.deepEqual(calls.map(({ url }) => url), [`${self}/details`, `${self}/details`]);
    });
  });
}
