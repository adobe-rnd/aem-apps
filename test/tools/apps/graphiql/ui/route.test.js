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
import { buildHash, toRoute } from '../../../../../tools/apps/graphiql/ui/utils/route.js';

describe('route', () => {
  it('reads #/{org}/{site}/{endpoint}', () => {
    assert.deepEqual(toRoute({ org: 'a', site: 'b', path: '/cards' }), { org: 'a', site: 'b', endpoint: 'cards' });
  });

  it('opens the site for an invalid endpoint name', () => {
    assert.deepEqual(toRoute({ org: 'a', site: 'b', path: '/Not_Valid' }), { org: 'a', site: 'b' });
  });

  it('builds the hash back', () => {
    assert.equal(buildHash({ org: 'a', site: 'b', endpoint: 'cards' }), '#/a/b/cards');
    assert.equal(buildHash({ org: 'a' }), '#/a');
  });
});
