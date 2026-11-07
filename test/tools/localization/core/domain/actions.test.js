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
import { availableActions } from '../../../../../tools/localization/core/domain/actions.js';

const location = (overrides = {}) => ({
  id: 'global:/uk',
  language: 'en-GB',
  source: 'global:/en',
  actions: ['link', 'rollout', 'translate'],
  missingPages: 'linked',
  conflictBehavior: ['merge', 'overwrite'],
  valid: true,
  resolved: true,
  ...overrides,
});

const sourceRef = (language = 'en-US') => ({
  site: 'global', path: '/en/x', location: { id: 'global:/en', language },
});

const statusWith = (relationship, sync = [], effectiveSource = sourceRef()) => ({
  relationship, sync, effectiveSource, reasons: [],
});

const actionNames = (actions) => actions.map((entry) => entry.action);

const actionsByName = (status, locationOverrides = {}, options = {}) => Object.fromEntries(
  availableActions({ status, location: location(locationOverrides), ...options })
    .map((entry) => [entry.action, entry]),
);

describe('availableActions: no actions', () => {
  it('is empty without a status', () => {
    assert.deepEqual(availableActions({ status: null, location: location() }), []);
  });

  ['config error', 'unknown', 'root', 'standalone'].forEach((relationship) => {
    it(`is empty for ${relationship}`, () => {
      const actions = availableActions({
        status: statusWith(relationship, [], null),
        location: location(),
      });
      assert.deepEqual(actions, []);
    });
  });
});

describe('availableActions: rollout and translate', () => {
  it('offers both on a current local copy with conflict options', () => {
    const actions = actionsByName(statusWith('local copy', ['current']));
    assert.deepEqual(actions.rollout, {
      action: 'rollout', enabled: true, reasons: [], creates: false, options: ['merge', 'overwrite'], default: true,
    });
    assert.deepEqual(actions.translate, {
      action: 'translate', enabled: true, reasons: [], creates: false, options: ['merge', 'overwrite'], default: false,
    });
  });

  it('marks translate as default when the base language differs', () => {
    const actions = actionsByName(statusWith('translation', ['current']), { language: 'es' });
    assert.equal(actions.translate.default, true);
    assert.equal(actions.rollout.default, false);
  });

  it('marks the only offered action as default', () => {
    const actions = actionsByName(statusWith('local copy', ['current']), { language: 'es', actions: ['rollout'] });
    assert.equal(actions.rollout.default, true);
  });

  it('creates on linked and not created pages, without options', () => {
    ['linked', 'not created'].forEach((relationship) => {
      const actions = actionsByName(statusWith(relationship));
      assert.equal(actions.rollout.creates, true, relationship);
      assert.equal(actions.rollout.options, undefined, relationship);
      assert.equal(actions.translate.creates, true, relationship);
    });
  });

  it('omits actions not allowed by the location', () => {
    const actions = availableActions({
      status: statusWith('local copy', ['current']),
      location: location({ actions: ['rollout'] }),
    });
    assert.deepEqual(actionNames(actions), ['rollout']);
  });

  it('disables when the page needs review', () => {
    const actions = actionsByName(statusWith('local copy', ['needs review', 'current']));
    assert.deepEqual(actions.rollout.reasons, ['needs-review']);
    assert.deepEqual(actions.translate.reasons, ['needs-review']);
    assert.equal(actions.rollout.enabled, false);
  });

  it('disables when the source needs review', () => {
    const actions = actionsByName(statusWith('linked', ['blocked by source review']));
    assert.deepEqual(actions.rollout.reasons, ['source-needs-review']);
    assert.deepEqual(actions.translate.reasons, ['source-needs-review']);
  });

  it('disables while a translation is in progress or ready', () => {
    ['translating', 'ready to save'].forEach((sync) => {
      const actions = actionsByName(statusWith('translation', [sync, 'current']));
      assert.deepEqual(actions.rollout.reasons, ['translation-in-progress'], sync);
      assert.deepEqual(actions.translate.reasons, ['translation-in-progress'], sync);
    });
  });

  it('disables without an effective source', () => {
    const actions = actionsByName(statusWith('local copy', ['source deleted'], null));
    assert.deepEqual(actions.rollout.reasons, ['no-source']);
    assert.deepEqual(actions.translate.reasons, ['no-source']);
  });

  it('disables translate for identical languages', () => {
    const actions = actionsByName(statusWith('local copy', ['current'], sourceRef('en-GB')));
    assert.deepEqual(actions.translate.reasons, ['language-not-translatable']);
    assert.equal(actions.rollout.enabled, true);
  });

  it('disables translate when the connector does not support the pair', () => {
    const actions = actionsByName(statusWith('local copy', ['current']), {}, { translationSupported: false });
    assert.deepEqual(actions.translate.reasons, ['connector-unsupported']);
  });

  it('collects every reason', () => {
    const actions = actionsByName(
      statusWith('local copy', ['needs review', 'source deleted', 'translating'], null),
      {},
      { translationSupported: false },
    );
    assert.deepEqual(actions.translate.reasons, ['needs-review', 'translation-in-progress', 'no-source']);
  });
});

describe('availableActions: reconnect', () => {
  it('is offered on local copies in a linked location, destructive', () => {
    const actions = actionsByName(statusWith('local copy', ['current']));
    assert.deepEqual(actions.reconnect, {
      action: 'reconnect', enabled: true, reasons: [], destructive: true,
    });
  });

  it('is offered on translations', () => {
    assert.ok(actionsByName(statusWith('translation', ['behind source'])).reconnect);
  });

  it('is not offered without link or in a none location', () => {
    [{ actions: ['rollout'] }, { missingPages: 'none' }].forEach((locationOverrides) => {
      const actions = actionsByName(statusWith('local copy', ['current']), locationOverrides);
      assert.equal(actions.reconnect, undefined);
    });
  });

  it('is not offered on linked or not created pages', () => {
    ['linked', 'not created'].forEach((relationship) => {
      assert.equal(actionsByName(statusWith(relationship)).reconnect, undefined, relationship);
    });
  });

  it('is disabled while a translation is in progress', () => {
    const actions = actionsByName(statusWith('translation', ['translating']));
    assert.deepEqual(actions.reconnect.reasons, ['translation-in-progress']);
  });
});

describe('availableActions: save', () => {
  it('is offered when a translation is ready, with options', () => {
    const actions = actionsByName(statusWith('translation', ['ready to save', 'current']));
    assert.deepEqual(actions.save, {
      action: 'save', enabled: true, reasons: [], creates: false, options: ['merge', 'overwrite'],
    });
  });

  it('creates when the page does not exist yet', () => {
    const actions = actionsByName(statusWith('not created', ['ready to save']));
    assert.equal(actions.save.creates, true);
    assert.equal(actions.save.options, undefined);
  });

  it('is disabled when the page needs review', () => {
    const actions = actionsByName(statusWith('translation', ['needs review', 'ready to save']));
    assert.deepEqual(actions.save.reasons, ['needs-review']);
  });

  it('is not offered otherwise', () => {
    assert.equal(actionsByName(statusWith('translation', ['translating'])).save, undefined);
  });

  it('is offered on standalone pages with a ready job', () => {
    const actions = availableActions({
      status: statusWith('standalone', ['ready to save'], null),
      location: location(),
    });
    assert.deepEqual(actionNames(actions), ['save']);
  });
});

describe('availableActions: backend', () => {
  const ready = () => statusWith('translation', ['ready to save', 'current']);

  it('disables copy actions on an unsupported backend, keeping reconnect', () => {
    const actions = actionsByName(statusWith('local copy', ['current']), {}, { backendSupported: false });
    assert.deepEqual(actions.rollout.reasons, ['backend-unsupported']);
    assert.deepEqual(actions.translate.reasons, ['backend-unsupported']);
    assert.equal(actions.reconnect.enabled, true);
    assert.deepEqual(actionsByName(ready(), {}, { backendSupported: false }).save.reasons, ['backend-unsupported']);
  });

  it('disables copy actions without a copy engine, keeping reconnect', () => {
    const actions = actionsByName(statusWith('local copy', ['current']), {}, { copyEngineAvailable: false });
    assert.deepEqual(actions.rollout.reasons, ['copy-engine-unavailable']);
    assert.deepEqual(actions.translate.reasons, ['copy-engine-unavailable']);
    assert.equal(actions.reconnect.enabled, true);
    assert.deepEqual(actionsByName(ready(), {}, { copyEngineAvailable: false }).save.reasons, ['copy-engine-unavailable']);
  });

  it('lists backend reasons after language reasons and before page blockers', () => {
    const actions = actionsByName(
      statusWith('translation', ['needs review']),
      { language: 'en-US' },
      { backendSupported: false, copyEngineAvailable: false },
    );
    assert.deepEqual(actions.translate.reasons, [
      'language-not-translatable', 'backend-unsupported', 'copy-engine-unavailable', 'needs-review',
    ]);
  });
});
