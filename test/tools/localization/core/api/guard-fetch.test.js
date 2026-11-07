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
 */import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import guardFetch from '../../../../../tools/localization/core/api/guard-fetch.js';
import friendlyError, { SESSION_EXPIRED } from '../../../../../tools/localization/core/friendly-error.js';

const failing = async () => { throw new Error('Missing IMS Client ID'); };

describe('guardFetch', () => {
  it('passes responses and unrelated errors through', async () => {
    const response = new Response('ok');
    assert.equal(await guardFetch(async () => response)('https://a.test/x'), response);
    const boom = new Error('boom');
    await assert.rejects(guardFetch(async () => { throw boom; })('https://a.test/x'), (e) => e === boom);
  });

  it('turns a missing IMS client id into a 401 naming the request without query or headers', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const guarded = guardFetch(failing);
    await assert.rejects(
      guarded('https://admin.da.live/source/acme/site/en/x.html?token=secret', { method: 'post', headers: { authorization: 'Bearer abc' } }),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.url, 'https://admin.da.live/source/acme/site/en/x.html');
        assert.equal(error.message, 'Request not authorized (401): POST admin.da.live/source/acme/site/en/x.html');
        assert.equal(friendlyError(error), SESSION_EXPIRED);
        assert.ok(!JSON.stringify([error.message, error.url]).includes('secret'));
        return true;
      },
    );
    assert.equal(warn.mock.callCount(), 1);
    assert.ok(!String(warn.mock.calls[0].arguments[0]).includes('secret'));
    assert.match(String(warn.mock.calls[0].arguments[0]), /admin\.da\.live\/source\/acme\/site\/en\/x\.html/);
  });

  it('warns once per URL', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const guarded = guardFetch(failing);
    await assert.rejects(guarded('https://a.test/one'));
    await assert.rejects(guarded('https://a.test/one?x=1'));
    await assert.rejects(guarded('https://a.test/two'));
    assert.equal(warn.mock.callCount(), 2);
  });

  it('leaves non-functions alone', () => {
    assert.equal(guardFetch(undefined), undefined);
  });
});
