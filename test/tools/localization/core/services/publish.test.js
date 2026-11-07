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
    const service = createPublishService({ org: 'acme', api });
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
    const service = createPublishService({ org: 'acme', api });
    const states = await Promise.all(['/a.html', '/b.html', '/c.html', '/d.html']
      .map((path) => service.state({ site: 's', path })));
    assert.deepEqual(states, [null, null, null, null]);
  });

  it('caches and de-duplicates lookups until cleared', async () => {
    const { api, calls } = statusApi({ '/a': new Response(body(200, 200)) });
    const service = createPublishService({ org: 'acme', api });
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
    const service = createPublishService({ org: 'acme', api, concurrency: 2 });
    await Promise.all(Array.from({ length: 6 }, (_, i) => service.state({ site: 's', path: `/p${i}.html` })));
    assert.equal(peak, 2);
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
    const service = createPublishService({ org: 'acme', api });
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
    const service = createPublishService({ org: 'acme', api });
    assert.deepEqual(await service.preview({ site: 'global', path: '/en/x.html' }), { ok: true, status: 200 });
    assert.deepEqual(calls, [['preview', '/en/x']]);
  });

  it('publishes by previewing first, then going live', async () => {
    const { api, calls } = createFakeApi();
    const service = createPublishService({ org: 'acme', api });
    assert.deepEqual(await service.publish({ site: 'global', path: '/en/x.html' }), { ok: true, status: 200 });
    assert.deepEqual(calls, [['preview', '/en/x'], ['publish', '/en/x']]);
  });

  it('stops publishing when the preview fails', async () => {
    const { api, calls } = createFakeApi({ preview: 403 });
    const service = createPublishService({ org: 'acme', api });
    const result = await service.publish({ site: 'global', path: '/en/x.html' });
    assert.deepEqual(result, { ok: false, status: 403, error: 'preview failed' });
    assert.deepEqual(calls, [['preview', '/en/x']]);
  });
});
