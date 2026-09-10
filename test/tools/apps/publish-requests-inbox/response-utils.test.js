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
import { requestsFromResponse, errorMessage } from '../../../../tools/apps/publish-requests-inbox/response-utils.js';

function resp({ status, ok = status >= 200 && status < 300, json }) {
  return { status, ok, json: async () => json };
}

describe('requestsFromResponse', () => {
  it('returns the requests array on a 200', async () => {
    const requests = await requestsFromResponse(resp({ status: 200, json: { requests: [{ path: '/a' }] } }));
    assert.equal(requests[0].path, '/a');
  });

  it('returns an empty array for a genuinely empty queue (200)', async () => {
    const requests = await requestsFromResponse(resp({ status: 200, json: { requests: [] } }));
    assert.deepEqual(requests, []);
  });

  it('throws on a transient failure (401) instead of returning empty', async () => {
    await assert.rejects(
      () => requestsFromResponse(resp({ status: 401, json: {} })),
      /401/,
    );
  });

  it('surfaces the worker error message when present', async () => {
    await assert.rejects(
      () => requestsFromResponse(resp({ status: 500, json: { error: 'Internal server error' } })),
      /Internal server error/,
    );
  });
});

describe('errorMessage', () => {
  it('prefers the worker error body', async () => {
    assert.equal(await errorMessage(resp({ status: 503, json: { error: 'boom' } }), 'fallback'), 'boom');
  });

  it('falls back to the status code when the body has no error', async () => {
    const msg = await errorMessage(resp({ status: 502, json: {} }), 'Couldn\'t load');
    assert.match(msg, /Couldn't load \(502\)/);
  });

  it('falls back when the body is not JSON', async () => {
    const bad = { status: 500, ok: false, json: async () => { throw new Error('not json'); } };
    const msg = await errorMessage(bad, 'Couldn\'t load');
    assert.match(msg, /500/);
  });
});
