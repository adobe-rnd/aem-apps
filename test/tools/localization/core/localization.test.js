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
import { DOMParser } from 'linkedom';
import { createLocalization } from '../../../../tools/localization/core/index.js';

// global:/en  en-US (root)
// ├── global:/uk     en-GB  linked, link/rollout/translate
// └── brand-b:/es-en en-US  none, rollout   (cross-site)
//     └── brand-c:/x en-US  linked          (cross-site, two hops)
const CONFIGS = {
  global: [
    { path: '/en', language: 'en-US' },
    {
      path: '/uk', language: 'en-GB', source: '/en', actions: 'link, rollout, translate', missingPages: 'linked',
    },
  ],
  'brand-b': [
    { path: '/es-en', language: 'en-US', source: 'global:/en' },
  ],
  'brand-c': [
    {
      path: '/x', language: 'en-US', source: 'brand-b:/es-en', actions: 'link, rollout', missingPages: 'linked',
    },
  ],
  unrelated: [{ path: '/', language: 'fr' }],
};

function createFixture({
  configs = CONFIGS, pages = {}, indexes = {}, review = [], supports = true,
} = {}) {
  const calls = {
    config: [], pageInfo: [], needsReview: [], index: [], supports: [],
  };
  const providers = {
    config: {
      read: async (site) => {
        calls.config.push(site);
        return configs[site] ?? null;
      },
      listSites: async () => Object.keys(configs),
    },
    pageInfo: {
      get: async (site, path) => {
        calls.pageInfo.push(`${site}:${path}`);
        return pages[`${site}:${path}`] ?? { exists: false };
      },
      needsReview: async (site, path) => {
        calls.needsReview.push(`${site}:${path}`);
        return review.includes(`${site}:${path}`);
      },
    },
    index: {
      read: async (locationId) => {
        calls.index.push(locationId);
        return indexes[locationId] ?? { pages: {}, pending: {} };
      },
    },
  };
  const services = {
    translationConnectors: {
      supports: async (sourceLanguage, targetLanguage) => {
        calls.supports.push(`${sourceLanguage}>${targetLanguage}`);
        return supports;
      },
    },
  };
  return { providers, services, calls };
}

const file = (id, version) => ({ exists: true, id, version });
const base = (sourceId, sourceVersion, via = 'rollout') => ({ sourceId, sourceVersion, via });
const localizationFor = (fixture) => createLocalization({
  org: 'acme',
  providers: fixture.providers,
  services: fixture.services,
});
const actionNames = (result) => result.actions.map((entry) => entry.action);
const findAction = (result, name) => result.actions.find((entry) => entry.action === name);

describe('page: config loading', () => {
  it('loads only the page site for a root page', async () => {
    const fixture = createFixture({ pages: { 'global:/en/x': file('a', '1') } });
    const result = await localizationFor(fixture).page('global', '/en/x');
    assert.deepEqual(fixture.calls.config, ['global']);
    assert.equal(result.status.relationship, 'root');
  });

  it('walks up across sites, loading only sites in the chain', async () => {
    const fixture = createFixture({ pages: { 'global:/en/p': file('a', '1') } });
    const result = await localizationFor(fixture).page('brand-c', '/x/p');
    assert.deepEqual(fixture.calls.config, ['brand-c', 'brand-b', 'global']);
    assert.deepEqual(result.chain.map((entry) => `${entry.ref.site}:${entry.ref.path}`), [
      'brand-c:/x/p', 'brand-b:/es-en/p', 'global:/en/p',
    ]);
    assert.equal(result.location.id, 'brand-c:/x');
  });

  it('reports unknown when a source site config is unreadable', async () => {
    const fixture = createFixture({ configs: { ...CONFIGS, global: null } });
    const result = await localizationFor(fixture).page('brand-b', '/es-en/p');
    assert.equal(result.status.relationship, 'unknown');
    assert.deepEqual(result.actions, []);
  });

  it('returns an empty result outside any location', async () => {
    const result = await localizationFor(createFixture()).page('global', '/fr/x');
    assert.deepEqual(result, {
      location: null, chain: [], status: null, actions: [],
    });
  });

  it('discovers config ancestors through location sources past nested locations', async () => {
    const fixture = createFixture({
      configs: {
        a: [{ path: '/t', language: 'en', source: 'b:/s' }],
        b: [
          { path: '/s', language: 'en', source: 'c:/r' },
          { path: '/s/n', language: 'en' },
        ],
        c: [{ path: '/r', language: 'en' }],
      },
      pages: { 'a:/t/n/x': file('x', '1') },
    });
    const result = await localizationFor(fixture).page('a', '/t/n/x');
    assert.deepEqual(fixture.calls.config, ['a', 'b', 'c']);
    assert.equal(result.status.relationship, 'standalone');
  });
});

describe('page: page info', () => {
  it('combines page info and index entries keyed by page id', async () => {
    const fixture = createFixture({
      pages: { 'global:/en/x': file('a', '1'), 'global:/uk/x': file('b', '7') },
      indexes: { 'global:/uk': { pages: { b: { base: base('a', '1') } }, pending: {} } },
    });
    const result = await localizationFor(fixture).page('global', '/uk/x');
    assert.deepEqual(result.chain[0].info, {
      exists: true, id: 'b', version: '7', base: base('a', '1'), job: null, needsReview: false,
    });
    assert.equal(result.status.relationship, 'local copy');
    assert.deepEqual(result.status.sync, ['current']);
  });

  it('reads pending jobs by path for pages that do not exist yet', async () => {
    const fixture = createFixture({
      pages: { 'global:/en/x': file('a', '1') },
      indexes: { 'global:/uk': { pages: {}, pending: { '/uk/x': { job: { state: 'translating' } } } } },
    });
    const result = await localizationFor(fixture).page('global', '/uk/x');
    assert.equal(result.status.relationship, 'linked');
    assert.deepEqual(result.status.sync, ['translating']);
  });

  it('fetches needsReview only for the page and its effective source', async () => {
    const fixture = createFixture({
      configs: {
        ...CONFIGS,
        global: [
          ...CONFIGS.global,
          {
            path: '/ie', language: 'en-IE', source: '/uk', actions: 'rollout', missingPages: 'linked',
          },
        ],
      },
      pages: { 'global:/en/x': file('a', '1'), 'global:/ie/x': file('c', '1') },
      indexes: { 'global:/ie': { pages: { c: { base: base('a', '1') } }, pending: {} } },
      review: ['global:/en/x'],
    });
    const result = await localizationFor(fixture).page('global', '/ie/x');
    assert.deepEqual(fixture.calls.needsReview.sort(), ['global:/en/x', 'global:/ie/x']);
    assert.deepEqual(result.status.sync, ['blocked by source review', 'current']);
  });

  it('does not fetch needsReview for a page that does not exist', async () => {
    const fixture = createFixture({ pages: { 'global:/en/x': file('a', '1') } });
    await localizationFor(fixture).page('global', '/uk/x');
    assert.deepEqual(fixture.calls.needsReview, ['global:/en/x']);
  });
});

describe('page: actions', () => {
  it('derives available actions for the page', async () => {
    const fixture = createFixture({
      pages: { 'global:/en/x': file('a', '1'), 'global:/uk/x': file('b', '7') },
      indexes: { 'global:/uk': { pages: { b: { base: base('a', '1') } }, pending: {} } },
    });
    const result = await localizationFor(fixture).page('global', '/uk/x');
    assert.deepEqual(actionNames(result), ['rollout', 'translate', 'reconnect']);
  });

  it('asks the connector whether the language pair is supported', async () => {
    const fixture = createFixture({
      pages: { 'global:/en/x': file('a', '1'), 'global:/uk/x': file('b', '7') },
      supports: false,
    });
    const result = await localizationFor(fixture).page('global', '/uk/x');
    assert.deepEqual(fixture.calls.supports, ['en-US>en-GB']);
    assert.deepEqual(findAction(result, 'translate').reasons, ['connector-unsupported']);
  });

  it('disables translate when no connector service is configured', async () => {
    const fixture = createFixture({
      pages: { 'global:/en/x': file('a', '1'), 'global:/uk/x': file('b', '7') },
    });
    const localization = createLocalization({ org: 'acme', providers: fixture.providers });
    const result = await localization.page('global', '/uk/x');
    assert.deepEqual(findAction(result, 'translate').reasons, ['connector-unsupported']);
  });

  it('does not ask the connector when translate is not allowed', async () => {
    const fixture = createFixture({ pages: { 'global:/en/p': file('a', '1') } });
    await localizationFor(fixture).page('brand-c', '/x/p');
    assert.deepEqual(fixture.calls.supports, []);
  });
});

describe('page: caching', () => {
  it('builds default da-admin providers from SDK actions', async () => {
    const requests = [];
    const daFetch = async (url, options = {}) => {
      requests.push(`${options.method ?? 'GET'} ${url}`);
      if (url === 'https://admin.da.live/config/acme/global') {
        return new Response(JSON.stringify({ locations: { data: [{ path: '/en', language: 'en' }] } }));
      }
      if (url === 'https://admin.da.live/source/acme/global/en/x.html') {
        return new Response(options.method === 'HEAD' ? null : '<main></main>', {
          headers: { 'X-da-id': 'page-1', ETag: '"1"' },
        });
      }
      return new Response('', { status: 404 });
    };
    const localization = createLocalization({ org: 'acme', actions: { daFetch } });
    global.DOMParser = DOMParser;
    try {
      const result = await localization.page('global', '/en/x.html');
      assert.equal(result.status.relationship, 'root');
      assert.deepEqual(result.chain[0].info.id, 'page-1');
    } finally {
      delete global.DOMParser;
    }
    assert.ok(requests.includes('GET https://admin.da.live/source/acme/global/.da/loc/en/index.json'));
  });

  it('lets individual providers be overridden and honors a custom daOrigin', async () => {
    const fixture = createFixture({ pages: { 'global:/en/x': file('a', '1') } });
    const requests = [];
    const daFetch = async (url) => {
      requests.push(url);
      return new Response('', { status: 404 });
    };
    const localization = createLocalization({
      org: 'acme',
      actions: { daFetch },
      daOrigin: 'https://admin.example',
      providers: { config: fixture.providers.config, pageInfo: fixture.providers.pageInfo },
    });
    await localization.page('global', '/en/x');
    assert.deepEqual(requests, ['https://admin.example/source/acme/global/.da/loc/en/index.json']);
  });

  it('prefers an explicit api over actions.daFetch', async () => {
    const configRequests = [];
    const api = {
      isHlx6: async () => true,
      config: {
        get: async (target) => {
          configRequests.push(target);
          return new Response(JSON.stringify({ locations: { data: [{ path: '/en', language: 'en' }] } }));
        },
      },
      source: {
        getMetadata: async () => new Response(null, { status: 404 }),
        get: async () => new Response('', { status: 404 }),
      },
    };
    const daFetch = async () => { throw new Error('daFetch should not be used'); };
    const localization = createLocalization({ org: 'acme', api, actions: { daFetch } });
    await localization.page('global', '/en/x.html');
    assert.deepEqual(configRequests, [{ org: 'acme', site: 'global' }]);
  });

  it('requires SDK actions or every provider', () => {
    assert.throws(() => createLocalization({ org: 'acme' }), /daFetch|providers/);
  });

  it('reuses configs, page info and index reads until refresh', async () => {
    const fixture = createFixture({ pages: { 'global:/en/x': file('a', '1') } });
    const localization = localizationFor(fixture);
    await localization.page('global', '/uk/x');
    await localization.page('global', '/uk/x');
    assert.deepEqual(fixture.calls.config, ['global']);
    assert.deepEqual(fixture.calls.pageInfo, ['global:/uk/x', 'global:/en/x']);
    assert.deepEqual(fixture.calls.index, ['global:/uk', 'global:/en']);
    assert.equal(fixture.calls.needsReview.length, 1);

    localization.refresh();
    await localization.page('global', '/uk/x');
    assert.deepEqual(fixture.calls.config, ['global', 'global']);
    assert.equal(fixture.calls.pageInfo.length, 4);
  });

  it('does not let reads started before refresh leak into later calls', async () => {
    let releaseStaleRead;
    let isFirstRead = true;
    const fixture = createFixture({
      configs: { global: CONFIGS.global },
      pages: { 'global:/en/x': file('a', '1'), 'global:/uk/x': file('b', '7') },
      indexes: { 'global:/uk': { pages: { b: { base: base('a', '1') } }, pending: {} } },
    });
    const { read } = fixture.providers.config;
    fixture.providers.config.read = (site) => {
      if (!isFirstRead) return read(site);
      isFirstRead = false;
      return new Promise((resolve) => {
        releaseStaleRead = () => resolve([{ path: '/uk', language: 'en-GB' }]);
      });
    };
    const localization = localizationFor(fixture);
    const stalePage = localization.page('global', '/uk/x');
    localization.refresh();
    const freshPage = localization.page('global', '/uk/x');
    releaseStaleRead();
    await stalePage;
    assert.equal((await freshPage).status.relationship, 'local copy');
    assert.equal((await localization.page('global', '/uk/x')).status.relationship, 'local copy');
  });
});
