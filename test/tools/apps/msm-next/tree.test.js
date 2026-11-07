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
import { parseConfig } from '../../../../tools/localization/core/domain/config.js';
import {
  treeRoots, treeLocations, buildPageTree, flattenRows, visibleSet, rollup, attentionList,
  countPages, matchesKind, matchesQuery, descendants, ancestors, compareRel,
} from '../../../../tools/apps/msm-next/data/tree.js';

const model = parseConfig({
  sites: {
    brand: [
      { path: '/en', language: 'en' },
      {
        path: '/fr', language: 'fr', source: '/en', actions: 'translate',
      },
      {
        path: '/fr-be', language: 'fr-BE', source: '/fr', actions: 'link, rollout', missingPages: 'linked',
      },
      {
        path: '/en/nested', language: 'en-GB', source: '/en', actions: 'rollout',
      },
    ],
    shop: [
      {
        path: '/', language: 'en', source: 'brand:/en', actions: 'rollout',
      },
    ],
  },
});

const files = new Map([
  ['brand:/en', ['/en/index.html', '/en/about.html']],
  ['brand:/fr', ['/fr/index.html', '/fr/promo.html']],
  ['brand:/fr-be', []],
  ['brand:/en/nested', []],
  ['shop:/', ['/index.html']],
]);

const status = (relationship, sync = []) => ({ status: { relationship, sync }, actions: [] });

describe('location tree', () => {
  it('finds roots for a site', () => {
    assert.deepEqual(treeRoots(model, 'brand').map((location) => location.id), ['brand:/en']);
    assert.deepEqual(treeRoots(model, 'shop').map((location) => location.id), ['brand:/en']);
  });

  it('orders locations depth first', () => {
    const ordered = treeLocations(model, treeRoots(model, 'brand'));
    assert.deepEqual(
      ordered.map(({ location, depth }) => `${location.id}@${depth}`),
      ['brand:/en@0', 'brand:/fr@1', 'brand:/fr-be@2', 'brand:/en/nested@1', 'shop:/@1'],
    );
  });

  it('sorts home first', () => {
    assert.deepEqual(['/b.html', '/index.html', '/a.html'].sort(compareRel), ['/index.html', '/a.html', '/b.html']);
  });
});

describe('buildPageTree', () => {
  const tree = buildPageTree({ model, roots: treeRoots(model, 'brand'), files });

  it('nests each source page by location', () => {
    const [home, about] = tree.top;
    assert.equal(home.key, 'brand:/en/index.html');
    assert.equal(about.key, 'brand:/en/about.html');
    assert.deepEqual(home.children.map((node) => node.key), [
      'brand:/fr/index.html', 'brand:/en/nested/index.html', 'shop:/index.html',
    ]);
    assert.deepEqual(home.children[0].children.map((node) => node.key), ['brand:/fr-be/index.html']);
    assert.equal(home.children[0].parent, home.key);
    assert.equal(home.children[0].children[0].depth, 2);
  });

  it('adds pages that only exist below the root as their own top rows', () => {
    const promo = tree.top.find((node) => node.key === 'brand:/fr/promo.html');
    assert.ok(promo);
    assert.equal(promo.parent, null);
    assert.equal(promo.depth, 1);
    assert.deepEqual(promo.children.map((node) => node.key), ['brand:/fr-be/promo.html']);
  });

  it('skips pages that belong to a nested location', () => {
    const nestedFiles = new Map(files);
    nestedFiles.set('brand:/en', ['/en/index.html', '/en/nested/x.html']);
    const nested = buildPageTree({ model, roots: treeRoots(model, 'brand'), files: nestedFiles });
    assert.equal(nested.nodes.has('brand:/en/nested/x.html'), false);
  });

  it('walks descendants and ancestors', () => {
    const [home] = tree.top;
    assert.equal(descendants(home).length, 4);
    const leaf = tree.nodes.get('brand:/fr-be/index.html');
    assert.deepEqual(ancestors(tree.nodes, leaf).map((node) => node.key), ['brand:/fr/index.html', 'brand:/en/index.html']);
  });
});

describe('rows and filters', () => {
  const tree = buildPageTree({ model, roots: treeRoots(model, 'brand'), files });
  const results = new Map([
    ['brand:/en/index.html', status('root')],
    ['brand:/fr/index.html', status('translation', ['behind source'])],
    ['brand:/fr-be/index.html', status('local copy', ['needs review'])],
    ['brand:/en/nested/index.html', status('not created')],
    ['shop:/index.html', status('local copy', ['current'])],
    ['brand:/en/about.html', status('root')],
    ['brand:/fr/promo.html', status('standalone')],
    ['brand:/fr-be/promo.html', status('inherited')],
  ]);

  it('flattens only expanded rows with aria positions', () => {
    const collapsed = flattenRows(tree.top, { expanded: new Set() });
    assert.equal(collapsed.length, tree.top.length);
    assert.equal(collapsed[0].posinset, 1);
    assert.equal(collapsed[0].setsize, tree.top.length);
    const open = flattenRows(tree.top, { expanded: new Set(['brand:/en/index.html']) });
    assert.equal(open.length, tree.top.length + 3);
    assert.equal(open[1].level, 2);
    assert.equal(open[0].expanded, true);
  });

  it('keeps ancestors of matches visible', () => {
    const { visible, matches } = visibleSet(tree, (node) => node.key === 'brand:/fr-be/index.html');
    assert.deepEqual([...matches], ['brand:/fr-be/index.html']);
    assert.ok(visible.has('brand:/fr/index.html'));
    assert.ok(visible.has('brand:/en/index.html'));
    const rows = flattenRows(tree.top, { expanded: new Set(), visible, forceExpand: true });
    assert.deepEqual(rows.map((row) => row.node.key), ['brand:/en/index.html', 'brand:/fr/index.html', 'brand:/fr-be/index.html']);
  });

  it('rolls up descendants that need action', () => {
    const summary = rollup(tree.top[0], results);
    assert.deepEqual(summary, { needsAction: 2, worst: 'needs review' });
    assert.deepEqual(
      attentionList(tree.top[0], results).map((node) => node.key),
      ['brand:/fr-be/index.html', 'brand:/fr/index.html'],
    );
  });

  it('counts pages by type and kind', () => {
    const counts = countPages(tree, results);
    assert.equal(counts.all, 7);
    assert.equal(counts.source, 2);
    assert.equal(counts.copies, 3);
    assert.equal(counts.inherited, 1);
    assert.equal(counts.independent, 1);
    assert.equal(counts.needsAction, 2);
    assert.equal(countPages(tree, results, 'variation').all, 1);
  });

  it('matches kind and query', () => {
    const shop = tree.nodes.get('shop:/index.html');
    assert.equal(shop.location.kind, 'variation');
    assert.equal(matchesKind(shop, 'variation'), true);
    assert.equal(matchesKind(shop, 'localization'), false);
    assert.equal(matchesKind(tree.top[0], 'localization'), true);
    assert.equal(matchesQuery(shop, 'SHOP'), true);
    assert.equal(matchesQuery(shop, 'fr-be'), false);
    assert.equal(matchesQuery(shop, ''), true);
  });
});
