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
import { createTranslationConnectors, loadConnector } from '../../../../tools/localization/connectors/index.js';
import { createLocalization } from '../../../../tools/localization/core/index.js';

describe('connector registry', () => {
  it('loads google and nothing else', async () => {
    assert.equal(typeof (await loadConnector('google')).send, 'function');
    assert.equal(await loadConnector('nope'), null);
    const missing = await createTranslationConnectors({ name: 'nope' });
    assert.equal(missing.error.code, 'not-found');
  });

  it('exposes boolean supports and passes declared host services', async () => {
    const seen = [];
    const translateProxy = async (request) => {
      seen.push(request);
      return { status: 200, headers: {}, body: { translated: 'ok' } };
    };
    const connectors = await createTranslationConnectors({
      name: 'google', settings: {}, host: { translateProxy, integrationToken: async () => ({}) },
    });
    assert.equal(connectors.describe.name, 'google');
    assert.equal(await connectors.supports('en-US', 'fr-FR'), true);
    assert.equal(await connectors.supports('en-US', 'en-US'), false);
    assert.equal(await connectors.supports('en-US', 'xx'), false);
    const { jobState } = await connectors.call('send', {
      job: {
        title: 't', org: 'acme', site: 'web', src: 'en', dests: ['de'], options: {},
      },
      items: [{
        id: 'a', path: '/a.html', format: 'html', content: '<p>Hi</p>',
      }],
    });
    const results = await connectors.call('getResults', { jobState, lang: 'de' });
    assert.deepEqual(results.items, [{ id: 'a', content: 'ok' }]);
    assert.equal(seen.length, 1);
  });

  it('plugs into the core as services.translationConnectors', async () => {
    const translationConnectors = await createTranslationConnectors({ name: 'google' });
    const localization = createLocalization({
      org: 'acme',
      providers: {
        config: { listSites: async () => [], read: async () => [] },
        pageInfo: {
          get: async () => ({ exists: false }),
          needsReview: async () => false,
          list: async () => [],
        },
        index: { read: async () => ({ pages: {}, pending: {} }) },
      },
      services: { translationConnectors },
    });
    assert.equal(typeof localization.page, 'function');
  });
});
