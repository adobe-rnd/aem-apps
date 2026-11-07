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
  buildTargetTree, toggleTarget, impliedIds, effectiveTargets, targetState, levelGroups,
  setMany, groupState, filterTargets, kindSections, flattenSection, locationDepth,
} from '../../../../tools/apps/msm-next/data/targets.js';

const model = parseConfig({
  sites: {
    brand: [
      { path: '/global', language: 'en', level: 'Global' },
      {
        path: '/emea', language: 'en', level: 'Region', source: '/global', actions: 'rollout',
      },
      {
        path: '/fr', language: 'fr', level: 'Language', source: '/emea', actions: 'translate',
      },
      {
        path: '/fr-be', language: 'fr-BE', level: 'Locale', source: '/fr', actions: 'rollout',
      },
      {
        path: '/fr-fr', language: 'fr-FR', source: '/fr', actions: 'rollout',
      },
      {
        path: '/de', language: 'de', level: 'Language', source: '/emea', actions: 'translate',
      },
    ],
    shop: [
      {
        path: '/', language: 'fr-FR', level: 'Retailer', source: 'brand:/fr-fr', actions: 'rollout',
      },
    ],
  },
});

const tree = buildTargetTree(model, ['brand:/global']);

describe('target tree', () => {
  it('lists descendant locations with levels and depth fallback', () => {
    assert.deepEqual(tree.roots, ['brand:/emea']);
    assert.equal(tree.nodes.size, 6);
    assert.equal(tree.nodes.get('brand:/fr').level, 'Language');
    assert.equal(tree.nodes.get('brand:/fr-fr').level, 'Level 4');
    assert.equal(locationDepth(model, model.locations.get('shop:/')), 4);
    assert.deepEqual(tree.nodes.get('brand:/fr').children, ['brand:/fr-be', 'brand:/fr-fr']);
  });

  it('merges nested source locations into one tree', () => {
    const merged = buildTargetTree(model, ['brand:/fr', 'brand:/global']);
    assert.deepEqual(merged.roots, ['brand:/emea']);
    assert.equal(merged.nodes.size, 6);
  });

  it('checks descendants and implies ancestors', () => {
    const checked = toggleTarget(tree, new Set(), 'brand:/fr', true);
    assert.deepEqual([...checked].sort(), ['brand:/fr', 'brand:/fr-be', 'brand:/fr-fr', 'shop:/']);
    const deep = toggleTarget(tree, new Set(), 'brand:/fr-be', true);
    assert.deepEqual([...impliedIds(tree, deep)].sort(), ['brand:/emea', 'brand:/fr']);
    assert.equal(targetState(deep, impliedIds(tree, deep), 'brand:/fr'), 'implied');
    assert.equal(targetState(deep, impliedIds(tree, deep), 'brand:/fr-be'), 'checked');
    assert.equal(targetState(deep, impliedIds(tree, deep), 'brand:/de'), 'unchecked');
    assert.equal(effectiveTargets(tree, deep).size, 3);
    const unchecked = toggleTarget(tree, checked, 'brand:/fr-fr', false);
    assert.deepEqual([...unchecked].sort(), ['brand:/fr', 'brand:/fr-be']);
  });

  it('groups by level for quick toggles', () => {
    const groups = levelGroups(tree);
    assert.deepEqual(groups.map((group) => group.label), ['Region', 'Language', 'Locale', 'Level 4', 'Retailer']);
    const languages = groups[1].ids;
    const selected = setMany(new Set(), languages, true);
    assert.equal(groupState(selected, languages), 'all');
    assert.equal(groupState(new Set(['brand:/fr']), languages), 'some');
    assert.equal(groupState(setMany(selected, languages, false), languages), 'none');
  });

  it('filters by query keeping ancestors', () => {
    assert.equal(filterTargets(tree, ''), null);
    assert.deepEqual([...filterTargets(tree, 'fr-be')].sort(), ['brand:/emea', 'brand:/fr', 'brand:/fr-be']);
  });

  it('splits localization and variations', () => {
    const sections = kindSections(tree);
    assert.deepEqual(sections.map((section) => section.kind), ['localization', 'variation']);
    assert.deepEqual(sections[1].roots, ['shop:/']);
    const rows = flattenSection(sections[0]);
    assert.deepEqual(rows.map((row) => `${row.id}@${row.indent}`), [
      'brand:/emea@0', 'brand:/fr@1', 'brand:/fr-be@2', 'brand:/fr-fr@2', 'brand:/de@1',
    ]);
    assert.equal(flattenSection(sections[0], new Set(['brand:/emea'])).length, 1);
  });
});
