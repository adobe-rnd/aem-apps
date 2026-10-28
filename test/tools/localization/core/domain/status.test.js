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
import { configFromRows, loc } from '../helpers.js';
import { sourceChain } from '../../../../../tools/localization/core/domain/resolve.js';
import { pageStatus } from '../../../../../tools/localization/core/domain/status.js';

// global:/en  en-US (root)
// ├── global:/uk  en-GB  linked
// │   └── global:/ie  en-IE  linked
// ├── global:/es  es     none
// │   └── global:/mx  es-MX  linked
// └── global:/bad (invalid language)
const model = configFromRows([
  loc('global', '/en', 'en-US'),
  loc('global', '/uk', 'en-GB', '/en', 'link, rollout, translate', 'linked'),
  loc('global', '/ie', 'en-IE', '/uk', 'link, rollout', 'linked'),
  loc('global', '/es', 'es', '/en', 'rollout, translate', 'none'),
  loc('global', '/mx', 'es-MX', '/es', 'link, rollout', 'linked'),
  loc('global', '/bad', 'nope', '/en'),
]);

const file = (id, version, extra = {}) => ({
  exists: true, id, version, ...extra,
});

const status = (path, infoByPath = {}, m = model, site = 'global') => pageStatus(
  sourceChain(m, site, path).map((ref) => ({ ref, info: infoByPath[ref.path] })),
);

const brief = (s) => s && { relationship: s.relationship, sync: s.sync };

describe('pageStatus: no page', () => {
  it('is null outside any location', () => {
    assert.equal(status('/fr/x'), null);
  });

  it('is null for a missing root page', () => {
    assert.equal(status('/en/x'), null);
  });

  it('is null when nothing above has content', () => {
    assert.equal(status('/uk/x'), null);
    assert.equal(status('/es/x'), null);
  });
});

describe('pageStatus: config', () => {
  it('reports config error for an invalid location', () => {
    const s = status('/bad/x', { '/en/x': file('a', '1') });
    assert.deepEqual(brief(s), { relationship: 'config error', sync: [] });
    assert.deepEqual(s.reasons, ['invalid-location']);
  });

  it('reports unknown for an unresolved location', () => {
    const partial = configFromRows([loc('global', '/uk', 'en-GB', 'other:/en')]);
    const s = status('/uk/x', { '/uk/x': file('b', '1') }, partial);
    assert.deepEqual(brief(s), { relationship: 'unknown', sync: [] });
    assert.deepEqual(s.reasons, ['unresolved-location']);
  });
});

describe('pageStatus: root', () => {
  it('is root when the file exists', () => {
    assert.deepEqual(brief(status('/en/x', { '/en/x': file('a', '1') })), { relationship: 'root', sync: [] });
  });
});

describe('pageStatus: missing pages', () => {
  it('is linked when the source has content', () => {
    const s = status('/uk/x', { '/en/x': file('a', '1') });
    assert.deepEqual(brief(s), { relationship: 'linked', sync: [] });
    assert.equal(s.effectiveSource.path, '/en/x');
  });

  it('is linked through linked hops', () => {
    const s = status('/ie/x', { '/en/x': file('a', '1') });
    assert.deepEqual(brief(s), { relationship: 'linked', sync: [] });
    assert.equal(s.effectiveSource.path, '/en/x');
  });

  it('is not created when own location is none and the source has content', () => {
    assert.deepEqual(brief(status('/es/x', { '/en/x': file('a', '1') })), { relationship: 'not created', sync: [] });
  });

  it('is unavailable when a none hop above has no page', () => {
    const s = status('/mx/x', { '/en/x': file('a', '1') });
    assert.deepEqual(brief(s), { relationship: 'unavailable', sync: [] });
    assert.equal(s.effectiveSource, null);
  });

  it('is linked to a none-location page that exists', () => {
    const s = status('/mx/x', { '/en/x': file('a', '1'), '/es/x': file('e', '1') });
    assert.deepEqual(brief(s), { relationship: 'linked', sync: [] });
    assert.equal(s.effectiveSource.path, '/es/x');
  });

  it('shows blocked by source review on a linked page', () => {
    const s = status('/uk/x', { '/en/x': file('a', '1', { needsReview: true }) });
    assert.deepEqual(brief(s), { relationship: 'linked', sync: ['blocked by source review'] });
  });

  it('shows blocked by source review on a not created page', () => {
    const s = status('/es/x', { '/en/x': file('a', '1', { needsReview: true }) });
    assert.deepEqual(brief(s), { relationship: 'not created', sync: ['blocked by source review'] });
  });

  it('shows job states on a page that does not exist yet', () => {
    assert.deepEqual(
      brief(status('/es/x', { '/en/x': file('a', '1'), '/es/x': { exists: false, job: { state: 'translating' } } })),
      { relationship: 'not created', sync: ['translating'] },
    );
    assert.deepEqual(
      brief(status('/es/x', { '/en/x': file('a', '1'), '/es/x': { exists: false, job: { state: 'ready' } } })),
      { relationship: 'not created', sync: ['ready to save'] },
    );
  });
});

describe('pageStatus: existing pages', () => {
  const base = (sourceId, sourceVersion, via = 'rollout') => ({ sourceId, sourceVersion, via });

  it('is a current local copy when the base matches the source', () => {
    const s = status('/uk/x', {
      '/en/x': file('a', '1'),
      '/uk/x': file('b', '7', { base: base('a', '1') }),
    });
    assert.deepEqual(brief(s), { relationship: 'local copy', sync: ['current'] });
    assert.equal(s.effectiveSource.path, '/en/x');
  });

  it('is behind source when the source version changed', () => {
    const s = status('/uk/x', {
      '/en/x': file('a', '2'),
      '/uk/x': file('b', '7', { base: base('a', '1') }),
    });
    assert.deepEqual(brief(s), { relationship: 'local copy', sync: ['behind source'] });
  });

  it('is behind source when the source page was replaced', () => {
    const s = status('/uk/x', {
      '/en/x': file('z', '1'),
      '/uk/x': file('b', '7', { base: base('a', '1') }),
    });
    assert.deepEqual(brief(s).sync, ['behind source']);
  });

  it('is a translation when last refreshed by translate', () => {
    const s = status('/es/x', {
      '/en/x': file('a', '1'),
      '/es/x': file('e', '3', { base: base('a', '1', 'translate') }),
    });
    assert.deepEqual(brief(s), { relationship: 'translation', sync: ['current'] });
  });

  it('is a local copy behind source with an unknown base', () => {
    const s = status('/uk/x', { '/en/x': file('a', '1'), '/uk/x': file('b', '7') });
    assert.deepEqual(brief(s), { relationship: 'local copy', sync: ['behind source'] });
    assert.deepEqual(s.reasons, ['base-unknown']);
  });

  it('is standalone with no base and no source', () => {
    const s = status('/uk/x', { '/uk/x': file('b', '7') });
    assert.deepEqual(brief(s), { relationship: 'standalone', sync: [] });
    assert.equal(s.effectiveSource, null);
  });

  it('is source deleted with a base and no source', () => {
    const s = status('/uk/x', { '/uk/x': file('b', '7', { base: base('a', '1') }) });
    assert.deepEqual(brief(s), { relationship: 'local copy', sync: ['source deleted'] });
  });

  it('treats a chain broken by a none hop as source deleted', () => {
    const s = status('/mx/x', {
      '/en/x': file('a', '1'),
      '/mx/x': file('m', '1', { base: base('e', '1') }),
    });
    assert.deepEqual(brief(s), { relationship: 'local copy', sync: ['source deleted'] });
  });

  it('compares against the effective source through linked hops', () => {
    const s = status('/ie/x', {
      '/en/x': file('a', '1'),
      '/ie/x': file('i', '1', { base: base('a', '1') }),
    });
    assert.deepEqual(brief(s), { relationship: 'local copy', sync: ['current'] });
  });

  it('orders overlapping sync values by urgency', () => {
    const s = status('/uk/x', {
      '/en/x': file('a', '2', { needsReview: true }),
      '/uk/x': file('b', '7', { base: base('a', '1'), needsReview: true, job: { state: 'translating' } }),
    });
    assert.deepEqual(s.sync, ['needs review', 'blocked by source review', 'translating', 'behind source']);
  });

  it('keeps current alongside needs review', () => {
    const s = status('/uk/x', {
      '/en/x': file('a', '1'),
      '/uk/x': file('b', '7', { base: base('a', '1'), needsReview: true }),
    });
    assert.deepEqual(s.sync, ['needs review', 'current']);
  });

  it('shows own review and job state on a standalone page', () => {
    const s = status('/uk/x', { '/uk/x': file('b', '7', { needsReview: true, job: { state: 'ready' } }) });
    assert.deepEqual(brief(s), { relationship: 'standalone', sync: ['needs review', 'ready to save'] });
  });

  it('shows own review state on a root page', () => {
    const s = status('/en/x', { '/en/x': file('a', '1', { needsReview: true }) });
    assert.deepEqual(brief(s), { relationship: 'root', sync: ['needs review'] });
  });

  it('orders source deleted and ready to save', () => {
    const s = status('/uk/x', {
      '/uk/x': file('b', '7', { base: base('a', '1'), job: { state: 'ready' } }),
    });
    assert.deepEqual(s.sync, ['source deleted', 'ready to save']);
  });
});
