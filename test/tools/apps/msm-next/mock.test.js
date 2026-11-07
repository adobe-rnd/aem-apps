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
import createMockLocalization, {
  applyIndexChanges, listFolder,
} from '../../../../tools/apps/msm-next/data/mock/mock-localization.js';
import createLoader from '../../../../tools/apps/msm-next/data/loader.js';
import { pageType, primarySync } from '../../../../tools/apps/msm-next/data/display.js';

const settle = () => new Promise((resolve) => { setTimeout(resolve, 50); });

async function loaded() {
  const localization = createMockLocalization({ latency: false, translationDelay: 5 });
  const loader = createLoader({ localization, list: localization.list, site: 'gamebox' });
  await loader.load();
  await settle();
  return { localization, loader };
}

const describePage = (loader, key) => {
  const result = loader.results.get(key);
  return [pageType(result).label, primarySync(result), Boolean(result?.status?.overridden)];
};

describe('mock helpers', () => {
  it('patches and replaces index entries', () => {
    const index = { pages: { a: { base: 1, job: 2 } }, pending: { '/x': { linked: true } } };
    const patched = applyIndexChanges(index, { pages: { a: { job: null } }, pending: { '/x': null } }, true);
    assert.deepEqual(patched, { pages: { a: { base: 1 } }, pending: {} });
    const replaced = applyIndexChanges(index, { pages: { a: { job: 3 } } }, false);
    assert.deepEqual(replaced.pages.a, { job: 3 });
  });

  it('lists one folder level', () => {
    const items = listFolder(['s:/a/b.html', 's:/a/c/d.html', 's:/a/c/e.html', 't:/a/x.html'], 's', '/a');
    assert.deepEqual(items, [
      { path: '/a/b.html', isFolder: false },
      { path: '/a/c', isFolder: true },
    ]);
  });
});

describe('mock localization', () => {
  it('seeds a realistic mix of statuses', async () => {
    const { loader } = await loaded();
    assert.equal(loader.errors.size, 0);
    assert.equal(loader.tree.top.length, 11);
    assert.deepEqual(describePage(loader, 'gamebox:/global/index.html'), ['Source', null, false]);
    assert.deepEqual(describePage(loader, 'gamebox:/amer/hardware/console.html'), ['Local copy', 'current', true]);
    assert.deepEqual(describePage(loader, 'gamebox:/en-us/hardware/console.html'), ['Local copy', 'needs review', false]);
    assert.deepEqual(describePage(loader, 'gamebox:/emea/services/gamebox-plus.html'), ['Local copy', 'behind source', true]);
    assert.deepEqual(describePage(loader, 'gamebox:/es-419/hardware/console.html'), ['Not created', 'translating', false]);
    assert.deepEqual(describePage(loader, 'gamebox:/es-419/games/starfall.html'), ['Not created', 'ready to save', false]);
    assert.deepEqual(describePage(loader, 'gamebox:/en-us/support/index.html'), ['Independent', null, false]);
    assert.deepEqual(describePage(loader, 'gamebox:/en-us/deals/black-friday.html'), ['Independent', null, false]);
    assert.deepEqual(describePage(loader, 'gamebox:/fr-fr/hardware/console.html'), ['Inherited', null, false]);
    assert.deepEqual(describePage(loader, 'gamebox:/en-gb/games/index.html'), ['Not created', null, false]);
    assert.deepEqual(describePage(loader, 'gamebox-retail:/pixelmart/hardware/console.html'), ['Local copy', 'blocked by source review', false]);
    assert.equal(loader.tree.nodes.has('gamebox:/global/.trash/old-home.html'), false);
  });

  it('mutates state on rollout, link, unlink and relink', async () => {
    const { localization, loader } = await loaded();
    const site = 'gamebox';
    assert.equal((await localization.execute({ site, path: '/en-ca/hardware/console.html', action: 'rollout' })).ok, true);
    assert.equal((await localization.page(site, '/en-ca/hardware/console.html')).status.sync[0], 'current');

    assert.equal((await localization.execute({ site, path: '/en-ca/hardware/controller.html', action: 'link' })).ok, true);
    assert.equal((await localization.page(site, '/en-ca/hardware/controller.html')).status.relationship, 'inherited');

    assert.equal((await localization.execute({ site, path: '/en-ca/hardware/controller.html', action: 'unlink' })).ok, true);
    assert.equal((await localization.page(site, '/en-ca/hardware/controller.html')).status.relationship, 'unlinked');

    assert.equal((await localization.execute({ site, path: '/en-ca/hardware/controller.html', action: 'relink' })).ok, true);
    assert.equal((await localization.page(site, '/en-ca/hardware/controller.html')).status.relationship, 'local copy');

    assert.equal((await localization.execute({ site, path: '/amer/hardware/console.html', action: 'reconnect' })).ok, true);
    await loader.refreshNodes([loader.tree.nodes.get('gamebox:/amer/hardware/console.html')]);
    assert.equal(describePage(loader, 'gamebox:/amer/hardware/console.html')[0], 'Inherited');
  });

  it('runs translations through translating, ready and save', async () => {
    const { localization } = await loaded();
    const page = { site: 'gamebox', path: '/de/games/starfall.html' };
    const changed = new Promise((resolve) => { localization.subscribe(resolve); });
    assert.equal((await localization.execute({ ...page, action: 'translate' })).ok, true);
    assert.equal((await localization.page(page.site, page.path)).status.sync[0], 'translating');
    await changed;
    localization.refresh();
    assert.equal((await localization.page(page.site, page.path)).status.sync[0], 'ready to save');
    assert.equal((await localization.execute({ ...page, action: 'save' })).ok, true);
    const saved = await localization.page(page.site, page.path);
    assert.equal(saved.status.relationship, 'translation');
    assert.equal(saved.status.sync[0], 'current');
  });

  it('resolves reviews and publishes', async () => {
    const { localization } = await loaded();
    const site = 'gamebox';
    const path = '/en-us/hardware/console.html';
    assert.equal((await localization.resolveReview(site, path)).ok, true);
    const reviewed = await localization.page(site, path);
    assert.equal(reviewed.status.sync.includes('needs review'), false);
    const published = await localization.publish({ site, path: '/global/hardware/controller.html', cascade: true });
    assert.equal(published.ok, true);
    assert.ok(published.results.length > 1);
    assert.equal(localization.publishState(site, '/amer/hardware/controller.html'), 'live');
  });
});
