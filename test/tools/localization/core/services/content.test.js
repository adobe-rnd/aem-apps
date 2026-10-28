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
import createContentService from '../../../../../tools/localization/core/services/content.js';

function createFakes({ sourceResponse = new Response('<main>hi</main>'), copyResult = { ok: true, status: 201 } } = {}) {
  const calls = [];
  const api = {
    source: {
      get: async (target) => {
        calls.push(['get', target]);
        return sourceResponse;
      },
      delete: async (target) => {
        calls.push(['delete', target]);
        return new Response(null, { status: 204 });
      },
    },
  };
  const loc = {
    mergeCopy: async (options) => {
      calls.push(['mergeCopy', options]);
      return copyResult;
    },
    overwriteCopy: async (options) => {
      calls.push(['overwriteCopy', options]);
      return copyResult;
    },
  };
  return { service: createContentService({ org: 'acme', api, loc }), calls };
}

const source = { site: 'global', path: '/en/x.html' };
const target = { site: 'brand-b', path: '/x.html' };

describe('content service: read', () => {
  it('returns the page html', async () => {
    const { service, calls } = createFakes();
    assert.equal(await service.read(source), '<main>hi</main>');
    assert.deepEqual(calls, [['get', { org: 'acme', site: 'global', path: '/en/x.html' }]]);
  });

  it('returns null for a missing page', async () => {
    const { service } = createFakes({ sourceResponse: new Response('', { status: 404 }) });
    assert.equal(await service.read(source), null);
  });

  it('throws on other failures', async () => {
    const { service } = createFakes({ sourceResponse: new Response('', { status: 500 }) });
    await assert.rejects(service.read(source), /500/);
  });
});

describe('content service: merge and overwrite', () => {
  it('merges through the loc copy engine with org-qualified paths', async () => {
    const { service, calls } = createFakes();
    const result = await service.merge({ source, target, label: 'Localization rollout' });
    assert.deepEqual(result, { ok: true, status: 201 });
    assert.deepEqual(calls, [['mergeCopy', {
      urlSource: '/acme/global/en/x.html',
      urlTarget: '/acme/brand-b/x.html',
      msg: 'Localization rollout',
    }]]);
  });

  it('passes supplied content, e.g. a translation', async () => {
    const { service, calls } = createFakes();
    await service.overwrite({
      source, target, label: 'Localization translation', content: '<main>hola</main>',
    });
    assert.deepEqual(calls, [['overwriteCopy', {
      urlSource: '/acme/global/en/x.html',
      urlTarget: '/acme/brand-b/x.html',
      msg: 'Localization translation',
      sourceContent: '<main>hola</main>',
    }]]);
  });

  it('reports copy engine failures', async () => {
    const { service } = createFakes({ copyResult: { ok: false, status: 500, error: 'boom' } });
    assert.deepEqual(await service.merge({ source, target, label: 'x' }), { ok: false, status: 500, error: 'boom' });
  });

  it('reports a missing copy engine as a failure', async () => {
    const service = createContentService({ org: 'acme', api: {}, loc: undefined });
    const result = await service.merge({ source, target, label: 'x' });
    assert.equal(result.ok, false);
    assert.match(result.error, /copy engine/i);
  });
});

describe('content service: remove', () => {
  it('deletes the page', async () => {
    const { service, calls } = createFakes();
    assert.deepEqual(await service.remove(target), { ok: true, status: 204 });
    assert.deepEqual(calls, [['delete', { org: 'acme', site: 'brand-b', path: '/x.html' }]]);
  });
});
