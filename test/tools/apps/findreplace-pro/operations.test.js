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

const source = readFileSync(new URL('../../../../tools/apps/findreplace-pro/findreplace-pro.js', import.meta.url), 'utf8');
const operationsSource = source.slice(
  source.indexOf('async function handleSingleFileOperation('),
  source.indexOf('async function copySelectedUrlsFromBulk('),
);

async function runOperation(operation, paths, ref = 'feature') {
  const calls = [];
  const messages = [];
  const run = vm.runInNewContext(`${operationsSource}\nbulkOperation`, {
    API: {
      PREVIEW: 'https://admin.hlx.page/preview',
      LIVE: 'https://admin.hlx.page/live',
    },
    app: {
      context: { org: 'app-host', site: 'aem-apps', ref },
      token: 'test-sdk-token',
      results: paths.map((path) => ({ selected: true, file: { path } })),
    },
    document: { getElementById: () => ({ value: operation }) },
    validateOrgSite: () => true,
    parseOrgSite: () => ({ org: 'example', site: 'website' }),
    confirm: () => true,
    updateProgress: () => {},
    showMessage: (text, type) => messages.push({ text, type }),
    setTimeout: () => {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  await run();
  assert.ok(!messages.some(({ type }) => type === 'error'), JSON.stringify(messages));
  assert.equal(calls.length, operation === 'unpublish' ? paths.length : 1);
  calls.forEach(({ options }) => {
    assert.equal(options.headers.Authorization, ['Bearer', 'test-sdk-token'].join(' '));
  });
  return calls;
}

it('previews a full DA source path using the entered org/site, not SDK context', async () => {
  const [call] = await runOperation('preview', ['/example/website/drafts/test.html']);
  assert.equal(call.url, 'https://admin.hlx.page/preview/example/website/feature/drafts/test');
  assert.equal(call.options.method, 'POST');
});

it('sends site-relative paths in bulk preview and defaults a missing ref to main', async () => {
  const [call] = await runOperation('preview', [
    '/example/website/drafts/first.html',
    '/drafts/second.html',
  ], null);
  assert.equal(call.url, 'https://admin.hlx.page/preview/example/website/main/*');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body).paths, ['/drafts/first', '/drafts/second']);
});

it('publishes multiple files on main with normalized payload paths', async () => {
  const [call] = await runOperation('publish', [
    '/example/website/drafts/first.html',
    '/example/website/drafts/second.html',
  ]);
  assert.equal(call.url, 'https://admin.hlx.page/live/example/website/main/*');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), {
    forceUpdate: true,
    paths: ['/drafts/first', '/drafts/second'],
    delete: false,
  });
});

it('bulk unpublish preserves the target site and SDK token arguments', async () => {
  const calls = await runOperation('unpublish', [
    '/example/website/drafts/first.html',
    '/example/website/drafts/second.html',
  ]);
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://admin.hlx.page/live/example/website/main/drafts/first',
    'https://admin.hlx.page/live/example/website/main/drafts/second',
  ]);
  calls.forEach(({ options }) => assert.equal(options.method, 'DELETE'));
});
