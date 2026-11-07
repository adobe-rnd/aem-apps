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
