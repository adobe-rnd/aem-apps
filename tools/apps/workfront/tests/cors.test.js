import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { isAllowedOrigin } from '../cors/worker.js';

const env = {
  WORKFRONT_ORIGIN: 'https://cashubv2workfront.my.workfront.com',
  ALLOWED_ORIGINS: 'https://*.aem.page, https://da.live',
};
const appOrigin = 'https://main--site--org.aem.page';
const proxy = 'https://proxy.example.workers.dev';

function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => { globalThis.fetch = original; });
}

test('origin allowlist supports exact and single-label wildcard matches', () => {
  const allowed = ['https://*.aem.page', 'https://da.live'];
  assert.equal(isAllowedOrigin(appOrigin, allowed), true);
  assert.equal(isAllowedOrigin('https://da.live', allowed), true);
  assert.equal(isAllowedOrigin('https://evil.example', allowed), false);
  assert.equal(isAllowedOrigin('https://a.b.aem.page', allowed), false);
  assert.equal(isAllowedOrigin('https://x.aem.page.evil.com', allowed), false);
  assert.equal(isAllowedOrigin(null, allowed), false);
});

test('preflight returns CORS headers for allowed origins and rejects others', async () => {
  const ok = await worker.fetch(new Request(`${proxy}/attask/api/v21.0/task`, { method: 'OPTIONS', headers: { Origin: appOrigin } }), env);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), appOrigin);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const denied = await worker.fetch(new Request(`${proxy}/attask/api/v21.0/task`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});

test('forwards API requests only to the configured tenant with the bearer token', async () => {
  let forwarded;
  await withFetch(async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response('{"data":{"ID":"u"}}', { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'x=1' } });
  }, async () => {
    const res = await worker.fetch(new Request(`${proxy}/attask/api/v21.0/user/current?fields=ID`, {
      headers: { Origin: appOrigin, Authorization: 'Bearer token', Cookie: 'secret=1' },
    }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), appOrigin);
    assert.equal(res.headers.get('Set-Cookie'), null);
    assert.deepEqual(await res.json(), { data: { ID: 'u' } });
  });
  assert.equal(forwarded.url, 'https://cashubv2workfront.my.workfront.com/attask/api/v21.0/user/current?fields=ID');
  assert.equal(forwarded.init.headers.get('Authorization'), 'Bearer token');
  assert.equal(forwarded.init.headers.get('Cookie'), null);
  assert.equal(forwarded.init.redirect, 'manual');
});

test('rejects non-API paths, unsupported methods and upstream redirects', async () => {
  const headers = { Origin: appOrigin };
  assert.equal((await worker.fetch(new Request(`${proxy}/login`, { headers }), env)).status, 404);
  assert.equal((await worker.fetch(new Request(`${proxy}/attask/api/v21.0/task/1`, { method: 'DELETE', headers }), env)).status, 405);
  await withFetch(async () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere' } }), async () => {
    assert.equal((await worker.fetch(new Request(`${proxy}/attask/api/v21.0/task`, { headers }), env)).status, 502);
  });
});
