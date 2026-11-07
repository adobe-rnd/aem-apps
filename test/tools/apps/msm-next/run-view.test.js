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
  viewStates, runProgress, runStatus, canRetry, translatingItems, summaryChips, groupRun,
  itemNotes, runTitle, mergeRuns,
} from '../../../../tools/apps/msm-next/data/run-view.js';

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
    const progress = runProgress(run);
    assert.deepEqual(
      [progress.total, progress.settled, progress.translating, progress.problems],
      [5, 2, 3, 1],
    );
    assert.equal(runStatus(run).key, 'attention');
    assert.equal(runStatus(run, true).key, 'running');
    const waiting = { items: run.items.slice(0, 4) };
    assert.equal(runStatus(waiting).key, 'waiting');
    assert.equal(canRetry(waiting), false);
    assert.equal(canRetry(run), true);
    assert.equal(runStatus({ items: [item('a', 'done')] }).key, 'done');
    assert.equal(translatingItems(run).length, 1);
  });

  it('summarizes and groups by depth and location', () => {
    assert.deepEqual(summaryChips(run).map((chip) => `${chip.count} ${chip.state}`), [
      '1 done', '1 translating', '1 failed', '2 waiting',
    ]);
    const groups = groupRun(run, { levelOf: (id) => (id === 's:/fr' ? 'Language' : 'Locale') });
    assert.deepEqual(groups.map((group) => `${group.depth}:${group.label}`), [
      '1:Language · Locale', '2:Locale', '3:Locale',
    ]);
    assert.equal(groups[1].locations[0].items[0].viewState, 'waiting');
    assert.equal(run.items[1].viewState, undefined);
  });

  it('describes notes and titles', () => {
    assert.deepEqual(itemNotes(run.items[1]).map((note) => note.text), ['Waits for its source page to be translated']);
    assert.deepEqual(itemNotes({ error: 'boom', warnings: ['onComplete-failed'] }).map((note) => note.tone), ['negative', 'notice']);
    assert.equal(runTitle(run), 'Update /en/a');
    assert.equal(runTitle({ ...run, title: 'Launch' }), 'Launch');
  });

  it('merges live runs over listed runs, newest first', () => {
    const older = { id: 'a', createdAt: '2026-01-01T00:00:00Z', items: [] };
    const listed = { id: 'r1', createdAt: run.createdAt, items: [] };
    const merged = mergeRuns([run], [older, listed]);
    assert.deepEqual(merged.map((each) => each.id), ['r1', 'a']);
    assert.equal(merged[0], run);
  });
});
