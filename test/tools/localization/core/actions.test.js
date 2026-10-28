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
import { availableActions } from '../../../../tools/localization/core/actions.js';

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

const status = (relationship, sync = [], effectiveSource = sourceRef()) => ({
  relationship, sync, effectiveSource, reasons: [],
});

const byName = (list) => Object.fromEntries(list.map((a) => [a.action, a]));
const names = (list) => list.map((a) => a.action);

describe('availableActions: no actions', () => {
  it('is empty without a status', () => {
    assert.deepEqual(availableActions({ status: null, location: location() }), []);
  });

  ['config error', 'unknown', 'root', 'standalone'].forEach((relationship) => {
    it(`is empty for ${relationship}`, () => {
      const list = availableActions({
        status: status(relationship, [], null),
        location: location(),
      });
      assert.deepEqual(list, []);
    });
  });
});

describe('availableActions: rollout and translate', () => {
  it('offers both on a current local copy with conflict options', () => {
    const a = byName(availableActions({ status: status('local copy', ['current']), location: location() }));
    assert.deepEqual(a.rollout, {
      action: 'rollout', enabled: true, reasons: [], creates: false, options: ['merge', 'overwrite'], default: true,
    });
    assert.deepEqual(a.translate, {
      action: 'translate', enabled: true, reasons: [], creates: false, options: ['merge', 'overwrite'], default: false,
    });
  });

  it('marks translate as default when the base language differs', () => {
    const a = byName(availableActions({
      status: status('translation', ['current']),
      location: location({ language: 'es' }),
    }));
    assert.equal(a.translate.default, true);
    assert.equal(a.rollout.default, false);
  });

  it('marks the only offered action as default', () => {
    const a = byName(availableActions({
      status: status('local copy', ['current']),
      location: location({ language: 'es', actions: ['rollout'] }),
    }));
    assert.equal(a.rollout.default, true);
  });

  it('creates on linked and not created pages, without options', () => {
    ['linked', 'not created'].forEach((relationship) => {
      const a = byName(availableActions({ status: status(relationship), location: location() }));
      assert.equal(a.rollout.creates, true, relationship);
      assert.equal(a.rollout.options, undefined, relationship);
      assert.equal(a.translate.creates, true, relationship);
    });
  });

  it('omits actions not allowed by the location', () => {
    const list = availableActions({
      status: status('local copy', ['current']),
      location: location({ actions: ['rollout'] }),
    });
    assert.deepEqual(names(list), ['rollout']);
  });

  it('disables when the page needs review', () => {
    const a = byName(availableActions({ status: status('local copy', ['needs review', 'current']), location: location() }));
    assert.deepEqual(a.rollout.reasons, ['needs-review']);
    assert.deepEqual(a.translate.reasons, ['needs-review']);
    assert.equal(a.rollout.enabled, false);
  });

  it('disables when the source needs review', () => {
    const a = byName(availableActions({ status: status('linked', ['blocked by source review']), location: location() }));
    assert.deepEqual(a.rollout.reasons, ['source-needs-review']);
    assert.deepEqual(a.translate.reasons, ['source-needs-review']);
  });

  it('disables while a translation is in progress or ready', () => {
    ['translating', 'ready to save'].forEach((sync) => {
      const a = byName(availableActions({ status: status('translation', [sync, 'current']), location: location() }));
      assert.deepEqual(a.rollout.reasons, ['translation-in-progress'], sync);
      assert.deepEqual(a.translate.reasons, ['translation-in-progress'], sync);
    });
  });

  it('disables without an effective source', () => {
    const a = byName(availableActions({ status: status('local copy', ['source deleted'], null), location: location() }));
    assert.deepEqual(a.rollout.reasons, ['no-source']);
    assert.deepEqual(a.translate.reasons, ['no-source']);
  });

  it('disables translate for identical languages', () => {
    const a = byName(availableActions({
      status: status('local copy', ['current'], sourceRef('en-GB')),
      location: location(),
    }));
    assert.deepEqual(a.translate.reasons, ['language-not-translatable']);
    assert.equal(a.rollout.enabled, true);
  });

  it('disables translate when the connector does not support the pair', () => {
    const a = byName(availableActions({
      status: status('local copy', ['current']),
      location: location(),
      translationSupported: false,
    }));
    assert.deepEqual(a.translate.reasons, ['connector-unsupported']);
  });

  it('collects every reason', () => {
    const a = byName(availableActions({
      status: status('local copy', ['needs review', 'source deleted', 'translating'], null),
      location: location(),
      translationSupported: false,
    }));
    assert.deepEqual(a.translate.reasons, ['needs-review', 'translation-in-progress', 'no-source']);
  });
});

describe('availableActions: reconnect', () => {
  it('is offered on local copies in a linked location, destructive', () => {
    const a = byName(availableActions({ status: status('local copy', ['current']), location: location() }));
    assert.deepEqual(a.reconnect, {
      action: 'reconnect', enabled: true, reasons: [], destructive: true,
    });
  });

  it('is offered on translations', () => {
    const a = byName(availableActions({ status: status('translation', ['behind source']), location: location() }));
    assert.ok(a.reconnect);
  });

  it('is not offered without link or in a none location', () => {
    [location({ actions: ['rollout'] }), location({ missingPages: 'none' })].forEach((l) => {
      const list = availableActions({ status: status('local copy', ['current']), location: l });
      assert.ok(!names(list).includes('reconnect'));
    });
  });

  it('is not offered on linked or not created pages', () => {
    ['linked', 'not created'].forEach((relationship) => {
      const list = availableActions({ status: status(relationship), location: location() });
      assert.ok(!names(list).includes('reconnect'), relationship);
    });
  });

  it('is disabled while a translation is in progress', () => {
    const a = byName(availableActions({ status: status('translation', ['translating']), location: location() }));
    assert.deepEqual(a.reconnect.reasons, ['translation-in-progress']);
  });
});

describe('availableActions: save', () => {
  it('is offered when a translation is ready, with options', () => {
    const a = byName(availableActions({ status: status('translation', ['ready to save', 'current']), location: location() }));
    assert.deepEqual(a.save, {
      action: 'save', enabled: true, reasons: [], creates: false, options: ['merge', 'overwrite'],
    });
  });

  it('creates when the page does not exist yet', () => {
    const a = byName(availableActions({ status: status('not created', ['ready to save']), location: location() }));
    assert.equal(a.save.creates, true);
    assert.equal(a.save.options, undefined);
  });

  it('is disabled when the page needs review', () => {
    const a = byName(availableActions({ status: status('translation', ['needs review', 'ready to save']), location: location() }));
    assert.deepEqual(a.save.reasons, ['needs-review']);
  });

  it('is not offered otherwise', () => {
    const list = availableActions({ status: status('translation', ['translating']), location: location() });
    assert.ok(!names(list).includes('save'));
  });

  it('is offered on standalone pages with a ready job', () => {
    const list = availableActions({ status: status('standalone', ['ready to save'], null), location: location() });
    assert.deepEqual(names(list), ['save']);
  });
});
