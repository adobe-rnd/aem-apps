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
import {
  buildHash, getSchemaEditorHref, isSameRoute, toRoute,
} from '../../../../../tools/apps/graphql/ui/utils/route.js';

describe('route', () => {
  it('parses hash details', () => {
    assert.equal(toRoute(null), undefined);
    assert.deepEqual(toRoute({ org: 'o', site: null, path: null }), { org: 'o' });
    assert.deepEqual(toRoute({ org: 'o', site: 's', path: null }), { org: 'o', site: 's' });
    assert.deepEqual(toRoute({ org: 'o', site: 's', path: 'endpoints' }), { org: 'o', site: 's' });
    assert.deepEqual(toRoute({ org: 'o', site: 's', path: 'endpoints/main' }), { org: 'o', site: 's', endpoint: 'main' });
  });

  it('falls back to the endpoint list for unknown sections', () => {
    assert.deepEqual(toRoute({ org: 'o', site: 's', path: 'main' }), { org: 'o', site: 's' });
    assert.deepEqual(toRoute({ org: 'o', site: 's', path: 'other/main' }), { org: 'o', site: 's' });
  });

  it('opens the endpoint list for unusable endpoint segments', () => {
    assert.deepEqual(toRoute({ org: 'o', site: 's', path: 'endpoints/a/b' }), { org: 'o', site: 's' });
    assert.deepEqual(toRoute({ org: 'o', site: 's', path: 'endpoints/Main' }), { org: 'o', site: 's' });
  });

  it('builds hashes and compares routes', () => {
    assert.equal(buildHash({ org: 'o', site: 's', endpoint: 'main' }), '#/o/s/endpoints/main');
    assert.equal(buildHash({ org: 'o', site: 's' }), '#/o/s/endpoints');
    assert.equal(buildHash({ org: 'o', endpoint: 'main' }), '#/o');
    assert.equal(buildHash({}), '');
    assert.equal(getSchemaEditorHref({ origin: 'https://da.live', org: 'o', site: 's' }), 'https://da.live/apps/schema#/o/s');
    assert.equal(isSameRoute({ route: { org: 'o', site: 's' }, other: { org: 'o', site: 's' } }), true);
    assert.equal(isSameRoute({
      route: { org: 'o', site: 's' }, other: { org: 'o', site: 's', endpoint: 'e' },
    }), false);
  });
});
