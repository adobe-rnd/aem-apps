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
  viewStates, rolloutProgress, rolloutStatus, canRetry, translatingItems, summaryChips,
  groupRollout, itemNotes, rolloutTitle, mergeRollouts, canCancel, canArchive, isArchived,
  needsMe, visibleRollouts, itemState,
} from '../../../../tools/apps/msm-next/data/rollout-view.js';

const item = (key, state, extra = {}) => ({
  key, site: 's', path: `/${key}`, locationId: `s:/${key}`, depth: 1, parent: null, state, ...extra,
});

const run = {
  id: 'r1',
  createdAt: '2026-01-02T00:00:00Z',
  pages: [{ site: 's', path: '/en/a' }],
  items: [
    item('fr', 'translating'),
    item('fr-be', 'blocked', { depth: 2, parent: 'fr', reasons: ['parent:translating'] }),
    item('fr-be-x', 'blocked', { depth: 3, parent: 'fr-be', reasons: ['parent:blocked'] }),
    item('uk', 'done'),
    item('uk-x', 'failed', { depth: 2, parent: 'uk', error: 'boom' }),
  ],
};

describe('run view', () => {
  it('shows items blocked by a translation as waiting', () => {
    const states = viewStates(run);
    assert.equal(states.get('fr-be'), 'waiting');
    assert.equal(states.get('fr-be-x'), 'waiting');
    assert.equal(states.get('uk-x'), 'failed');
  });

  it('computes progress and status', () => {
    const progress = rolloutProgress(run);
    assert.deepEqual(
      [progress.total, progress.settled, progress.translating, progress.problems],
      [5, 2, 3, 1],
    );
    assert.equal(rolloutStatus(run).key, 'attention');
    assert.equal(rolloutStatus(run, true).key, 'running');
    const waiting = { items: run.items.slice(0, 4) };
    assert.equal(rolloutStatus(waiting).key, 'waiting');
    assert.equal(canRetry(waiting), false);
    assert.equal(canRetry(run), true);
    assert.equal(rolloutStatus({ items: [item('a', 'done')] }).key, 'done');
    assert.equal(translatingItems(run).length, 1);
  });

  it('summarizes and groups by depth and location', () => {
    assert.deepEqual(summaryChips(run).map((chip) => `${chip.count} ${chip.state}`), [
      '1 done', '1 translating', '1 failed', '2 waiting',
    ]);
    const groups = groupRollout(run, { levelOf: (id) => (id === 's:/fr' ? 'Language' : 'Locale') });
    assert.deepEqual(groups.map((group) => `${group.depth}:${group.label}`), [
      '1:Language · Locale', '2:Locale', '3:Locale',
    ]);
    assert.equal(groups[1].locations[0].items[0].viewState, 'waiting');
    assert.equal(run.items[1].viewState, undefined);
  });

  it('describes notes and titles', () => {
    assert.deepEqual(itemNotes(run.items[1]).map((note) => note.text), ['Waits for its source page to be translated']);
    assert.deepEqual(itemNotes({ error: 'boom', warnings: ['onComplete-failed'] }).map((note) => note.tone), ['negative', 'notice']);
    assert.equal(rolloutTitle(run), 'Update /en/a');
    assert.equal(rolloutTitle({ ...run, title: 'Launch' }), 'Launch');
  });

  it('handles cancelled and archived rollouts', () => {
    const cancelled = {
      id: 'c',
      cancelledAt: '2026-01-03T00:00:00Z',
      items: [item('a', 'done'), item('b', 'cancelled'), item('c', 'cancelled', { parent: 'b' })],
    };
    assert.equal(rolloutStatus(cancelled).key, 'cancelled');
    assert.equal(rolloutStatus(cancelled).label, 'Cancelled');
    assert.equal(itemState('cancelled').label, 'Cancelled');
    assert.equal(canRetry(cancelled), false);
    assert.equal(canCancel(cancelled), false);
    assert.equal(canArchive(cancelled), true);
    assert.equal(canArchive(run), true);
    assert.equal(canArchive({ items: run.items.slice(0, 4) }), false);
    assert.equal(canCancel({ items: run.items.slice(0, 4) }), true);
    assert.equal(canCancel({ items: run.items.slice(0, 4) }, true), false);
    assert.equal(canCancel({ items: [item('a', 'pending')] }), true);
    assert.equal(canArchive({ items: [item('a', 'pending')] }), false);
    assert.equal(isArchived({ archivedAt: 'x' }), true);
    assert.equal(isArchived(run), false);
    assert.equal(needsMe({ ...run, archivedAt: 'x' }), false);
    assert.equal(needsMe(cancelled), false);
    assert.equal(needsMe(run), true);
  });

  it('lists attention first, then in progress, hiding finished ones by default', () => {
    const make = (id, createdAt, items, extra = {}) => ({
      id, createdAt, items, ...extra,
    });
    const rollouts = [
      make('old-attention', '2026-01-01T00:00:00Z', [item('x', 'failed')]),
      make('new-progress', '2026-01-05T00:00:00Z', [item('x', 'translating')]),
      make('new-done', '2026-01-06T00:00:00Z', [item('x', 'done')]),
      make('new-attention', '2026-01-04T00:00:00Z', [item('x', 'needs review')]),
      make('archived', '2026-01-07T00:00:00Z', [item('x', 'failed')], { archivedAt: 'x' }),
      make('cancelled', '2026-01-08T00:00:00Z', [item('x', 'cancelled')], { cancelledAt: 'x' }),
    ];
    const ids = (list) => list.map((each) => each.id);
    assert.deepEqual(ids(visibleRollouts(rollouts)), ['new-attention', 'old-attention', 'new-progress']);
    assert.deepEqual(ids(visibleRollouts(rollouts, { busyIds: new Set(['new-done']) })), [
      'new-attention', 'old-attention', 'new-done', 'new-progress',
    ]);
    assert.deepEqual(ids(visibleRollouts(rollouts, { keepId: 'new-done' })), [
      'new-attention', 'old-attention', 'new-progress', 'new-done',
    ]);
    assert.deepEqual(ids(visibleRollouts(rollouts, { showCompleted: true })), [
      'new-attention', 'old-attention', 'new-progress', 'cancelled', 'archived', 'new-done',
    ]);
  });

  it('merges live runs over listed runs, newest first', () => {
    const older = { id: 'a', createdAt: '2026-01-01T00:00:00Z', items: [] };
    const listed = { id: 'r1', createdAt: run.createdAt, items: [] };
    const merged = mergeRollouts([run], [older, listed]);
    assert.deepEqual(merged.map((each) => each.id), ['r1', 'a']);
    assert.equal(merged[0], run);
  });
});
