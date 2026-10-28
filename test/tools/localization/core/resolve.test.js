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
import { parseConfig } from '../../../../tools/localization/core/config.js';
import {
  findLocation,
  sourcePage,
  sourceChain,
  targetPages,
  targetLocations,
  equivalentSites,
} from '../../../../tools/localization/core/resolve.js';

const loc = (site, path, language, source = '', actions = '') => ({
  site, path, language, source, actions,
});

// global:/en          en-US   (root)
// ├── global:/uk      en-GB
// ├── global:/emea/en en
// │   └── global:/emea/es  es-ES
// │       └── brand-b:/es  es-ES
// └── brand-b:/       en-US
const m = parseConfig({
  org: [
    loc('global', '/en', 'en-US'),
    loc('global', '/uk', 'en-GB', '/en', 'link, rollout, translate'),
    loc('global', '/emea/en', 'en', '/en', 'link, rollout'),
    loc('global', '/emea/es', 'es-ES', '/emea/en', 'rollout, translate'),
    loc('brand-b', '/es', 'es-ES', 'global:/emea/es', 'link, rollout'),
    loc('brand-b', '/', 'en-US', 'global:/en', 'link, rollout'),
  ],
  sites: {},
});

// global:/            en (root)
// ├── global:/emea/en en   (nested inside its own source)
// └── brand-b:/       en
const nested = parseConfig({
  org: [
    loc('global', '/', 'en'),
    loc('global', '/emea/en', 'en', '/'),
    loc('brand-b', '/', 'en', 'global:/'),
  ],
  sites: {},
});

const ref = (r) => r && `${r.site}:${r.path}@${r.location.id}`;
const refs = (list) => list.map(ref);

describe('findLocation', () => {
  it('finds the deepest containing location', () => {
    assert.equal(findLocation(m, 'global', '/emea/es/products/x.html').id, 'global:/emea/es');
    assert.equal(findLocation(m, 'brand-b', '/es/x').id, 'brand-b:/es');
  });

  it('matches the location folder itself', () => {
    assert.equal(findLocation(m, 'global', '/emea/es').id, 'global:/emea/es');
  });

  it('matches a whole-site location', () => {
    assert.equal(findLocation(m, 'brand-b', '/about').id, 'brand-b:/');
    assert.equal(findLocation(m, 'brand-b', '/').id, 'brand-b:/');
  });

  it('does not match a sibling that shares a prefix', () => {
    assert.equal(findLocation(m, 'global', '/english/x'), null);
    assert.equal(findLocation(m, 'global', '/en.html'), null);
  });

  it('returns null outside any location', () => {
    assert.equal(findLocation(m, 'global', '/fr/x'), null);
    assert.equal(findLocation(m, 'other', '/en/x'), null);
  });

  it('excludes dot-folders anywhere in the path', () => {
    assert.equal(findLocation(m, 'global', '/en/.da/x.json'), null);
    assert.equal(findLocation(m, 'brand-b', '/.trash/x'), null);
    assert.equal(findLocation(m, 'brand-b', '/.snapshots/s1/x'), null);
  });

  it('returns invalid locations too', () => {
    const bad = parseConfig({ org: [loc('global', '/en', 'nope')], sites: {} });
    assert.equal(findLocation(bad, 'global', '/en/x').valid, false);
  });
});

describe('sourcePage', () => {
  it('maps to the same relative path in the source location', () => {
    assert.equal(ref(sourcePage(m, 'global', '/uk/products/x')), 'global:/en/products/x@global:/en');
  });

  it('maps across sites and from a whole-site location', () => {
    assert.equal(ref(sourcePage(m, 'brand-b', '/about')), 'global:/en/about@global:/en');
    assert.equal(ref(sourcePage(m, 'brand-b', '/es/x')), 'global:/emea/es/x@global:/emea/es');
  });

  it('maps the location folder itself', () => {
    assert.equal(ref(sourcePage(m, 'brand-b', '/')), 'global:/en@global:/en');
    assert.equal(ref(sourcePage(m, 'global', '/uk')), 'global:/en@global:/en');
  });

  it('maps into a whole-site source', () => {
    assert.equal(ref(sourcePage(nested, 'brand-b', '/x')), 'global:/x@global:/');
    assert.equal(ref(sourcePage(nested, 'global', '/emea/en/x')), 'global:/x@global:/');
  });

  it('returns null for root locations and unlocated pages', () => {
    assert.equal(sourcePage(m, 'global', '/en/x'), null);
    assert.equal(sourcePage(m, 'global', '/fr/x'), null);
  });

  it('returns null when the mapped path belongs to a nested location', () => {
    assert.equal(sourcePage(nested, 'brand-b', '/emea/en/x'), null);
  });

  it('returns null when the source location is missing', () => {
    const partial = parseConfig({
      org: null,
      sites: { global: [{ path: '/uk', language: 'en-GB', source: '/en' }] },
    });
    assert.equal(sourcePage(partial, 'global', '/uk/x'), null);
  });
});

describe('sourceChain', () => {
  it('starts with the page itself and ends at the root page', () => {
    assert.deepEqual(refs(sourceChain(m, 'brand-b', '/es/x')), [
      'brand-b:/es/x@brand-b:/es',
      'global:/emea/es/x@global:/emea/es',
      'global:/emea/en/x@global:/emea/en',
      'global:/en/x@global:/en',
    ]);
  });

  it('is just the page for a root page', () => {
    assert.deepEqual(refs(sourceChain(m, 'global', '/en/x')), ['global:/en/x@global:/en']);
  });

  it('is empty outside any location', () => {
    assert.deepEqual(sourceChain(m, 'global', '/fr/x'), []);
  });

  it('stops on cycles', () => {
    const cyclic = parseConfig({
      org: [loc('global', '/a', 'en', '/b'), loc('global', '/b', 'en', '/a')],
      sites: {},
    });
    assert.deepEqual(refs(sourceChain(cyclic, 'global', '/a/x')), [
      'global:/a/x@global:/a',
      'global:/b/x@global:/b',
    ]);
  });
});

describe('targetPages', () => {
  it('returns direct target pages only, excluding self', () => {
    assert.deepEqual(refs(targetPages(m, 'global', '/en/x')), [
      'global:/uk/x@global:/uk',
      'global:/emea/en/x@global:/emea/en',
      'brand-b:/x@brand-b:/',
    ]);
    assert.deepEqual(refs(targetPages(m, 'global', '/emea/es/x')), ['brand-b:/es/x@brand-b:/es']);
  });

  it('maps the location folder itself', () => {
    assert.deepEqual(refs(targetPages(m, 'global', '/emea/es')), ['brand-b:/es@brand-b:/es']);
  });

  it('skips targets whose mapped path belongs to a nested location', () => {
    assert.deepEqual(refs(targetPages(m, 'global', '/en/es/x')), [
      'global:/uk/es/x@global:/uk',
      'global:/emea/en/es/x@global:/emea/en',
    ]);
  });

  it('maps a whole-site source into a nested target', () => {
    assert.deepEqual(refs(targetPages(nested, 'global', '/x')), [
      'global:/emea/en/x@global:/emea/en',
      'brand-b:/x@brand-b:/',
    ]);
  });

  it('is empty for leaves and unlocated pages', () => {
    assert.deepEqual(targetPages(m, 'brand-b', '/es/x'), []);
    assert.deepEqual(targetPages(m, 'global', '/fr/x'), []);
  });
});

describe('targetLocations', () => {
  it('returns direct targets only', () => {
    assert.deepEqual(targetLocations(m, 'global:/en').map((l) => l.id), [
      'global:/uk', 'global:/emea/en', 'brand-b:/',
    ]);
    assert.deepEqual(targetLocations(m, 'brand-b:/es'), []);
  });
});

describe('equivalentSites', () => {
  it('includes every configured site', () => {
    assert.deepEqual(equivalentSites(m), new Set(['global', 'brand-b']));
  });

  it('adds sites from legacy hostnames', () => {
    assert.deepEqual(
      equivalentSites(m, ['main--brand-c--acme.aem.page', ' main--Global--acme.aem.live ', 'bogus']),
      new Set(['global', 'brand-b', 'brand-c']),
    );
  });
});
