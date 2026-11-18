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
import { isDraftsPath } from '../../../../../tools/apps/msm/helpers/api.js';

describe('isDraftsPath', () => {
  it('matches /drafts and anything below it', () => {
    assert.equal(isDraftsPath('/drafts'), true);
    assert.equal(isDraftsPath('/drafts/a/b'), true);
  });
  it('does not match other paths', () => {
    assert.equal(isDraftsPath('/draftsy'), false);
    assert.equal(isDraftsPath('/blog/drafts'), false);
    assert.equal(isDraftsPath('/'), false);
  });
});
