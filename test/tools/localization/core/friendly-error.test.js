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
import friendlyError, { SESSION_EXPIRED } from '../../../../tools/localization/core/friendly-error.js';

describe('friendlyError', () => {
  it('turns the da-nx missing IMS client id error into a session message', () => {
    assert.equal(friendlyError(new Error('Missing IMS Client ID')), SESSION_EXPIRED);
    assert.equal(friendlyError('missing ims client id'), SESSION_EXPIRED);
  });

  it('turns a 401 into a session message', () => {
    assert.equal(friendlyError({ status: 401, message: 'nope' }), SESSION_EXPIRED);
  });

  it('keeps other messages and falls back to a string', () => {
    assert.equal(friendlyError(new Error('boom')), 'boom');
    assert.equal(friendlyError('plain'), 'plain');
    assert.equal(friendlyError({}), '[object Object]');
  });
});
