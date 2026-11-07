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
import createLegacyApi from '../../../../../tools/localization/core/api/legacy.js';

const DA_ORIGIN = 'https://da.example';
const AEM_ORIGIN = 'https://aem.example';

function createRecorder(respond = () => new Response('{}')) {
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method ?? 'GET', options });
    return respond(url, options);
  };
  return { fetch, requests };
}

const apiFor = (recorder) => createLegacyApi({
  fetch: recorder.fetch, daOrigin: DA_ORIGIN, aemOrigin: AEM_ORIGIN,
});

const target = { org: 'acme', site: 'global', path: '/en/x.html' };

describe('legacy api: routing', () => {
  it('never reports Helix 6', async () => {
    assert.equal(await apiFor(createRecorder()).isHlx6({ org: 'acme', site: 'global' }), false);
  });
});

describe('legacy api: source', () => {
  it('reads, heads and deletes DA source without caching', async () => {
    const recorder = createRecorder();
    const api = apiFor(recorder);
    await api.source.get(target);
    await api.source.getMetadata(target);
    await api.source.delete(target);
    assert.deepEqual(recorder.requests.map((request) => `${request.method} ${request.url}`), [
      `GET ${DA_ORIGIN}/source/acme/global/en/x.html`,
      `HEAD ${DA_ORIGIN}/source/acme/global/en/x.html`,
      `DELETE ${DA_ORIGIN}/source/acme/global/en/x.html`,
    ]);
    assert.equal(recorder.requests[0].options.cache, 'no-store');
    assert.equal(recorder.requests[1].options.cache, 'no-store');
  });

  it('saves as multipart data typed by extension, passing conditional headers', async () => {
    const recorder = createRecorder();
    await apiFor(recorder).source.save({
      org: 'acme', site: 'global', path: '/.da/loc/en/index.json', body: '{"pages":{}}', headers: { 'If-Match': '"1"' },
    });
    const [request] = recorder.requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `${DA_ORIGIN}/source/acme/global/.da/loc/en/index.json`);
    assert.deepEqual(request.options.headers, { 'If-Match': '"1"' });
    const data = request.options.body.get('data');
    assert.equal(data.type, 'application/json');
    assert.equal(await data.text(), '{"pages":{}}');
  });

  it('types html bodies as text/html', async () => {
    const recorder = createRecorder();
    await apiFor(recorder).source.save({ ...target, body: '<main></main>' });
    assert.equal(recorder.requests[0].options.body.get('data').type, 'text/html');
  });

  it('lists a folder with pagination tokens', async () => {
    const recorder = createRecorder(() => new Response(
      JSON.stringify([{ path: '/acme/global/en/x.html', name: 'x', ext: 'html' }]),
      { headers: { 'da-continuation-token': 'next' } },
    ));
    const result = await apiFor(recorder).source.list({
      org: 'acme', site: 'global', path: '/en', continuationToken: 'prev',
    });
    assert.deepEqual(result, {
      ok: true,
      status: 200,
      items: [{ path: '/acme/global/en/x.html', name: 'x', ext: 'html' }],
      continuationToken: 'next',
    });
    assert.equal(recorder.requests[0].url, `${DA_ORIGIN}/list/acme/global/en`);
    assert.equal(recorder.requests[0].options.headers['da-continuation-token'], 'prev');
  });

  it('lists the org and a whole site', async () => {
    const recorder = createRecorder(() => new Response('[]'));
    const api = apiFor(recorder);
    await api.source.list({ org: 'acme' });
    await api.source.list({ org: 'acme', site: 'global', path: '/' });
    assert.deepEqual(recorder.requests.map((request) => request.url), [
      `${DA_ORIGIN}/list/acme`,
      `${DA_ORIGIN}/list/acme/global`,
    ]);
  });

  it('reports failed listings without items', async () => {
    const recorder = createRecorder(() => new Response('', { status: 403 }));
    const result = await apiFor(recorder).source.list({ org: 'acme' });
    assert.deepEqual(result, {
      ok: false, status: 403, items: [], continuationToken: null,
    });
  });
});

describe('legacy api: config', () => {
  it('reads site config', async () => {
    const recorder = createRecorder();
    await apiFor(recorder).config.get({ org: 'acme', site: 'global' });
    assert.equal(recorder.requests[0].url, `${DA_ORIGIN}/config/acme/global`);
    assert.equal(recorder.requests[0].options.cache, 'no-store');
  });
});

describe('legacy api: aem status', () => {
  it('reads the status of a path on the main branch', async () => {
    const recorder = createRecorder();
    const api = apiFor(recorder);
    await api.aem.status({ org: 'acme', site: 'global', path: '/en/x' });
    assert.deepEqual(recorder.requests.map((request) => `${request.method} ${request.url}`), [
      `GET ${AEM_ORIGIN}/status/acme/global/main/en/x`,
    ]);
  });
});

describe('legacy api: aem', () => {
  it('previews and publishes on the main branch', async () => {
    const recorder = createRecorder();
    const api = apiFor(recorder);
    await api.aem.preview({ org: 'acme', site: 'global', path: '/en/x' });
    await api.aem.publish({ org: 'acme', site: 'global', path: '/en/x' });
    assert.deepEqual(recorder.requests.map((request) => `${request.method} ${request.url}`), [
      `POST ${AEM_ORIGIN}/preview/acme/global/main/en/x`,
      `POST ${AEM_ORIGIN}/live/acme/global/main/en/x`,
    ]);
  });
});

describe('legacy api: aem bulk status', () => {
  it('starts a bulk status job with a JSON body for the whole site', async () => {
    const recorder = createRecorder();
    await apiFor(recorder).aem.bulkStatus({
      org: 'acme', site: 'global', paths: ['/en/a', '/en/'],
    });
    const [request] = recorder.requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, `${AEM_ORIGIN}/status/acme/global/main/*`);
    assert.equal(request.options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(request.options.body), {
      paths: ['/en/a', '/en/'], select: ['preview', 'live'],
    });
  });

  it('reads job status and details without caching', async () => {
    const recorder = createRecorder();
    const api = apiFor(recorder);
    await api.aem.job({ org: 'acme', site: 'global', name: 'job-1' });
    await api.aem.job({
      org: 'acme', site: 'global', name: 'job-1', details: true,
    });
    assert.deepEqual(recorder.requests.map((request) => `${request.method} ${request.url}`), [
      `GET ${AEM_ORIGIN}/job/acme/global/main/status/job-1`,
      `GET ${AEM_ORIGIN}/job/acme/global/main/status/job-1/details`,
    ]);
    assert.equal(recorder.requests[0].options.cache, 'no-store');
  });
});

describe('legacy api: unauthorized requests', () => {
  it('rethrows a missing IMS client id as a 401 naming the request', async (t) => {
    t.mock.method(console, 'warn', () => {});
    const api = createLegacyApi({
      fetch: async () => { throw new Error('Missing IMS Client ID'); },
      daOrigin: DA_ORIGIN,
      aemOrigin: AEM_ORIGIN,
    });
    await assert.rejects(api.source.get(target), (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.url, `${DA_ORIGIN}/source/acme/global/en/x.html`);
      assert.equal(
        error.message,
        'Request not authorized (401): GET da.example/source/acme/global/en/x.html',
      );
      return true;
    });
  });
});
