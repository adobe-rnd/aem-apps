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
import { pingFetch, stubDaFetch } from '../../../fixtures/da-fetch-stub.js';

const PROXY = 'https://da-etc.adobeaem.workers.dev/cors';
const load = () => import('../../../../tools/plugins/request-for-publish/utils.js');

it('previews a legacy page through the proxied admin.hlx.page call', async (test) => {
  const { previewContent } = await load();
  test.mock.method(global, 'fetch', pingFetch(['org/hlx6-site']));
  const calls = stubDaFetch(() => new Response(null, { status: 200 }));
  assert.deepEqual(await previewContent('org', 'legacy-site', '/drafts/x'), { success: true });
  const target = 'https://admin.hlx.page/preview/org/legacy-site/main/drafts/x';
  assert.deepEqual(calls.map(({ url, opts }) => [url, opts.method]), [
    [`${PROXY}?url=${encodeURIComponent(target)}`, 'POST'],
  ]);
});

it('previews a Helix 6 page on api.aem.live', async (test) => {
  const { previewContent } = await load();
  test.mock.method(global, 'fetch', pingFetch(['org/hlx6-site']));
  const calls = stubDaFetch(() => new Response(null, { status: 200 }));
  assert.deepEqual(await previewContent('org', 'hlx6-site', 'drafts/x'), { success: true });
  assert.deepEqual(calls.map(({ url, opts }) => [url, opts.method]), [
    ['https://api.aem.live/org/sites/hlx6-site/preview/drafts/x', 'POST'],
  ]);
});
