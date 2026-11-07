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
  predictOutcome, chainOutcome, planPreview, countOutcomes, byLocation, outcomeChips,
  summaryText, primaryLabel,
} from '../../../../tools/apps/msm-next/data/plan-preview.js';

const result = (relationship, sync = [], actions = []) => ({
  status: { relationship, sync }, actions,
});
const rollout = (extra = {}) => ({
  action: 'rollout', enabled: true, default: true, ...extra,
});
const translate = (extra = {}) => ({
  action: 'translate', enabled: true, default: true, ...extra,
});

const node = (key, locationId, children = []) => ({ key, location: { id: locationId }, children });

describe('predictOutcome', () => {
  it('maps page states to outcomes', () => {
    assert.equal(predictOutcome(undefined).outcome, 'unknown');
    assert.equal(predictOutcome({ status: null }).outcome, 'skip');
    assert.equal(predictOutcome(result('inherited', [], [rollout()])).outcome, 'inherited');
    assert.equal(predictOutcome(result('unlinked')).outcome, 'skip');
    assert.equal(predictOutcome(result('not created', ['translating'], [translate({ enabled: false })])).outcome, 'in progress');
    assert.equal(predictOutcome(result('local copy', ['current'], [rollout()])).outcome, 'up to date');
    assert.deepEqual(predictOutcome(result('local copy', ['behind source'], [rollout()])), { outcome: 'update', action: 'rollout' });
    assert.deepEqual(predictOutcome(result('not created', [], [translate()])), { outcome: 'create', action: 'translate' });
    assert.deepEqual(predictOutcome(result('not created', [], [{ action: 'link', enabled: true }])), { outcome: 'create', action: 'link' });
    assert.equal(predictOutcome(result('not created', [], [])).outcome, 'skip');
    const blocked = predictOutcome(result('local copy', ['needs review'], [rollout({ enabled: false, reasons: ['needs-review'] })]));
    assert.deepEqual(blocked, { outcome: 'blocked', action: 'rollout', reasons: ['needs-review'] });
  });

  it('chains parent outcomes', () => {
    const own = { outcome: 'update', action: 'rollout' };
    assert.equal(chainOutcome(own, null), own);
    assert.equal(chainOutcome(own, { outcome: 'blocked' }).outcome, 'blocked');
    assert.equal(chainOutcome(own, { outcome: 'skip' }).outcome, 'blocked');
    assert.equal(chainOutcome(own, { outcome: 'create', action: 'translate' }).outcome, 'waiting');
    assert.equal(chainOutcome(own, { outcome: 'in progress' }).outcome, 'waiting');
    assert.equal(chainOutcome(own, { outcome: 'up to date' }), own);
  });
});

describe('planPreview', () => {
  const leaf = node('s:/fr-be/a', 's:/fr-be');
  const fr = node('s:/fr/a', 's:/fr', [leaf]);
  const uk = node('s:/uk/a', 's:/uk');
  const source = node('s:/en/a', 's:/en', [fr, uk]);
  const results = new Map([
    ['s:/fr/a', result('not created', [], [translate()])],
    ['s:/fr-be/a', result('inherited')],
    ['s:/uk/a', result('local copy', ['behind source'], [rollout()])],
  ]);

  it('plans all descendants or only targets', () => {
    const all = planPreview([source], null, results);
    assert.deepEqual(all.map((item) => `${item.key}:${item.outcome}`), [
      's:/fr/a:create', 's:/fr-be/a:waiting', 's:/uk/a:update',
    ]);
    const some = planPreview([source], new Set(['s:/uk']), results);
    assert.deepEqual(some.map((item) => item.key), ['s:/uk/a']);
  });

  it('counts and words the summary', () => {
    const counts = countOutcomes(planPreview([source], null, results));
    assert.equal(counts.total, 3);
    assert.equal(counts.translate, 1);
    assert.equal(summaryText(counts), 'Update 1 page, create 1, 1 by translation, 1 after translation.');
    assert.equal(primaryLabel(counts), 'Update and create 2 pages');
    assert.equal(primaryLabel(countOutcomes([])), 'Start run');
    assert.equal(summaryText(countOutcomes([])), 'Nothing to do for these targets.');
    assert.equal(summaryText({ ...countOutcomes([]), create: 2 }), 'Create 2 pages.');
    assert.equal(primaryLabel({ ...countOutcomes([]), update: 1 }), 'Update 1 page');
  });

  it('groups counts by location', () => {
    const perLocation = byLocation(planPreview([source], null, results));
    assert.equal(perLocation.get('s:/uk').update, 1);
    assert.deepEqual(outcomeChips(perLocation.get('s:/fr')).map((chip) => chip.label), ['Create']);
  });
});
