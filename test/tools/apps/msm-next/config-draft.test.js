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
  toDraft, toRows, isDirty, isBlank, newRow, copyRow, setValue, toggleAction, setConflict,
  conflictOf, validateDraft, sourceOptions,
} from '../../../../tools/apps/msm-next/data/config-draft.js';

const ROWS = [
  {
    path: '/global', language: 'en', label: 'Global', level: 'Global', note: 'keep me',
  },
  {
    Path: '/fr', Language: 'fr', Source: '/global', Actions: 'translate', 'Missing Pages': 'none',
  },
];

describe('config draft: round trip', () => {
  it('normalizes headers, keeps unknown columns and fills known ones', () => {
    const rows = toRows(toDraft(ROWS));
    assert.equal(rows[0].note, 'keep me');
    assert.equal(rows[1].path, '/fr');
    assert.equal(rows[1].missingPages, 'none');
    assert.equal(rows[1].translationProvider, '');
    assert.equal(rows[1].Path, undefined);
  });

  it('is not dirty until a value changes', () => {
    const draft = toDraft(ROWS);
    assert.equal(isDirty(draft, ROWS), false);
    const changed = [draft[0], setValue(draft[1], 'label', 'French')];
    assert.equal(isDirty(changed, ROWS), true);
  });

  it('detects blank rows', () => {
    assert.equal(isBlank(toDraft([{ path: '', language: '' }])[0]), true);
    assert.equal(isBlank(toDraft(ROWS)[0]), false);
  });
});

describe('config draft: editing', () => {
  it('clears relationship settings when the source is removed', () => {
    const [, fr] = toDraft(ROWS);
    const root = setValue(setValue(fr, 'onComplete', 'publish'), 'source', '');
    assert.equal(root.values.actions, '');
    assert.equal(root.values.onComplete, '');
  });

  it('toggles actions in canonical order', () => {
    const [, fr] = toDraft(ROWS);
    const next = toggleAction(toggleAction(fr, 'link', true), 'rollout', true);
    assert.equal(next.values.actions, 'link, rollout, translate');
    assert.equal(toggleAction(next, 'translate', false).values.actions, 'link, rollout');
  });

  it('writes the conflict default first', () => {
    const [, fr] = toDraft(ROWS);
    const next = setConflict(fr, { first: 'overwrite', both: true });
    assert.equal(next.values.conflictBehavior, 'overwrite, merge');
    assert.deepEqual(conflictOf(next), { first: 'overwrite', both: true });
    assert.equal(setConflict(next, { first: 'merge', both: false }).values.conflictBehavior, 'merge');
  });

  it('creates rows with a unique path and a child default', () => {
    const draft = toDraft(ROWS);
    const first = newRow(draft, { source: '/fr', language: 'fr' });
    const second = newRow([...draft, first]);
    assert.notEqual(first.values.path, second.values.path);
    assert.equal(first.values.actions, 'rollout');
    assert.equal(second.values.actions, '');
  });

  it('copies a row under a new path and uid', () => {
    const draft = toDraft(ROWS);
    const copy = copyRow(draft, draft[1]);
    assert.notEqual(copy.uid, draft[1].uid);
    assert.notEqual(copy.values.path, '/fr');
    assert.equal(copy.values.source, '/global');
  });
});

describe('config draft: validation', () => {
  it('reports no issues for a valid draft', () => {
    const result = validateDraft({ site: 'brand', draft: toDraft(ROWS) });
    assert.equal(result.errors.length, 0);
  });

  it('maps row issues to the draft row', () => {
    const draft = toDraft(ROWS);
    const broken = [draft[0], setValue(draft[1], 'language', 'not a language')];
    const result = validateDraft({ site: 'brand', draft: broken });
    assert.ok(result.errors.length);
    assert.ok(result.byUid.get(broken[1].uid).some((issue) => issue.code === 'invalid-language'));
  });

  it('maps graph issues to the row by id', () => {
    const draft = toDraft(ROWS);
    const broken = [draft[0], setValue(draft[1], 'source', '/missing')];
    const result = validateDraft({ site: 'brand', draft: broken });
    assert.ok(result.byUid.get(broken[1].uid).some((issue) => issue.code === 'unknown-source'));
  });

  it('flags duplicate paths', () => {
    const draft = toDraft(ROWS);
    const dup = [...draft, { ...copyRow(draft, draft[1]), values: { ...draft[1].values } }];
    const result = validateDraft({ site: 'brand', draft: dup });
    assert.ok(result.errors.some((issue) => issue.code === 'duplicate-location'));
  });

  it('ignores issues of other sites', () => {
    const sites = { other: [{ path: '/x', language: 'en', source: '/nope' }] };
    const result = validateDraft({ site: 'brand', draft: toDraft(ROWS), sites });
    assert.equal(result.errors.length, 0);
  });
});

describe('config draft: source options', () => {
  it('lists own rows as paths and other sites as site:path, without the row itself', () => {
    const draft = toDraft(ROWS);
    const options = sourceOptions({
      site: 'brand',
      draft,
      sites: { retail: [{ path: '/pm', language: 'en' }] },
      row: draft[1],
    });
    assert.deepEqual(options.map((option) => option.value), ['/global', 'retail:/pm']);
  });
});
