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
import { pacedAemApiFetch } from '../../../tools/shared/hlx6.js';

// Mocks Date ahead of real time, which leaves the module's pace in the
// future, so it runs in its own process (node --test runs each file alone).
describe('pacedAemApiFetch with late timers', () => {
  function recorder() {
    const starts = [];
    const fetchFn = async () => {
      starts.push(Date.now());
      return new Response(null, { status: 201 });
    };
    return { fetchFn, starts };
  }

  it('keeps requests apart when the timers fire late, as in a background tab', async (test) => {
    test.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() + 60000 });
    const { fetchFn, starts } = recorder();
    const flush = () => new Promise((resolve) => { setImmediate(resolve); });
    const sent = Promise.all([1, 2, 3].map(() => pacedAemApiFetch(fetchFn, 'u', {})));
    await flush();
    assert.equal(starts.length, 1);
    // A throttled tab runs both waiting timers together, a second late.
    test.mock.timers.tick(1000);
    await flush();
    assert.equal(starts.length, 2);
    test.mock.timers.tick(125);
    await flush();
    await sent;
    assert.deepEqual(starts.slice(1).map((start, index) => start - starts[index]), [1000, 125]);
  });
});
