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
import createRealLocalization, { createConnectors } from '../../../../tools/plugins/msm-next/real-localization.js';

const daFetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });

describe('real localization', () => {
  it('builds the google connector over the DA translate proxy', async () => {
    const { connectors, error } = await createConnectors({ daFetch, simulatedDelayMs: 100 });
    assert.equal(error, undefined);
    assert.equal(connectors.describe.name, 'google');
    assert.equal(await connectors.supports('en', 'fr'), true);
  });

  it('reports connector errors instead of failing', async () => {
    const { connectors, error } = await createConnectors({ daFetch, name: 'nope' });
    assert.equal(connectors, undefined);
    assert.equal(error, 'Unknown connector: nope');
  });

  it('creates the facade with translation wired in', async () => {
    const localization = await createRealLocalization({ org: 'o', actions: { daFetch } });
    assert.equal(localization.translationError, null);
    assert.equal(typeof localization.page, 'function');
    assert.equal(typeof localization.checkJobs, 'function');
  });
});
