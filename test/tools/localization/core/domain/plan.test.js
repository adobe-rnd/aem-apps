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
import planPropagation from '../../../../../tools/localization/core/domain/plan.js';

// g:/global en
// ├── g:/emea en
// │   ├── g:/fr fr
// │   │   └── g:/fr-be fr-BE
// │   └── g:/en-gb en-GB
// └── g:/amer en
//     └── r:/shop en-US (cross-site)
const model = configFromLocationRows([
  locationRow('g', '/global', 'en'),
  locationRow('g', '/emea', 'en', '/global', 'link, rollout', 'linked'),
  locationRow('g', '/fr', 'fr', '/emea', 'rollout, translate', 'none'),
  locationRow('g', '/fr-be', 'fr-BE', '/fr', 'link, rollout', 'linked'),
  locationRow('g', '/en-gb', 'en-GB', '/emea', 'link, rollout', 'linked'),
  locationRow('g', '/amer', 'en', '/global', 'link, rollout', 'linked'),
  locationRow('r', '/shop', 'en-US', 'g:/amer', 'link, rollout', 'linked'),
]);

const brief = (plan) => plan.items.map((item) => `${item.depth} ${item.key} <${item.parent ?? '-'}`);

describe('planPropagation', () => {
  it('covers every descendant location by depth, with parents', () => {
    const plan = planPropagation(model, { pages: [{ site: 'g', path: '/global/x' }] });
    assert.deepEqual(brief(plan), [
      '1 g:/emea/x <-',
      '1 g:/amer/x <-',
      '2 g:/fr/x <g:/emea/x',
      '2 g:/en-gb/x <g:/emea/x',
      '2 r:/shop/x <g:/amer/x',
      '3 g:/fr-be/x <g:/fr/x',
    ]);
    assert.deepEqual(plan.items[0], {
      key: 'g:/emea/x',
      site: 'g',
      path: '/emea/x',
      locationId: 'g:/emea',
      source: { site: 'g', path: '/global/x' },
      parent: null,
      depth: 1,
      state: 'pending',
    });
  });

  it('includes ancestors of selected targets and nothing else', () => {
    const plan = planPropagation(model, {
      pages: [{ site: 'g', path: '/global/x' }],
      targets: ['g:/fr-be'],
    });
    assert.deepEqual(brief(plan), [
      '1 g:/emea/x <-',
      '2 g:/fr/x <g:/emea/x',
      '3 g:/fr-be/x <g:/fr/x',
    ]);
  });

  it('starts below a mid-tree page', () => {
    const plan = planPropagation(model, { pages: [{ site: 'g', path: '/emea/x' }] });
    assert.deepEqual(brief(plan), [
      '1 g:/fr/x <-',
      '1 g:/en-gb/x <-',
      '2 g:/fr-be/x <g:/fr/x',
    ]);
  });

  it('plans several pages at once', () => {
    const plan = planPropagation(model, {
      pages: [{ site: 'g', path: '/global/x' }, { site: 'g', path: '/global/y' }],
      targets: ['g:/amer'],
    });
    assert.deepEqual(brief(plan), ['1 g:/amer/x <-', '1 g:/amer/y <-']);
  });

  it('ignores pages outside any location and targets not below the page', () => {
    const plan = planPropagation(model, {
      pages: [{ site: 'g', path: '/nowhere/x' }, { site: 'g', path: '/emea/x' }],
      targets: ['r:/shop'],
    });
    assert.deepEqual(plan.items, []);
  });
});
