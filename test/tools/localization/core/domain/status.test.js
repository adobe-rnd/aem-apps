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
import { sourceChain } from '../../../../../tools/localization/core/domain/resolve.js';
import { pageStatus } from '../../../../../tools/localization/core/domain/status.js';

// global:/en  en-US (root)
// ├── global:/uk  en-GB  linked
// │   └── global:/ie  en-IE  linked
// ├── global:/es  es     none
// │   └── global:/mx  es-MX  linked
// └── global:/bad (invalid language)
const model = configFromLocationRows([
  locationRow('global', '/en', 'en-US'),
  locationRow('global', '/uk', 'en-GB', '/en', 'link, rollout, translate', 'linked'),
  locationRow('global', '/ie', 'en-IE', '/uk', 'link, rollout', 'linked'),
  locationRow('global', '/es', 'es', '/en', 'rollout, translate', 'none'),
  locationRow('global', '/mx', 'es-MX', '/es', 'link, rollout', 'linked'),
  locationRow('global', '/bad', 'nope', '/en'),
]);

const file = (id, version, extra = {}) => ({
  exists: true, id, version, ...extra,
});

const statusOf = (path, infoByPath = {}, configModel = model, site = 'global') => pageStatus(
  sourceChain(configModel, site, path).map((ref) => ({ ref, info: infoByPath[ref.path] })),
);

const summary = (result) => result && { relationship: result.relationship, sync: result.sync };

describe('pageStatus: no page', () => {
  it('is null outside any location', () => {
    assert.equal(statusOf('/fr/x'), null);
  });

  it('is null for a missing root page', () => {
    assert.equal(statusOf('/en/x'), null);
  });

  it('is null when nothing above has content', () => {
    assert.equal(statusOf('/uk/x'), null);
    assert.equal(statusOf('/es/x'), null);
  });
});

describe('pageStatus: config', () => {
  it('reports config error for an invalid location', () => {
    const result = statusOf('/bad/x', { '/en/x': file('a', '1') });
    assert.deepEqual(summary(result), { relationship: 'config error', sync: [] });
    assert.deepEqual(result.reasons, ['invalid-location']);
  });

  it('reports unknown for an unresolved location', () => {
    const partial = configFromLocationRows([locationRow('global', '/uk', 'en-GB', 'other:/en')]);
    const result = statusOf('/uk/x', { '/uk/x': file('b', '1') }, partial);
    assert.deepEqual(summary(result), { relationship: 'unknown', sync: [] });
    assert.deepEqual(result.reasons, ['unresolved-location']);
  });
});

describe('pageStatus: root', () => {
  it('is root when the file exists', () => {
    assert.deepEqual(summary(statusOf('/en/x', { '/en/x': file('a', '1') })), { relationship: 'root', sync: [] });
  });
});

describe('pageStatus: missing pages', () => {
  it('is inherited when the source has content', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1') });
    assert.deepEqual(summary(result), { relationship: 'inherited', sync: [] });
    assert.equal(result.effectiveSource.path, '/en/x');
  });

  it('is inherited through inherited hops', () => {
    const result = statusOf('/ie/x', { '/en/x': file('a', '1') });
    assert.deepEqual(summary(result), { relationship: 'inherited', sync: [] });
    assert.equal(result.effectiveSource.path, '/en/x');
  });

  it('is not created when own location is none and the source has content', () => {
    assert.deepEqual(
      summary(statusOf('/es/x', { '/en/x': file('a', '1') })),
      { relationship: 'not created', sync: [] },
    );
  });

  it('is unavailable when a none hop above has no page', () => {
    const result = statusOf('/mx/x', { '/en/x': file('a', '1') });
    assert.deepEqual(summary(result), { relationship: 'unavailable', sync: [] });
    assert.equal(result.effectiveSource, null);
  });

  it('inherits from a none-location page that exists', () => {
    const result = statusOf('/mx/x', { '/en/x': file('a', '1'), '/es/x': file('e', '1') });
    assert.deepEqual(summary(result), { relationship: 'inherited', sync: [] });
    assert.equal(result.effectiveSource.path, '/es/x');
  });

  it('shows blocked by source review on an inherited page', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1', { needsReview: true }) });
    assert.deepEqual(summary(result), { relationship: 'inherited', sync: ['blocked by source review'] });
  });

  it('is inherited when a not created page was linked explicitly', () => {
    const result = statusOf('/es/x', {
      '/en/x': file('a', '1'),
      '/es/x': { exists: false, linked: true },
    });
    assert.deepEqual(summary(result), { relationship: 'inherited', sync: [] });
  });

  it('flags an inherited page that is not live', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1'), '/uk/x': { exists: false, published: { live: false, preview: true } } });
    assert.deepEqual(summary(result), { relationship: 'inherited', sync: ['not published'] });
    assert.deepEqual(result.reasons, []);
  });

  it('notes when an unpublished inherited page is not previewed either', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1'), '/uk/x': { exists: false, published: { live: false, preview: false } } });
    assert.deepEqual(result.reasons, ['not-previewed']);
  });

  it('does not flag live or unknown publish state', () => {
    const source = { '/en/x': file('a', '1') };
    const live = statusOf('/uk/x', { ...source, '/uk/x': { exists: false, published: { live: true, preview: true } } });
    const unknown = statusOf('/uk/x', { ...source, '/uk/x': { exists: false, published: { live: null, preview: null } } });
    assert.deepEqual(live.sync, []);
    assert.deepEqual(unknown.sync, []);
  });

  it('keeps other states next to not published', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('a', '1', { needsReview: true }),
      '/uk/x': { exists: false, published: { live: false } },
    });
    assert.deepEqual(result.sync, ['blocked by source review', 'not published']);
  });

  it('never flags a not created page in a none location', () => {
    const result = statusOf('/es/x', {
      '/en/x': file('a', '1'),
      '/es/x': { exists: false, published: { live: false, preview: false } },
    });
    assert.deepEqual(summary(result), { relationship: 'not created', sync: [] });
  });

  it('shows blocked by source review on a not created page', () => {
    const result = statusOf('/es/x', { '/en/x': file('a', '1', { needsReview: true }) });
    assert.deepEqual(summary(result), { relationship: 'not created', sync: ['blocked by source review'] });
  });

  it('shows job states on a page that does not exist yet', () => {
    const withJob = (state) => statusOf('/es/x', {
      '/en/x': file('a', '1'),
      '/es/x': { exists: false, job: { state } },
    });
    assert.deepEqual(summary(withJob('translating')), { relationship: 'not created', sync: ['translating'] });
    assert.deepEqual(summary(withJob('ready')), { relationship: 'not created', sync: ['ready to save'] });
  });
});

describe('pageStatus: existing pages', () => {
  const base = (sourceId, sourceVersion, via = 'rollout') => ({ sourceId, sourceVersion, via });

  it('is a current local copy when the base matches the source', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('a', '1'),
      '/uk/x': file('b', '7', { base: base('a', '1') }),
    });
    assert.deepEqual(summary(result), { relationship: 'local copy', sync: ['current'] });
    assert.equal(result.effectiveSource.path, '/en/x');
  });

  it('is behind source when the source version changed', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('a', '2'),
      '/uk/x': file('b', '7', { base: base('a', '1') }),
    });
    assert.deepEqual(summary(result), { relationship: 'local copy', sync: ['behind source'] });
  });

  it('is behind source when the source page was replaced', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('z', '1'),
      '/uk/x': file('b', '7', { base: base('a', '1') }),
    });
    assert.deepEqual(summary(result).sync, ['behind source']);
  });

  it('is a translation when last refreshed by translate', () => {
    const result = statusOf('/es/x', {
      '/en/x': file('a', '1'),
      '/es/x': file('e', '3', { base: base('a', '1', 'translate') }),
    });
    assert.deepEqual(summary(result), { relationship: 'translation', sync: ['current'] });
  });

  it('is a local copy behind source with an unknown base', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1'), '/uk/x': file('b', '7') });
    assert.deepEqual(summary(result), { relationship: 'local copy', sync: ['behind source'] });
    assert.deepEqual(result.reasons, ['base-unknown']);
  });

  it('is standalone with no base and no source', () => {
    const result = statusOf('/uk/x', { '/uk/x': file('b', '7') });
    assert.deepEqual(summary(result), { relationship: 'standalone', sync: [] });
    assert.equal(result.effectiveSource, null);
  });

  it('is source deleted with a base and no source', () => {
    const result = statusOf('/uk/x', { '/uk/x': file('b', '7', { base: base('a', '1') }) });
    assert.deepEqual(summary(result), { relationship: 'local copy', sync: ['source deleted'] });
  });

  it('treats a chain broken by a none hop as source deleted', () => {
    const result = statusOf('/mx/x', {
      '/en/x': file('a', '1'),
      '/mx/x': file('m', '1', { base: base('e', '1') }),
    });
    assert.deepEqual(summary(result), { relationship: 'local copy', sync: ['source deleted'] });
  });

  it('compares against the effective source through linked hops', () => {
    const result = statusOf('/ie/x', {
      '/en/x': file('a', '1'),
      '/ie/x': file('i', '1', { base: base('a', '1') }),
    });
    assert.deepEqual(summary(result), { relationship: 'local copy', sync: ['current'] });
  });

  it('orders overlapping sync values by urgency', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('a', '2', { needsReview: true }),
      '/uk/x': file('b', '7', { base: base('a', '1'), needsReview: true, job: { state: 'translating' } }),
    });
    assert.deepEqual(result.sync, ['needs review', 'blocked by source review', 'translating', 'behind source']);
  });

  it('keeps current alongside needs review', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('a', '1'),
      '/uk/x': file('b', '7', { base: base('a', '1'), needsReview: true }),
    });
    assert.deepEqual(result.sync, ['needs review', 'current']);
  });

  it('shows own review and job state on a standalone page', () => {
    const result = statusOf('/uk/x', { '/uk/x': file('b', '7', { needsReview: true, job: { state: 'ready' } }) });
    assert.deepEqual(summary(result), { relationship: 'standalone', sync: ['needs review', 'ready to save'] });
  });

  it('shows own review state on a root page', () => {
    const result = statusOf('/en/x', { '/en/x': file('a', '1', { needsReview: true }) });
    assert.deepEqual(summary(result), { relationship: 'root', sync: ['needs review'] });
  });

  it('orders source deleted and ready to save', () => {
    const result = statusOf('/uk/x', {
      '/uk/x': file('b', '7', { base: base('a', '1'), job: { state: 'ready' } }),
    });
    assert.deepEqual(result.sync, ['source deleted', 'ready to save']);
  });
});

describe('pageStatus: overridden', () => {
  const base = (targetVersion) => ({
    sourceId: 'a', sourceVersion: '1', via: 'rollout', targetVersion,
  });

  it('is overridden when the copy changed since it was written', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1'), '/uk/x': file('b', '8', { base: base('7') }) });
    assert.equal(result.overridden, true);
    assert.deepEqual(result.sync, ['current']);
  });

  it('is not overridden when the copy is as written', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '2'), '/uk/x': file('b', '7', { base: base('7') }) });
    assert.equal(result.overridden, false);
    assert.deepEqual(result.sync, ['behind source']);
  });

  it('is not overridden without a recorded target version', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1'), '/uk/x': file('b', '7', { base: base() }) });
    assert.equal(result.overridden, false);
  });

  it('is not overridden on pages without a file', () => {
    assert.equal(statusOf('/uk/x', { '/en/x': file('a', '1') }).overridden, false);
  });
});

describe('pageStatus: unlinked', () => {
  const unlinked = { unlinked: true };

  it('is unlinked when the index flags it, keeping the source for history', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('a', '2'),
      '/uk/x': file('b', '7', {
        base: {
          sourceId: 'a', sourceVersion: '1', via: 'rollout', targetVersion: '6',
        },
        overrides: unlinked,
      }),
    });
    assert.deepEqual(summary(result), { relationship: 'unlinked', sync: [] });
    assert.equal(result.effectiveSource.path, '/en/x');
    assert.equal(result.overridden, false);
  });

  it('keeps own review state on an unlinked page', () => {
    const result = statusOf('/uk/x', {
      '/en/x': file('a', '1'),
      '/uk/x': file('b', '7', { overrides: unlinked, needsReview: true }),
    });
    assert.deepEqual(summary(result), { relationship: 'unlinked', sync: ['needs review'] });
  });

  it('ignores the flag when the page has no file', () => {
    const result = statusOf('/uk/x', { '/en/x': file('a', '1'), '/uk/x': { exists: false, overrides: unlinked } });
    assert.equal(result.relationship, 'inherited');
  });
});
