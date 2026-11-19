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

// api.js imports from da.live at load time, so the tests run the resend call in a VM.
const api = readFileSync(new URL('../../../../tools/apps/publish-requests-inbox/api.js', import.meta.url), 'utf8');
const source = api.slice(api.indexOf('// Request errors:'), api.indexOf('/**\n * Fetch the current user'))
  .replace(/^export /gm, '');

const REFUSED = 'One or more approver or CC email domains are not allowed for this org';

function resend(status, body) {
  const { resendPublishRequest } = vm.runInNewContext(`${source}; ({ resendPublishRequest })`, {
    getWorkerUrl: () => 'https://publish-requests-ci.aem-poc-lab.workers.dev',
    getOpts: () => ({}),
    fetch: async () => Response.json(body, { status }),
    console: { error: () => {} },
    Array,
  });
  return resendPublishRequest('example', 'website', '/page', 'author@example.com', 'token');
}

describe('v1 inbox resend and the recipient-domain refusal (publish-requests-worker#41)', () => {
  it('shows the 403 as a recipient-domain problem with the setup hint', async () => {
    const result = await resend(403, { error: REFUSED });
    assert.equal(result.success, false);
    assert.match(result.error, /^Some approver or CC email domains aren't allowed for this site\./);
    assert.match(result.error, /config admin can allow them under Registration in the Request Publish setup app/);
    assert.doesNotMatch(result.error, /not registered/i);
  });

  it('names the domains when the worker sends them', async () => {
    const result = await resend(403, { error: REFUSED, domains: ['example.org'] });
    assert.match(result.error, /these approver or CC email domains aren't allowed for this site: example\.org\./i);
  });

  it('keeps other failures and success as before', async () => {
    assert.equal((await resend(400, { error: 'No pending request found for /page.' })).error, 'No pending request found for /page.');
    assert.equal((await resend(200, { notifiedApprovers: [] })).success, true);
  });
});
