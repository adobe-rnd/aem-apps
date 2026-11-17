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
  toSnapshotPath, normalizeContext, snapshotStatus, scheduledPublish, snapshotAppHref,
  loadPageSnapshots,
} from '../../../../tools/plugins/snapshots/utils.js';

describe('toSnapshotPath', () => {
  it('maps DA paths to snapshot paths', () => {
    assert.equal(toSnapshotPath('/products/alpha'), '/products/alpha');
    assert.equal(toSnapshotPath('/products/alpha.html'), '/products/alpha');
    assert.equal(toSnapshotPath('/index'), '/');
    assert.equal(toSnapshotPath('/docs/index.html'), '/docs/');
    assert.equal(toSnapshotPath('/reindex'), '/reindex');
  });
});

describe('normalizeContext', () => {
  it('accepts site or legacy repo and rejects incomplete context', () => {
    assert.deepEqual(normalizeContext({ org: 'o', repo: 's', path: '/index' }), { org: 'o', site: 's', path: '/' });
    assert.deepEqual(normalizeContext({ org: 'o', site: 's', path: '/a' }), { org: 'o', site: 's', path: '/a' });
    assert.equal(normalizeContext({ org: 'o', site: 's' }), undefined);
  });
});

describe('snapshotStatus', () => {
  it('matches the admin app review states', () => {
    assert.equal(snapshotStatus({ review: 'requested', locked: true }).label, 'Ready');
    assert.equal(snapshotStatus({ review: 'rejected' }).label, 'Rejected');
    assert.equal(snapshotStatus({ locked: true }).label, 'Locked');
    assert.equal(snapshotStatus({}).label, 'Open');
  });
});

describe('scheduledPublish', () => {
  it('returns only future schedules', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    assert.equal(scheduledPublish({ metadata: { scheduledPublish: '2025-12-31T00:00:00Z' } }, now), undefined);
    assert.equal(scheduledPublish({}, now), undefined);
    assert.equal(scheduledPublish({ metadata: { scheduledPublish: '2026-02-01T00:00:00Z' } }, now).toISOString(), '2026-02-01T00:00:00.000Z');
  });
});

describe('snapshotAppHref', () => {
  it('links to the admin app, optionally filtered', () => {
    assert.equal(snapshotAppHref({ org: 'o', site: 's' }), 'https://da.live/apps/snapshots#/o/s');
    assert.equal(snapshotAppHref({ org: 'o', site: 's', name: 'spring' }), 'https://da.live/apps/snapshots?snapshot=spring#/o/s');
  });
});

describe('loadPageSnapshots', () => {
  const manifests = {
    spring: { resources: [{ path: '/' }, { path: '/a' }] },
    summer: { resources: [{ path: '/b' }], locked: true },
    broken: { error: 'nope' },
  };
  const api = {
    list: async () => ({ snapshots: Object.keys(manifests).map((name) => ({ name })) }),
    getManifest: async ({ name }) => manifests[name],
    hasSnapshotSource: async ({ name }) => name === 'spring',
  };

  it('splits snapshots containing the page from the rest', async () => {
    const { containing, others } = await loadPageSnapshots({ api, path: '/' });
    const pick = ({ name, resource, hasSource }) => ({ name, resource, hasSource });
    assert.deepEqual(containing.map(pick), [
      { name: 'spring', resource: { path: '/' }, hasSource: true },
    ]);
    assert.deepEqual(others.map(({ name, error }) => ({ name, error })), [
      { name: 'summer', error: undefined },
      { name: 'broken', error: 'nope' },
    ]);
  });

  it('returns list errors', async () => {
    const denied = { list: async () => ({ error: 'denied', status: 403 }) };
    const result = await loadPageSnapshots({ api: denied, path: '/' });
    assert.deepEqual(result, { error: 'denied' });
  });
});
