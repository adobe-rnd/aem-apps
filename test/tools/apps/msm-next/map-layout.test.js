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
  layoutMap, toggleCollapse, fitView, fitWidth, zoomView, MAP_SIZES,
} from '../../../../tools/apps/msm-next/data/map-layout.js';

const loc = (level) => ({ level, language: 'en', label: level });
const node = (key, depth, parent, children = [], level = `L${depth}`) => ({
  key, depth, parent, children, location: loc(level),
});

const leafA = node('a1', 2, 'a');
const leafB = node('a2', 2, 'a');
const midA = node('a', 1, 'root', [leafA, leafB]);
const solo = node('b', 1, 'root', [], 'L1x');
const root = node('root', 0, null, [midA, solo]);
const other = node('root2', 0, null, [node('c', 1, 'root2')]);

const status = (relationship, sync = []) => ({ status: { relationship, sync }, actions: [] });
const results = new Map([
  ['a', status('local copy', ['current'])],
  ['a1', status('local copy', ['behind source'])],
  ['a2', status('inherited')],
  ['b', status('unlinked')],
  ['c', status('local copy', ['current'])],
]);

describe('map layout', () => {
  it('places nodes in depth columns and centers parents', () => {
    const layout = layoutMap([root], results, { showIndependent: true });
    const at = (key) => layout.byKey.get(key);
    assert.equal(at('a1').x, MAP_SIZES.padding + 2 * MAP_SIZES.colWidth);
    assert.equal(at('a').y, (at('a1').y + at('a2').y) / 2);
    assert.ok(at('b').y > at('a2').y);
    assert.deepEqual(layout.columns.map((column) => column.label), ['L0', 'L1 / L1x', 'L2']);
    assert.equal(layout.edges.length, 3);
    assert.ok(!layout.edges.some((edge) => edge.to === 'b'));
    assert.ok(at('b').independent);
    assert.ok(layout.width > 0 && layout.height > 0);
  });

  it('hides independent pages unless asked', () => {
    const layout = layoutMap([root], results, {});
    assert.equal(layout.byKey.has('b'), false);
  });

  it('filters to needs action and stacks roots', () => {
    const layout = layoutMap([root, other], results, { needsActionOnly: true });
    assert.deepEqual(layout.nodes.map((entry) => entry.key).sort(), ['a', 'a1', 'root']);
    const both = layoutMap([root, other], results, {});
    assert.ok(both.byKey.get('root2').y > both.byKey.get('a2').y);
  });

  it('collapses nodes and the deepest level', () => {
    const collapsed = layoutMap([root], results, { collapsed: new Set(['a']) });
    assert.equal(collapsed.byKey.has('a1'), false);
    assert.equal(collapsed.byKey.get('a').hidden, 2);
    const locales = layoutMap([root], results, { collapseLocales: true });
    assert.equal(locales.byKey.get('a').collapsed, true);
    assert.equal(locales.byKey.get('root').collapsed, false);
    const reopened = layoutMap([root], results, { collapseLocales: true, expanded: new Set(['a']) });
    assert.equal(reopened.byKey.has('a1'), true);
    const state = toggleCollapse({ collapsed: new Set(), expanded: new Set() }, 'a', true);
    assert.deepEqual([[...state.collapsed], [...state.expanded]], [[], ['a']]);
    const again = toggleCollapse(state, 'a', false);
    assert.deepEqual([[...again.collapsed], [...again.expanded]], [['a'], []]);
  });

  it('fits and zooms the view', () => {
    const layout = { width: 1000, height: 2000 };
    assert.deepEqual(fitView(layout, { width: 500, height: 500 }), { x: 125, y: 0, scale: 0.25 });
    assert.equal(fitWidth(layout, { width: 800, height: 500 }).scale, 0.8);
    const zoomed = zoomView({ x: 0, y: 0, scale: 1 }, 2, { x: 100, y: 100 });
    assert.deepEqual(zoomed, { scale: 2, x: -100, y: -100 });
    assert.equal(zoomView({ x: 0, y: 0, scale: 1 }, 100).scale, 2);
  });
});
