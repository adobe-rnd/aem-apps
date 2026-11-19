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
/* global globalThis */
/* eslint-disable import/no-relative-packages -- Repository tests import the local app package. */
import assert from 'node:assert/strict';
import test from 'node:test';
import proxy from '../../../../tools/apps/workfront/adobeio/actions/proxy/index.js';

const appOrigin = 'https://main--site--org.aem.page';
const inputs = {
  WORKFRONT_ORIGIN: 'https://cashubv2workfront.my.workfront.com',
  ALLOWED_ORIGINS: 'https://*.aem.page, https://da.live',
};

function invoke({
  method = 'get', path = '/attask/api/v21.0/user/current', query = '', body, headers = {},
} = {}) {
  return proxy.main({
    ...inputs,
    __ow_method: method,
    __ow_path: path,
    __ow_query: query,
    __ow_body: body,
    __ow_headers: { origin: appOrigin, authorization: 'Bearer token', ...headers },
  });
}

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('origin allowlist supports exact and single-label wildcard matches', () => {
  const allowed = ['https://*.aem.page', 'https://da.live'];
  assert.equal(proxy.isAllowedOrigin(appOrigin, allowed), true);
  assert.equal(proxy.isAllowedOrigin('https://da.live', allowed), true);
  assert.equal(proxy.isAllowedOrigin('https://a.b.aem.page', allowed), false);
  assert.equal(proxy.isAllowedOrigin('https://x.aem.page.evil.com', allowed), false);
  assert.equal(proxy.isAllowedOrigin(undefined, allowed), false);
});

test('preflight returns CORS headers for allowed origins and rejects others', async () => {
  const ok = await invoke({ method: 'options', headers: { authorization: undefined } });
  assert.equal(ok.statusCode, 204);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], appOrigin);
  assert.match(ok.headers['Access-Control-Allow-Headers'], /Authorization/);
  const denied = await invoke({ method: 'options', headers: { origin: 'https://evil.example' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
});

test('forwards GET requests to the configured tenant with only the allowed headers', async () => {
  let forwarded;
  const result = await withFetch(async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response('{"data":{"ID":"u"}}', { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'x=1' } });
  }, () => invoke({ query: 'fields=ID', headers: { cookie: 'secret=1', accept: 'application/json' } }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Access-Control-Allow-Origin'], appOrigin);
  assert.equal(result.headers['Set-Cookie'], undefined);
  assert.equal(result.body, '{"data":{"ID":"u"}}');
  assert.equal(forwarded.url, 'https://cashubv2workfront.my.workfront.com/attask/api/v21.0/user/current?fields=ID');
  assert.deepEqual(forwarded.init.headers, { authorization: 'Bearer token', accept: 'application/json' });
  assert.equal(forwarded.init.redirect, 'manual');
});

test('forwards form bodies as text and decodes base64 JSON bodies', async () => {
  const bodies = [];
  await withFetch(async (url, init) => {
    bodies.push(Buffer.from(init.body).toString('utf8'));
    return new Response('{"data":{}}', { status: 200 });
  }, async () => {
    await invoke({
      method: 'post',
      path: '/attask/api/v21.0/task',
      body: 'name=Write+copy',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    });
    await invoke({
      method: 'put',
      path: '/attask/api/v21.0/task/1',
      body: Buffer.from('{"name":"x"}').toString('base64'),
      headers: { 'content-type': 'application/json' },
    });
  });
  assert.deepEqual(bodies, ['name=Write+copy', '{"name":"x"}']);
});

test('rejects request bodies other than form or JSON', async () => {
  const result = await invoke({
    method: 'post',
    path: '/attask/api/v21.0/task',
    body: '<task/>',
    headers: { 'content-type': 'application/xml' },
  });
  assert.equal(result.statusCode, 415);
});

test('rejects paths outside the API, including traversal, before calling Workfront', async () => {
  let called = false;
  await withFetch(async () => { called = true; return new Response('{}'); }, async () => {
    const paths = ['/login', '/attask/api/v21.0/../../login', '/attask/api/v21.0/%2e%2e/%2e%2e/x', '//evil.example/attask/api/v21.0/x'];
    await Promise.all(paths.map(async (path) => {
      assert.equal((await invoke({ path })).statusCode, 404, path);
    }));
  });
  assert.equal(called, false);
});

test('rejects unsupported methods, missing tokens and upstream redirects', async () => {
  assert.equal((await invoke({ method: 'delete' })).statusCode, 405);
  assert.equal((await invoke({ headers: { authorization: undefined } })).statusCode, 401);
  const redirected = await withFetch(
    async () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere' } }),
    () => invoke(),
  );
  assert.equal(redirected.statusCode, 502);
});
