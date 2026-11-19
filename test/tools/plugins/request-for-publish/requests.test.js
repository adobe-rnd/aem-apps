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
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// utils.js imports from da.live at load time, so the tests run the request calls in a VM.
const utils = readFileSync(new URL('../../../../tools/plugins/request-for-publish/utils.js', import.meta.url), 'utf8');
const source = utils.slice(utils.indexOf('// Request errors:'), utils.indexOf('/**\n * Withdraw'))
  .replace(/^export /gm, '');

const REFUSED = 'One or more approver or CC email domains are not allowed for this org';

function client(status, body) {
  const calls = [];
  const api = vm.runInNewContext(`${source}; ({ submitPublishRequest, resendPublishRequest })`, {
    getWorkerUrl: () => 'https://publish-requests-ci.aem-poc-lab.workers.dev',
    getOpts: (token, method, payload) => ({ method, body: JSON.stringify(payload) }),
    fetch: async (href, opts) => {
      calls.push({ href, body: JSON.parse(opts.body) });
      return Response.json(body, { status });
    },
    console: { error: () => {} },
    JSON,
    Array,
  });
  return { api, calls };
}

const request = { org: 'example', site: 'website', path: '/page' };

describe('v1 plugin and the recipient-domain refusal (publish-requests-worker#41)', () => {
  ['submitPublishRequest', 'resendPublishRequest'].forEach((name) => {
    it(`${name} shows the 403 as a recipient-domain problem with the setup hint`, async () => {
      const { api } = client(403, { error: REFUSED });
      const result = await api[name](request, 'token');
      assert.equal(result.success, false);
      assert.match(result.message, /^Some approver or CC email domains aren't allowed for this site\./);
      assert.match(result.message, /config admin can allow them under Registration in the Request Publish setup app/);
      assert.doesNotMatch(result.message, /not registered/i);
    });

    it(`${name} names the domains when the worker sends them`, async () => {
      const { api } = client(403, { error: REFUSED, code: 'recipient-domain-not-allowed', domains: ['example.org', 'b.example'] });
      const result = await api[name](request, 'token');
      assert.match(result.message, /these approver or CC email domains aren't allowed for this site: example\.org, b\.example\./i);
    });

    it(`${name} keeps other errors as the worker's text`, async () => {
      const { api } = client(403, { error: 'example/website is not registered for publish workflow' });
      assert.equal((await api[name](request, 'token')).message, 'example/website is not registered for publish workflow');
      const other = client(400, { error: 'A pending request already exists for /page.' });
      assert.equal((await other.api[name](request, 'token')).message, 'A pending request already exists for /page.');
    });
  });

  it('sends the same request bodies as before', async () => {
    const { api, calls } = client(200, { notifiedApprovers: ['a@example.com'] });
    await api.submitPublishRequest({ ...request, comment: 'Note' }, 'token');
    await api.resendPublishRequest(request, 'token');
    assert.deepEqual(calls.map((c) => c.body), [
      { ...request, comment: 'Note' },
      { ...request, resend: true },
    ]);
  });
});
