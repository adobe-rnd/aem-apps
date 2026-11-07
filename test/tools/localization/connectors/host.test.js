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
import { createTranslateProxy, DA_TRANSLATE_ORIGIN } from '../../../../tools/localization/connectors/host.js';
import { DA_TRANSLATE } from '../../../../tools/localization/connectors/google/index.js';

const URL_OK = `${DA_TRANSLATE_ORIGIN}/translate/google/acme/web`;

describe('createTranslateProxy', () => {
  it('matches the connector default origin', () => {
    assert.equal(DA_TRANSLATE_ORIGIN, DA_TRANSLATE);
  });

  it('posts plain-object bodies as FormData and returns plain data', async () => {
    const calls = [];
    const fetch = async (url, opts) => {
      calls.push({ url, opts });
      return new Response('{"translated":"<p>Salut</p>"}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const proxy = createTranslateProxy({ fetch });
    const result = await proxy({
      url: URL_OK, method: 'POST', headers: {}, body: { data: '<p>Hi</p>', fromlang: 'en', tolang: 'fr' },
    });
    assert.deepEqual(structuredClone(result), result);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { translated: '<p>Salut</p>' });
    assert.equal(result.headers['content-type'], 'application/json');
    assert.equal(calls[0].url, URL_OK);
    assert.ok(calls[0].opts.body instanceof FormData);
    assert.equal(calls[0].opts.body.get('data'), '<p>Hi</p>');
    assert.equal(calls[0].opts.body.get('fromlang'), 'en');
    assert.equal(calls[0].opts.body.get('tolang'), 'fr');
  });

  it('returns text bodies as strings and passes string bodies through', async () => {
    let seen;
    const fetch = async (url, opts) => {
      seen = opts.body;
      return new Response('nope', { status: 500 });
    };
    const result = await createTranslateProxy({ fetch })({ url: URL_OK, body: 'raw' });
    assert.equal(seen, 'raw');
    assert.equal(result.status, 500);
    assert.equal(result.body, 'nope');
  });

  it('rejects other origins and reports network failures as data', async () => {
    let called = false;
    const proxy = createTranslateProxy({ fetch: async () => { called = true; throw new Error('down'); } });
    const blocked = await proxy({ url: 'https://admin.da.live/source/acme/web/x.html' });
    assert.equal(blocked.error.code, 'not-allowed');
    assert.equal(called, false);
    const down = await proxy({ url: URL_OK, body: {} });
    assert.deepEqual(down, {
      status: 0, headers: {}, body: null, error: { code: 'network', message: 'down', retryable: true },
    });
    assert.equal((await createTranslateProxy({ origin: 'http://localhost:8788' })({ url: 'http://localhost:8788/x' })).error.code, 'not-connected');
  });
});
