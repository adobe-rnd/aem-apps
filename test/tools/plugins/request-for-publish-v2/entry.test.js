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
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../../tools/plugins/request-for-publish-v2/request-for-publish-v2.js', import.meta.url), 'utf8');
const makePanelSource = source.slice(source.indexOf('function makePanel('), source.indexOf('export default'));

function loadPanel(overrides = {}) {
  return vm.runInNewContext(`(${makePanelSource.trim()})`, {
    URL,
    Headers,
    document: { createElement: () => ({}) },
    window: { location: new URL('https://apps.example.com/') },
    setImsDetails: () => {},
    workerOrigin: () => 'https://worker.example.com',
    createWorkspaceActions: () => ({ save: async () => {} }),
    createClient: (options) => options,
    ...overrides,
  });
}

it('previews and publishes the page content ref through Admin', async () => {
  const calls = [];
  const makePanel = loadPanel({ daFetch: async (...args) => calls.push(args) });
  const panel = makePanel({ context: {}, token: 'sdk-token', actions: {} });
  const page = {
    org: 'example', site: 'website', path: '/drafts/page.html', ref: 'release-42',
  };
  await panel.client.preview(page);
  await panel.client.publish(page);
  assert.equal(calls.length, 2);
  ['preview', 'live'].forEach((operation, index) => {
    assert.equal(
      new URL(calls[index][0]).searchParams.get('url'),
      `https://admin.hlx.page/${operation}/example/website/release-42/drafts/page.html`,
    );
    assert.equal(calls[index][1].method, 'POST');
  });
});

it('uses plain fetch with the SDK bearer token and preserves worker JSON options', async () => {
  const calls = [];
  const response = { ok: true };
  const rejectDaFetch = () => assert.fail('Worker calls must not use DA fetch');
  const makePanel = loadPanel({
    daFetch: rejectDaFetch,
    fetch: async (...args) => { calls.push(args); return response; },
  });
  const panel = makePanel({
    context: {}, token: 'sdk-token', actions: { daFetch: rejectDaFetch },
  });
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'request-42' },
    body: JSON.stringify({ org: 'example', site: 'website', path: '/drafts/page' }),
    credentials: 'omit',
  };
  const href = 'https://worker.example.com/api/v2/requests';
  assert.equal(await panel.client.request(href, options), response);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], href);
  const sent = calls[0][1];
  assert.equal(sent.method, options.method);
  assert.equal(sent.body, options.body);
  assert.equal(sent.credentials, options.credentials);
  const headers = new Headers(sent.headers);
  assert.equal(headers.get('Authorization'), 'Bearer sdk-token');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.get('X-Request-ID'), 'request-42');
  assert.equal(options.headers.Authorization, undefined);
});

it('returns worker GET 401 responses without invoking either DA fetch', async () => {
  const response = { ok: false, status: 401 };
  const rejectDaFetch = () => assert.fail('Worker 401 must not invoke DA sign-in');
  const makePanel = loadPanel({
    daFetch: rejectDaFetch,
    fetch: async (href, options) => {
      assert.equal(href, 'https://worker.example.com/api/v2/config');
      assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer sdk-token');
      return response;
    },
  });
  const panel = makePanel({ context: {}, token: 'sdk-token', actions: {} });
  assert.equal(await panel.client.request('https://worker.example.com/api/v2/config'), response);
});

it('retains host DA fetch for Admin preview and live calls', async () => {
  const calls = [];
  const makePanel = loadPanel({
    daFetch: () => assert.fail('Host DA fetch should take precedence for Admin'),
    fetch: () => assert.fail('Admin calls must not use plain worker fetch'),
    setImsDetails: (token) => assert.equal(token, 'sdk-token'),
  });
  const panel = makePanel({
    context: {},
    token: 'sdk-token',
    actions: { daFetch: async (...args) => calls.push(args) },
  });
  const page = {
    org: 'example', site: 'website', path: '/drafts/page', ref: 'main',
  };
  await panel.client.preview(page);
  await panel.client.publish(page);
  assert.equal(calls.length, 2);
  ['preview', 'live'].forEach((operation, index) => {
    assert.equal(new URL(calls[index][0]).origin, 'https://da-etc.adobeaem.workers.dev');
    assert.equal(
      new URL(calls[index][0]).searchParams.get('url'),
      `https://admin.hlx.page/${operation}/example/website/main/drafts/page`,
    );
    assert.equal(calls[index][1].method, 'POST');
  });
});
