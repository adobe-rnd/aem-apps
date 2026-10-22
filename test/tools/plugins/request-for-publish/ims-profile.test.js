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
import getImsProfileUrl from '../../../../tools/plugins/request-for-publish/ims-profile.js';

const PROD_URL = 'https://ims-na1.adobelogin.com/ims/profile/v1';
const STAGE_URL = 'https://ims-na1-stg1.adobelogin.com/ims/profile/v1';

function fakeJwt(payload) {
  const encode = (obj) => btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('getImsProfileUrl', () => {
  it('resolves the stage host for a stage token', () => {
    const token = fakeJwt({ as: 'ims-na1-stg1', sub: 'user' });
    assert.equal(getImsProfileUrl(token), STAGE_URL);
  });

  it('resolves the prod host for a prod token', () => {
    const token = fakeJwt({ as: 'ims-na1', sub: 'user' });
    assert.equal(getImsProfileUrl(token), PROD_URL);
  });

  it('falls back to the prod host for an undecodable token', () => {
    assert.equal(getImsProfileUrl('not-a-jwt'), PROD_URL);
    assert.equal(getImsProfileUrl('a.!!!not-base64!!!.c'), PROD_URL);
    assert.equal(getImsProfileUrl('a.bm90LWpzb24.c'), PROD_URL);
  });

  it('falls back to the prod host when the token has no `as` claim', () => {
    const token = fakeJwt({ sub: 'user' });
    assert.equal(getImsProfileUrl(token), PROD_URL);
  });

  it('falls back to the prod host for a malformed `as` claim', () => {
    assert.equal(getImsProfileUrl(fakeJwt({ as: 'evil.example.com/x' })), PROD_URL);
    assert.equal(getImsProfileUrl(fakeJwt({ as: 42 })), PROD_URL);
  });

  it('falls back to the prod host for a missing token', () => {
    assert.equal(getImsProfileUrl(undefined), PROD_URL);
    assert.equal(getImsProfileUrl(''), PROD_URL);
  });
});
