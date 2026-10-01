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
import { createDraft, NO_SCHEMAS_MESSAGE } from '../../../../tools/apps/graphql/utils/endpoint.js';
import { getSaveState, isDirty, selectSchemas } from '../../../../tools/apps/graphql/gql-endpoint/helpers/draft.js';

describe('draft', () => {
  it('creates, toggles and compares drafts', () => {
    const config = { name: 'main', schemas: ['b'] };
    const draft = createDraft({ config });
    assert.deepEqual(draft, { name: 'main', schemas: ['b'], isNew: false });
    assert.equal(isDirty({ draft, config }), false);
    const toggled = selectSchemas({ draft, ids: ['a'], selected: true });
    assert.deepEqual(toggled.schemas, ['a', 'b']);
    assert.equal(isDirty({ draft: toggled, config }), true);
    assert.deepEqual(selectSchemas({ draft: toggled, ids: ['b'], selected: false }).schemas, ['a']);
    assert.equal(isDirty({ draft: undefined, config }), false);
    assert.equal(isDirty({ draft: createDraft({ name: 'new' }), config: undefined }), true);
  });

  it('decides whether Save is enabled and why not', () => {
    const saved = { name: 'main', isNew: false };
    const fresh = { name: '', isNew: true };
    const enabled = { canSave: true, hint: undefined };
    assert.deepEqual(getSaveState({ draft: saved }), enabled);
    assert.deepEqual(getSaveState({ draft: saved, dirty: true }), enabled);
    assert.equal(getSaveState({ draft: saved, dirty: true, busy: true }).canSave, false);
    assert.deepEqual(getSaveState({ draft: saved, dirty: true, blocker: 'Fix it.' }), { canSave: false, hint: 'Fix it.' });
    assert.deepEqual(getSaveState({ draft: saved, blocker: 'Fix it.' }), { canSave: false, hint: undefined });
    assert.deepEqual(getSaveState({ draft: fresh, blocker: 'Select a schema.' }), { canSave: false, hint: 'Select a schema.' });
    assert.deepEqual(
      getSaveState({ draft: fresh, blocker: NO_SCHEMAS_MESSAGE }),
      { canSave: false, hint: undefined },
    );
  });

  it('selects and clears several schemas at once', () => {
    const draft = { ...createDraft(), schemas: ['b'] };
    const all = selectSchemas({ draft, ids: ['c', 'a', 'b'], selected: true });
    assert.deepEqual(all.schemas, ['a', 'b', 'c']);
    assert.deepEqual(selectSchemas({ draft: all, ids: ['a', 'c'], selected: false }).schemas, ['b']);
    assert.deepEqual(draft.schemas, ['b']);
  });
});
