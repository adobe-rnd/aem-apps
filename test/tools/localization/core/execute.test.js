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
import { createLocalization } from '../../../../tools/localization/core/index.js';

// gamebox:/global  en (root)
// ├── gamebox:/en-us  en-US  link, rollout; inherited; merge, overwrite
// │   └── retail:/bestbuy  en-US  link, rollout; inherited (cross-site)
// └── gamebox:/fr     fr     rollout; none; onComplete publish
const CONFIGS = {
  gamebox: [
    { path: '/global', language: 'en' },
    {
      path: '/en-us', language: 'en-US', source: '/global', actions: 'link, rollout', missingPages: 'linked', conflictBehavior: 'merge, overwrite',
    },
    {
      path: '/fr', language: 'fr-FR', source: '/en-us', actions: 'rollout', onComplete: 'publish',
    },
  ],
  retail: [
    {
      path: '/bestbuy', language: 'en-US', source: 'gamebox:/en-us', actions: 'link, rollout', missingPages: 'linked',
    },
  ],
};

function createWorld({
  pages = {}, indexes = {}, failCopy = false, copyAvailable = true, loseWrites = false,
} = {}) {
  const files = new Map(Object.entries(pages));
  const index = new Map(Object.entries(indexes));
  const calls = {
    merge: [], overwrite: [], remove: [], preview: [], publish: [],
  };
  let ids = 0;

  const key = ({ site, path }) => `${site}:${path}`;
  const copy = (operation) => async ({ source, target }) => {
    calls[operation].push(`${key(source)}>${key(target)}`);
    if (failCopy) return { ok: false, status: 500, error: 'boom' };
    const existing = files.get(key(target));
    ids += 1;
    files.set(key(target), existing
      ? { ...existing, version: `${existing.version}+${operation}` }
      : { id: `new${ids}`, version: 'v1' });
    if (loseWrites) files.delete(key(target));
    return { ok: true, status: 200 };
  };

  const patchIndex = (locationId, changes) => {
    const current = index.get(locationId) ?? { pages: {}, pending: {} };
    const updated = { pages: { ...current.pages }, pending: { ...current.pending } };
    ['pages', 'pending'].forEach((section) => {
      Object.entries(changes[section] ?? {}).forEach(([entryKey, patch]) => {
        if (patch === null) {
          delete updated[section][entryKey];
          return;
        }
        const entry = { ...(updated[section][entryKey] ?? {}) };
        Object.entries(patch).forEach(([field, value]) => {
          if (value === null) delete entry[field];
          else entry[field] = value;
        });
        updated[section][entryKey] = entry;
      });
    });
    index.set(locationId, updated);
    return updated;
  };

  const providers = {
    config: {
      read: async (site) => CONFIGS[site] ?? null,
      listSites: async () => Object.keys(CONFIGS),
    },
    pageInfo: {
      get: async (site, path) => {
        const file = files.get(`${site}:${path}`);
        return file ? { exists: true, id: file.id, version: file.version } : { exists: false };
      },
      needsReview: async () => false,
    },
    index: {
      read: async (locationId) => index.get(locationId) ?? { pages: {}, pending: {} },
      patch: async (locationId, changes) => patchIndex(locationId, changes),
    },
  };
  const services = {
    content: {
      copyAvailable,
      merge: copy('merge'),
      overwrite: copy('overwrite'),
      remove: async (page) => {
        calls.remove.push(key(page));
        files.delete(key(page));
        return { ok: true, status: 204 };
      },
    },
    publish: {
      preview: async (page) => {
        calls.preview.push(key(page));
        return { ok: true, status: 200 };
      },
      publish: async (page) => {
        calls.publish.push(key(page));
        return { ok: true, status: 200 };
      },
    },
  };
  const localization = createLocalization({ org: 'acme', providers, services });
  return {
    localization, files, index, calls,
  };
}

const file = (id, version) => ({ id, version });
const base = (sourceId, sourceVersion, targetVersion) => ({
  sourceId, sourceVersion, via: 'rollout', targetVersion,
});

describe('execute: rollout', () => {
  it('merges into a local copy and records the new base', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '2'), 'gamebox:/en-us/x': file('u', '5') },
      indexes: { 'gamebox:/en-us': { pages: { u: { base: base('g', '1', '5') } }, pending: {} } },
    });
    const result = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'rollout' });
    assert.equal(result.ok, true);
    assert.deepEqual(world.calls.merge, ['gamebox:/global/x>gamebox:/en-us/x']);
    const entry = world.index.get('gamebox:/en-us').pages.u;
    assert.equal(entry.base.sourceId, 'g');
    assert.equal(entry.base.sourceVersion, '2');
    assert.equal(entry.base.via, 'rollout');
    assert.equal(entry.base.targetVersion, '5+merge');
    const after = await world.localization.page('gamebox', '/en-us/x');
    assert.deepEqual(after.status.sync, ['current']);
    assert.equal(after.status.overridden, false);
  });

  it('uses overwrite when asked', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '2'), 'gamebox:/en-us/x': file('u', '5') },
    });
    await world.localization.execute({
      site: 'gamebox', path: '/en-us/x', action: 'rollout', option: 'overwrite',
    });
    assert.deepEqual(world.calls.overwrite, ['gamebox:/global/x>gamebox:/en-us/x']);
  });

  it('rejects an option the location does not allow', async () => {
    const world = createWorld({
      pages: { 'gamebox:/en-us/x': file('u', '1'), 'gamebox:/fr/x': file('f', '1') },
    });
    const result = await world.localization.execute({
      site: 'gamebox', path: '/fr/x', action: 'rollout', option: 'overwrite',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'option-not-allowed');
    assert.deepEqual(world.calls.overwrite, []);
  });

  it('creates the page from an inherited page', async () => {
    const world = createWorld({ pages: { 'gamebox:/global/x': file('g', '1') } });
    const result = await world.localization.execute({ site: 'retail', path: '/bestbuy/x', action: 'rollout' });
    assert.equal(result.ok, true);
    assert.deepEqual(world.calls.merge, ['gamebox:/global/x>retail:/bestbuy/x']);
    const after = await world.localization.page('retail', '/bestbuy/x');
    assert.equal(after.status.relationship, 'local copy');
    assert.deepEqual(after.status.sync, ['current']);
  });

  it('runs onComplete publish for the location', async () => {
    const world = createWorld({ pages: { 'gamebox:/en-us/x': file('u', '1') } });
    await world.localization.execute({ site: 'gamebox', path: '/fr/x', action: 'rollout' });
    assert.deepEqual(world.calls.publish, ['gamebox:/fr/x']);
  });

  it('clears a stale pending job after rolling out over an existing page', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '2'), 'gamebox:/en-us/x': file('u', '5') },
      indexes: { 'gamebox:/en-us': { pages: {}, pending: { '/en-us/x': { job: { state: 'ready' } } } } },
    });
    world.localization.refresh();
    await world.localization.execute({
      site: 'gamebox', path: '/en-us/x', action: 'rollout',
    });
    assert.deepEqual(world.index.get('gamebox:/en-us').pending, {});
  });

  it('fails without touching the index when the written page cannot be read', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '2'), 'gamebox:/en-us/x': file('u', '5') },
      loseWrites: true,
    });
    const result = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'rollout' });
    assert.deepEqual(result, { ok: false, error: 'target-unreadable' });
    assert.equal(world.index.get('gamebox:/en-us'), undefined);
  });

  it('fails when the written page has no id', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '2'), 'gamebox:/en-us/x': file(null, '5') },
    });
    const result = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'rollout' });
    assert.deepEqual(result, { ok: false, error: 'target-unreadable' });
  });

  it('does not record a base when the copy fails', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '2'), 'gamebox:/en-us/x': file('u', '5') },
      failCopy: true,
    });
    const result = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'rollout' });
    assert.deepEqual(result, { ok: false, status: 500, error: 'boom' });
    assert.equal(world.index.get('gamebox:/en-us'), undefined);
  });

  it('refuses actions that are not available or disabled', async () => {
    const world = createWorld({ pages: { 'gamebox:/global/x': file('g', '1') } });
    const missing = await world.localization.execute({ site: 'gamebox', path: '/global/x', action: 'rollout' });
    assert.deepEqual(missing, { ok: false, error: 'action-unavailable', reasons: [] });
  });
});

describe('execute: link', () => {
  it('links a not created page and publishes it', async () => {
    const world = createWorld({
      pages: { 'gamebox:/en-us/x': file('u', '1') },
    });
    const fr = CONFIGS.gamebox.find((row) => row.path === '/fr');
    fr.actions = 'link, rollout';
    try {
      const result = await world.localization.execute({ site: 'gamebox', path: '/fr/x', action: 'link' });
      assert.equal(result.ok, true);
      assert.equal(world.index.get('gamebox:/fr').pending['/fr/x'].linked, true);
      assert.deepEqual(world.calls.publish, ['gamebox:/fr/x']);
      const after = await world.localization.page('gamebox', '/fr/x');
      assert.equal(after.status.relationship, 'inherited');
    } finally {
      fr.actions = 'rollout';
    }
  });
});

describe('execute: reconnect', () => {
  it('clears a stale pending job for the path', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '1'), 'gamebox:/en-us/x': file('u', '5') },
      indexes: {
        'gamebox:/en-us': {
          pages: { u: { base: base('g', '1', '5') } },
          pending: { '/en-us/x': { job: { state: 'translating' } } },
        },
      },
    });
    await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'reconnect' });
    assert.deepEqual(world.index.get('gamebox:/en-us').pending, {});
  });

  it('works without a copy engine', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '1'), 'gamebox:/en-us/x': file('u', '5') },
      copyAvailable: false,
    });
    const before = await world.localization.page('gamebox', '/en-us/x');
    assert.deepEqual(before.actions.find((each) => each.action === 'rollout').reasons, ['copy-engine-unavailable']);
    const result = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'reconnect' });
    assert.equal(result.ok, true);
  });
  it('deletes the copy and its index entry', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '1'), 'gamebox:/en-us/x': file('u', '5') },
      indexes: { 'gamebox:/en-us': { pages: { u: { base: base('g', '1', '5') } }, pending: {} } },
    });
    const result = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'reconnect' });
    assert.equal(result.ok, true);
    assert.deepEqual(world.calls.remove, ['gamebox:/en-us/x']);
    assert.deepEqual(world.index.get('gamebox:/en-us').pages, {});
    const after = await world.localization.page('gamebox', '/en-us/x');
    assert.equal(after.status.relationship, 'inherited');
  });
});

describe('execute: unlink and relink', () => {
  it('flags a local copy as unlinked and back', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '1'), 'gamebox:/en-us/x': file('u', '5') },
      indexes: { 'gamebox:/en-us': { pages: { u: { base: base('g', '1', '5') } }, pending: {} } },
    });
    const unlink = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'unlink' });
    assert.equal(unlink.ok, true);
    const unlinked = await world.localization.page('gamebox', '/en-us/x');
    assert.equal(unlinked.status.relationship, 'unlinked');
    assert.equal(world.index.get('gamebox:/en-us').pages.u.overrides.unlinkedFrom, 'gamebox:/global/x');
    assert.deepEqual(world.index.get('gamebox:/en-us').pages.u.base, base('g', '1', '5'));

    const relink = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'relink' });
    assert.equal(relink.ok, true);
    const relinked = await world.localization.page('gamebox', '/en-us/x');
    assert.equal(relinked.status.relationship, 'local copy');
    assert.equal(world.index.get('gamebox:/en-us').pages.u.overrides, undefined);
  });

  it('copies an inherited page before unlinking it', async () => {
    const world = createWorld({ pages: { 'gamebox:/global/x': file('g', '1') } });
    const result = await world.localization.execute({ site: 'gamebox', path: '/en-us/x', action: 'unlink' });
    assert.equal(result.ok, true);
    assert.deepEqual(world.calls.overwrite, ['gamebox:/global/x>gamebox:/en-us/x']);
    const after = await world.localization.page('gamebox', '/en-us/x');
    assert.equal(after.status.relationship, 'unlinked');
  });
});

describe('publish', () => {
  it('publishes one page', async () => {
    const world = createWorld({ pages: { 'gamebox:/global/x': file('g', '1') } });
    const result = await world.localization.publish({ site: 'gamebox', path: '/global/x' });
    assert.equal(result.ok, true);
    assert.deepEqual(world.calls.publish, ['gamebox:/global/x']);
  });

  it('previews instead when asked', async () => {
    const world = createWorld({ pages: { 'gamebox:/global/x': file('g', '1') } });
    await world.localization.publish({ site: 'gamebox', path: '/global/x', live: false });
    assert.deepEqual(world.calls.preview, ['gamebox:/global/x']);
    assert.deepEqual(world.calls.publish, []);
  });

  it('cascades through inherited pages, across sites, stopping at copies', async () => {
    const world = createWorld({
      pages: { 'gamebox:/global/x': file('g', '1'), 'gamebox:/en-us/y': file('u', '1') },
    });
    const x = await world.localization.publish({ site: 'gamebox', path: '/global/x', cascade: true });
    assert.equal(x.ok, true);
    assert.deepEqual(world.calls.publish, ['gamebox:/global/x', 'gamebox:/en-us/x', 'retail:/bestbuy/x']);
    assert.deepEqual(x.results.map((entry) => `${entry.site}:${entry.path}`), world.calls.publish);

    world.calls.publish.length = 0;
    await world.localization.publish({ site: 'gamebox', path: '/global/y', cascade: true });
    assert.deepEqual(world.calls.publish, ['gamebox:/global/y']);
  });
});
