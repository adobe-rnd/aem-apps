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
import { configFromLocationRows, locationRow } from '../helpers.js';
import {
  findLocation,
  sourcePage,
  sourceChain,
  targetPages,
  targetLocations,
  equivalentSites,
} from '../../../../../tools/localization/core/domain/resolve.js';

// global:/en          en-US   (root)
// ├── global:/uk      en-GB
// ├── global:/emea/en en
// │   └── global:/emea/es  es-ES
// │       └── brand-b:/es  es-ES
// └── brand-b:/       en-US
const model = configFromLocationRows([
  locationRow('global', '/en', 'en-US'),
  locationRow('global', '/uk', 'en-GB', '/en', 'link, rollout, translate'),
  locationRow('global', '/emea/en', 'en', '/en', 'link, rollout'),
  locationRow('global', '/emea/es', 'es-ES', '/emea/en', 'rollout, translate'),
  locationRow('brand-b', '/es', 'es-ES', 'global:/emea/es', 'link, rollout'),
  locationRow('brand-b', '/', 'en-US', 'global:/en', 'link, rollout'),
]);

// global:/            en (root)
// ├── global:/emea/en en   (nested inside its own source)
// └── brand-b:/       en
const nested = configFromLocationRows([
  locationRow('global', '/', 'en'),
  locationRow('global', '/emea/en', 'en', '/'),
  locationRow('brand-b', '/', 'en', 'global:/'),
]);

const describeRef = (pageRef) => pageRef && `${pageRef.site}:${pageRef.path}@${pageRef.location.id}`;
const describeRefs = (pageRefs) => pageRefs.map(describeRef);

describe('findLocation', () => {
  it('finds the deepest containing location', () => {
    assert.equal(findLocation(model, 'global', '/emea/es/products/x.html').id, 'global:/emea/es');
    assert.equal(findLocation(model, 'brand-b', '/es/x').id, 'brand-b:/es');
  });

  it('matches the location folder itself', () => {
    assert.equal(findLocation(model, 'global', '/emea/es').id, 'global:/emea/es');
  });

  it('matches a whole-site location', () => {
    assert.equal(findLocation(model, 'brand-b', '/about').id, 'brand-b:/');
    assert.equal(findLocation(model, 'brand-b', '/').id, 'brand-b:/');
  });

  it('does not match a sibling that shares a prefix', () => {
    assert.equal(findLocation(model, 'global', '/english/x'), null);
    assert.equal(findLocation(model, 'global', '/en.html'), null);
  });

  it('returns null outside any location', () => {
    assert.equal(findLocation(model, 'global', '/fr/x'), null);
    assert.equal(findLocation(model, 'other', '/en/x'), null);
  });

  it('excludes dot-folders anywhere in the path', () => {
    assert.equal(findLocation(model, 'global', '/en/.da/x.json'), null);
    assert.equal(findLocation(model, 'brand-b', '/.trash/x'), null);
    assert.equal(findLocation(model, 'brand-b', '/.snapshots/s1/x'), null);
  });

  it('returns invalid locations too', () => {
    const invalidModel = configFromLocationRows([locationRow('global', '/en', 'nope')]);
    assert.equal(findLocation(invalidModel, 'global', '/en/x').valid, false);
  });
});

describe('sourcePage', () => {
  it('maps to the same relative path in the source location', () => {
    assert.equal(describeRef(sourcePage(model, 'global', '/uk/products/x')), 'global:/en/products/x@global:/en');
  });

  it('maps across sites and from a whole-site location', () => {
    assert.equal(describeRef(sourcePage(model, 'brand-b', '/about')), 'global:/en/about@global:/en');
    assert.equal(describeRef(sourcePage(model, 'brand-b', '/es/x')), 'global:/emea/es/x@global:/emea/es');
  });

  it('maps the location folder itself', () => {
    assert.equal(describeRef(sourcePage(model, 'brand-b', '/')), 'global:/en@global:/en');
    assert.equal(describeRef(sourcePage(model, 'global', '/uk')), 'global:/en@global:/en');
  });

  it('maps into a whole-site source', () => {
    assert.equal(describeRef(sourcePage(nested, 'brand-b', '/x')), 'global:/x@global:/');
    assert.equal(describeRef(sourcePage(nested, 'global', '/emea/en/x')), 'global:/x@global:/');
  });

  it('returns null for root locations and unlocated pages', () => {
    assert.equal(sourcePage(model, 'global', '/en/x'), null);
    assert.equal(sourcePage(model, 'global', '/fr/x'), null);
  });

  it('returns null when the mapped path belongs to a nested location', () => {
    assert.equal(sourcePage(nested, 'brand-b', '/emea/en/x'), null);
  });

  it('returns null when the source location is missing', () => {
    const partial = configFromLocationRows([locationRow('global', '/uk', 'en-GB', 'other:/en')]);
    assert.equal(sourcePage(partial, 'global', '/uk/x'), null);
  });
});

describe('sourceChain', () => {
  it('starts with the page itself and ends at the root page', () => {
    assert.deepEqual(describeRefs(sourceChain(model, 'brand-b', '/es/x')), [
      'brand-b:/es/x@brand-b:/es',
      'global:/emea/es/x@global:/emea/es',
      'global:/emea/en/x@global:/emea/en',
      'global:/en/x@global:/en',
    ]);
  });

  it('is just the page for a root page', () => {
    assert.deepEqual(describeRefs(sourceChain(model, 'global', '/en/x')), ['global:/en/x@global:/en']);
  });

  it('is empty outside any location', () => {
    assert.deepEqual(sourceChain(model, 'global', '/fr/x'), []);
  });

  it('stops on cycles', () => {
    const cyclic = configFromLocationRows([
      locationRow('global', '/a', 'en', '/b'),
      locationRow('global', '/b', 'en', '/a'),
    ]);
    assert.deepEqual(describeRefs(sourceChain(cyclic, 'global', '/a/x')), [
      'global:/a/x@global:/a',
      'global:/b/x@global:/b',
    ]);
  });
});

describe('targetPages', () => {
  it('returns direct target pages only, excluding self', () => {
    assert.deepEqual(describeRefs(targetPages(model, 'global', '/en/x')), [
      'global:/uk/x@global:/uk',
      'global:/emea/en/x@global:/emea/en',
      'brand-b:/x@brand-b:/',
    ]);
    assert.deepEqual(describeRefs(targetPages(model, 'global', '/emea/es/x')), ['brand-b:/es/x@brand-b:/es']);
  });

  it('maps the location folder itself', () => {
    assert.deepEqual(describeRefs(targetPages(model, 'global', '/emea/es')), ['brand-b:/es@brand-b:/es']);
  });

  it('skips targets whose mapped path belongs to a nested location', () => {
    assert.deepEqual(describeRefs(targetPages(model, 'global', '/en/es/x')), [
      'global:/uk/es/x@global:/uk',
      'global:/emea/en/es/x@global:/emea/en',
    ]);
  });

  it('maps a whole-site source into a nested target', () => {
    assert.deepEqual(describeRefs(targetPages(nested, 'global', '/x')), [
      'global:/emea/en/x@global:/emea/en',
      'brand-b:/x@brand-b:/',
    ]);
  });

  it('is empty for leaves and unlocated pages', () => {
    assert.deepEqual(targetPages(model, 'brand-b', '/es/x'), []);
    assert.deepEqual(targetPages(model, 'global', '/fr/x'), []);
  });

  it('excludes self for a self-sourced location', () => {
    const selfSourced = configFromLocationRows([locationRow('global', '/en', 'en', '/en')]);
    assert.deepEqual(targetPages(selfSourced, 'global', '/en/x'), []);
  });
});

describe('targetLocations', () => {
  it('returns direct targets only', () => {
    assert.deepEqual(targetLocations(model, 'global:/en').map((location) => location.id), [
      'global:/uk', 'global:/emea/en', 'brand-b:/',
    ]);
    assert.deepEqual(targetLocations(model, 'brand-b:/es'), []);
  });
});

describe('equivalentSites', () => {
  it('includes every configured site', () => {
    assert.deepEqual(equivalentSites(model), new Set(['global', 'brand-b']));
  });

  it('adds sites from legacy hostnames', () => {
    assert.deepEqual(
      equivalentSites(model, ['main--brand-c--acme.aem.page', ' main--Global--acme.aem.live ', 'bogus']),
      new Set(['global', 'brand-b', 'brand-c']),
    );
  });

  it('ignores hostnames that are not ref--site--org', () => {
    assert.deepEqual(
      equivalentSites(model, ['foo--unrelated.example', 'a--b--c--d.aem.page', '--x--y.aem.page', '']),
      new Set(['global', 'brand-b']),
    );
  });
});
