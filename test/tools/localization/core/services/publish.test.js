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
import createPublishService, { toAemPath } from '../../../../../tools/localization/core/services/publish.js';

const FAST = { minInterval: 0, retries: 0, backoff: 1 };

function createFakeApi(statuses = {}) {
  const calls = [];
  const respond = (operation) => async (target) => {
    calls.push([operation, target.path]);
    return new Response('{}', { status: statuses[operation] ?? 200, headers: { 'x-error': `${operation} failed` } });
  };
  return { api: { aem: { preview: respond('preview'), publish: respond('publish') } }, calls };
}

describe('toAemPath', () => {
  it('strips .html and maps index pages to their folder', () => {
    assert.equal(toAemPath('/en/products/x.html'), '/en/products/x');
    assert.equal(toAemPath('/en/index.html'), '/en/');
    assert.equal(toAemPath('/index.html'), '/');
  });

  it('keeps other extensions', () => {
    assert.equal(toAemPath('/en/data.json'), '/en/data.json');
    assert.equal(toAemPath('/en/media/logo.png'), '/en/media/logo.png');
  });
});

describe('publish service: state', () => {
  const body = (live, preview) => JSON.stringify({
    live: { status: live }, preview: { status: preview },
  });

  function statusApi(responses, calls = []) {
    return {
      calls,
      api: {
        aem: {
          status: async (target) => {
            calls.push(target.path);
            const response = responses[target.path];
            if (response instanceof Error) throw response;
            return response ?? new Response(body(404, 404));
          },
        },
      },
    };
  }

  it('reads live and preview from the status response with AEM paths', async () => {
    const { api, calls } = statusApi({
      '/en/a': new Response(body(200, 200)),
      '/en/b': new Response(body(404, 200)),
      '/en/': new Response(body(404, 404)),
    });
    const service = createPublishService({ org: 'acme', api, ...FAST });
    assert.deepEqual(await service.state({ site: 's', path: '/en/a.html' }), { live: true, preview: true });
    assert.deepEqual(await service.state({ site: 's', path: '/en/b.html' }), { live: false, preview: true });
    assert.deepEqual(await service.state({ site: 's', path: '/en/index.html' }), { live: false, preview: false });
    assert.deepEqual(calls, ['/en/a', '/en/b', '/en/']);
  });

  it('is unknown (null) on failed or malformed lookups', async () => {
    const { api } = statusApi({
      '/a': new Response('{}', { status: 401 }),
      '/b': new Response('nope'),
      '/c': new Error('network'),
      '/d': new Response('{}'),
    });
    const service = createPublishService({ org: 'acme', api, ...FAST });
    const states = await Promise.all(['/a.html', '/b.html', '/c.html', '/d.html']
      .map((path) => service.state({ site: 's', path })));
    assert.deepEqual(states, [null, null, null, null]);
  });

  it('caches and de-duplicates lookups until cleared', async () => {
    const { api, calls } = statusApi({ '/a': new Response(body(200, 200)) });
    const service = createPublishService({ org: 'acme', api, ...FAST });
    const page = { site: 's', path: '/a.html' };
    await Promise.all([service.state(page), service.state(page)]);
    await service.state(page);
    assert.equal(calls.length, 1);
    service.clear();
    await service.state(page);
    assert.equal(calls.length, 2);
  });

  it('limits concurrent lookups', async () => {
    let active = 0;
    let peak = 0;
    const api = {
      aem: {
        status: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => { setTimeout(resolve, 5); });
          active -= 1;
          return new Response(body(200, 200));
        },
      },
    };
    const service = createPublishService({
      org: 'acme', api, ...FAST, concurrency: 2,
    });
    await Promise.all(Array.from({ length: 6 }, (_, i) => service.state({ site: 's', path: `/p${i}.html` })));
    assert.equal(peak, 2);
  });

  it('spaces the start of lookups by the minimum interval', async () => {
    const starts = [];
    const api = {
      aem: {
        status: async () => {
          starts.push(Date.now());
          return new Response(body(200, 200));
        },
      },
    };
    const service = createPublishService({
      org: 'acme', api, concurrency: 4, minInterval: 40, retries: 0,
    });
    await Promise.all(Array.from({ length: 4 }, (_, i) => service.state({ site: 's', path: `/p${i}.html` })));
    starts.slice(1).forEach((time, i) => assert.ok(time - starts[i] >= 35));
  });

  it('retries on 429 and thrown errors, then succeeds', async () => {
    const queue = [new Response('{}', { status: 429 }), new Error('cors'), new Response(body(200, 200))];
    const api = {
      aem: {
        status: async () => {
          const next = queue.shift();
          if (next instanceof Error) throw next;
          return next;
        },
      },
    };
    const service = createPublishService({
      org: 'acme', api, minInterval: 0, retries: 2, backoff: 1,
    });
    assert.deepEqual(await service.state({ site: 's', path: '/a.html' }), { live: true, preview: true });
  });

  it('gives up as unknown after the retries and does not retry a 401', async () => {
    let calls = 0;
    const respond = (status) => async () => { calls += 1; return new Response('{}', { status }); };
    const api = { aem: { status: respond(429) } };
    const service = createPublishService({
      org: 'acme', api, minInterval: 0, retries: 2, backoff: 1,
    });
    assert.equal(await service.state({ site: 's', path: '/a.html' }), null);
    assert.equal(calls, 3);
    calls = 0;
    api.aem.status = respond(401);
    assert.equal(await service.state({ site: 's', path: '/b.html' }), null);
    assert.equal(calls, 1);
  });

  it('forgets a single page on invalidate', async () => {
    const { api, calls } = statusApi({ '/a': new Response(body(200, 200)) });
    const service = createPublishService({ org: 'acme', api, ...FAST });
    const page = { site: 's', path: '/a.html' };
    await service.state(page);
    service.invalidate(page);
    await service.state(page);
    assert.equal(calls.length, 2);
  });

  it('is unknown without an api status call', async () => {
    const service = createPublishService({ org: 'acme', api: { aem: {} } });
    assert.equal(await service.state({ site: 's', path: '/a.html' }), null);
  });

  it('forgets the cached state after a successful preview or publish', async () => {
    const responses = { '/a': new Response(body(404, 404)) };
    const { api, calls } = statusApi(responses);
    api.aem.preview = async () => new Response('{}');
    api.aem.publish = async () => new Response('{}');
    const service = createPublishService({ org: 'acme', api, ...FAST });
    const page = { site: 's', path: '/a.html' };
    await service.state(page);
    await service.publish(page);
    responses['/a'] = new Response(body(200, 200));
    assert.deepEqual(await service.state(page), { live: true, preview: true });
    assert.equal(calls.length, 2);
  });
});

describe('publish service', () => {
  it('previews with the AEM path', async () => {
    const { api, calls } = createFakeApi();
    const service = createPublishService({ org: 'acme', api, ...FAST });
    assert.deepEqual(await service.preview({ site: 'global', path: '/en/x.html' }), { ok: true, status: 200 });
    assert.deepEqual(calls, [['preview', '/en/x']]);
  });

  it('publishes by previewing first, then going live', async () => {
    const { api, calls } = createFakeApi();
    const service = createPublishService({ org: 'acme', api, ...FAST });
    assert.deepEqual(await service.publish({ site: 'global', path: '/en/x.html' }), { ok: true, status: 200 });
    assert.deepEqual(calls, [['preview', '/en/x'], ['publish', '/en/x']]);
  });

  it('stops publishing when the preview fails', async () => {
    const { api, calls } = createFakeApi({ preview: 403 });
    const service = createPublishService({ org: 'acme', api, ...FAST });
    const result = await service.publish({ site: 'global', path: '/en/x.html' });
    assert.deepEqual(result, { ok: false, status: 403, error: 'preview failed' });
    assert.deepEqual(calls, [['preview', '/en/x']]);
  });
});

describe('publish service: stateMany', () => {
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const entry = (path, live, preview) => ({
    path,
    ...(live ? { publishLastModified: '2026-01-01T00:00:00Z' } : {}),
    ...(preview ? { previewLastModified: '2026-01-01T00:00:00Z' } : {}),
  });
  const BULK = {
    bulkChunk: 100, pollInterval: 0, maxPolls: 3, ...FAST,
  };

  function bulkApi({
    resources = () => [], states = ['created', 'running', 'stopped'], start, jobStatus, singles = {},
  } = {}) {
    const log = [];
    let jobs = 0;
    const polls = {};
    const api = {
      aem: {
        bulkStatus: async (request) => {
          log.push(['bulk', request]);
          if (start) return start(request);
          jobs += 1;
          const name = `job-${jobs}`;
          polls[name] = { request, step: 0 };
          return json({ status: 202, job: { topic: 'status', name, state: 'created' } }, 202);
        },
        job: async ({ name, details, ...rest }) => {
          log.push([details ? 'details' : 'job', name, rest.topic]);
          if (jobStatus) return jobStatus({ name, details });
          const poll = polls[name];
          if (details) return json({ name, state: 'stopped', data: { resources: resources(poll.request) } });
          poll.step += 1;
          return json({ name, state: states[Math.min(poll.step, states.length - 1)] });
        },
        status: async (target) => {
          log.push(['single', target.path]);
          return singles[target.path] ?? json({ live: { status: 404 }, preview: { status: 404 } });
        },
      },
    };
    return { api, log };
  }

  const allPublished = ({ paths }) => paths.map((path) => entry(path, true, true));
  const pages = (...paths) => paths.map((path) => ({ site: 's', path }));

  it('fills the state cache from one bulk status job with AEM paths', async () => {
    const { api, log } = bulkApi({
      resources: () => [
        entry('/en/a', true, true), entry('/en/b', false, true), entry('/en/', false, false),
      ],
    });
    const service = createPublishService({ org: 'acme', api, ...BULK });
    const result = await service.stateMany(pages('/en/a.html', '/en/b.html', '/en/index.html'));
    assert.deepEqual(result, [
      { live: true, preview: true },
      { live: false, preview: true },
      { live: false, preview: false },
    ]);
    assert.deepEqual(log[0], ['bulk', {
      org: 'acme', site: 's', paths: ['/en/a', '/en/b', '/en/'], select: ['preview', 'live'],
    }]);
    assert.deepEqual(log.slice(1).map(([kind]) => kind), ['job', 'job', 'details']);
    assert.deepEqual(await service.state({ site: 's', path: '/en/a.html' }), { live: true, preview: true });
    assert.equal(log.filter(([kind]) => kind === 'single').length, 0);
  });

  it('reads status objects on result entries and treats unlisted paths as not published', async () => {
    const { api } = bulkApi({
      resources: () => [
        { path: '/a', live: { status: 200 }, preview: { status: 200 } },
        { path: '/b', live: { status: 404 }, preview: { status: 200 } },
      ],
    });
    const service = createPublishService({ org: 'acme', api, ...BULK });
    assert.deepEqual(await service.stateMany(pages('/a', '/b', '/c')), [
      { live: true, preview: true }, { live: false, preview: true }, { live: false, preview: false },
    ]);
  });

  it('uses a synchronous job result without polling', async () => {
    const { api, log } = bulkApi({
      start: async () => json({
        job: { state: 'stopped', data: { resources: [entry('/a', true, true)] } },
      }),
    });
    const service = createPublishService({ org: 'acme', api, ...BULK });
    assert.deepEqual(await service.stateMany(pages('/a')), [{ live: true, preview: true }]);
    assert.equal(log.length, 1);
  });

  it('groups by site and chunks large path lists, one job per chunk', async () => {
    const { api, log } = bulkApi({ resources: allPublished });
    const service = createPublishService({
      org: 'acme', api, ...BULK, bulkChunk: 2,
    });
    const input = [
      ...pages('/1', '/2', '/3'),
      { site: 'other', path: '/1' },
    ];
    const result = await service.stateMany(input);
    assert.equal(result.every((state) => state.live), true);
    const bulks = log.filter(([kind]) => kind === 'bulk').map(([, request]) => [request.site, request.paths]);
    assert.deepEqual(bulks, [['s', ['/1', '/2']], ['s', ['/3']], ['other', ['/1']]]);
  });

  it('does not refetch cached or in-flight pages, and state() reuses the bulk lookup', async () => {
    const { api, log } = bulkApi({ resources: allPublished });
    const service = createPublishService({ org: 'acme', api, ...BULK });
    const first = service.stateMany(pages('/a', '/b'));
    const single = service.state({ site: 's', path: '/a' });
    const second = service.stateMany(pages('/a', '/b'));
    await Promise.all([first, single, second]);
    assert.equal(log.filter(([kind]) => kind === 'bulk').length, 1);
    assert.equal(log.filter(([kind]) => kind === 'single').length, 0);
    await service.stateMany(pages('/a', '/c'));
    assert.deepEqual(log.filter(([kind]) => kind === 'bulk').at(-1)[1].paths, ['/c']);
  });

  it('refetches after clear', async () => {
    const { api, log } = bulkApi({ resources: allPublished });
    const service = createPublishService({ org: 'acme', api, ...BULK });
    await service.stateMany(pages('/a'));
    service.clear();
    await service.stateMany(pages('/a'));
    assert.equal(log.filter(([kind]) => kind === 'bulk').length, 2);
  });

  it('falls back to single lookups when the job cannot be created', async () => {
    const { api, log } = bulkApi({
      start: async () => new Response('', { status: 500 }),
      singles: { '/a': json({ live: { status: 200 }, preview: { status: 200 } }) },
    });
    const service = createPublishService({ org: 'acme', api, ...BULK });
    assert.deepEqual(await service.stateMany(pages('/a', '/b')), [
      { live: true, preview: true }, { live: false, preview: false },
    ]);
    assert.deepEqual(log.filter(([kind]) => kind === 'single').map(([, path]) => path), ['/a', '/b']);
  });

  it('falls back when the endpoint throws or the job never finishes', async () => {
    const thrown = bulkApi({ start: async () => { throw new Error('network'); } });
    const a = createPublishService({ org: 'acme', api: thrown.api, ...BULK });
    assert.deepEqual(await a.stateMany(pages('/a')), [{ live: false, preview: false }]);
    const stuck = bulkApi({ states: ['running'] });
    const b = createPublishService({ org: 'acme', api: stuck.api, ...BULK });
    assert.deepEqual(await b.stateMany(pages('/a')), [{ live: false, preview: false }]);
    assert.equal(stuck.log.filter(([kind]) => kind === 'job').length, 3);
    assert.equal(stuck.log.filter(([kind]) => kind === 'single').length, 1);
  });

  it('is null without falling back when not authorized', async () => {
    const denied = bulkApi({ start: async () => new Response('', { status: 401 }) });
    const service = createPublishService({ org: 'acme', api: denied.api, ...BULK });
    assert.deepEqual(await service.stateMany(pages('/a', '/b')), [null, null]);
    assert.equal(denied.log.filter(([kind]) => kind === 'single').length, 0);
    const unauthorized = Object.assign(new Error('Request not authorized (401)'), { status: 401 });
    const missing = bulkApi({ start: async () => { throw unauthorized; } });
    const other = createPublishService({ org: 'acme', api: missing.api, ...BULK });
    assert.deepEqual(await other.stateMany(pages('/a')), [null]);
    assert.equal(missing.log.filter(([kind]) => kind === 'single').length, 0);
  });

  it('uses single lookups when the api has no bulk endpoints', async () => {
    const calls = [];
    const status = async (target) => {
      calls.push(target.path);
      return json({ live: { status: 200 }, preview: { status: 200 } });
    };
    const api = { aem: { status } };
    const service = createPublishService({ org: 'acme', api, ...FAST });
    assert.deepEqual(await service.stateMany(pages('/a')), [{ live: true, preview: true }]);
    assert.deepEqual(calls, ['/a']);
  });
});
