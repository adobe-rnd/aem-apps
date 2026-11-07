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
  publishNotice, pageType, syncBadges, needsAction, urgencyRank, nextStep, actionButtons, editUrl,
  pageTitle, levelLabel, formatRelative, reasonText, refLabel, typeGroup, isRealPage,
} from '../../../../tools/apps/msm-next/data/display.js';

const result = (relationship, sync = [], extra = {}) => ({
  location: { site: 'gamebox' },
  chain: [{ info: {} }],
  status: {
    relationship, sync, overridden: false, effectiveSource: null, ...extra.status,
  },
  actions: extra.actions ?? [],
});

const action = (name, extra = {}) => ({
  action: name, enabled: true, reasons: [], ...extra,
});

describe('pageType', () => {
  it('maps relationships to UI types', () => {
    assert.equal(pageType(result('root')).label, 'Source');
    assert.equal(pageType(result('inherited')).label, 'Inherited');
    assert.equal(pageType(result('local copy')).label, 'Local copy');
    assert.equal(pageType(result('translation')).label, 'Translation');
    assert.equal(pageType(result('not created')).label, 'Not created');
    assert.deepEqual(
      [pageType(result('standalone')).label, pageType(result('standalone')).detail],
      ['Independent', 'Created here'],
    );
  });

  it('describes unlinked pages by their former source', () => {
    const unlinked = result('unlinked');
    unlinked.chain[0].info.overrides = { unlinked: true, unlinkedFrom: 'gamebox:/amer/x.html' };
    assert.equal(pageType(unlinked).label, 'Independent');
    assert.equal(pageType(unlinked).detail, 'Unlinked from /amer/x.html');
    unlinked.chain[0].info.overrides.unlinkedFrom = 'other:/x.html';
    assert.equal(pageType(unlinked).detail, 'Unlinked from other:/x.html');
  });

  it('handles missing status', () => {
    assert.equal(pageType(undefined).label, 'No page');
    assert.equal(typeGroup(result('translation')), 'copies');
    assert.equal(isRealPage(result('not created')), false);
    assert.equal(isRealPage(result('inherited')), true);
  });
});

describe('sync display', () => {
  it('labels sync values', () => {
    const labels = syncBadges(result('local copy', ['needs review', 'behind source', 'current']))
      .map((badge) => badge.label);
    assert.deepEqual(labels, ['Needs review', 'Update available', 'Up to date']);
    assert.equal(syncBadges(result('translation', ['ready to save']))[0].label, 'Ready to save');
    assert.equal(syncBadges(result('local copy', ['blocked by source review']))[0].label, 'Blocked by source review');
    assert.equal(syncBadges(result('local copy', ['source deleted']))[0].label, 'Source deleted');
    assert.equal(syncBadges(result('translation', ['translating']))[0].label, 'Translating');
  });

  it('labels and flags inherited pages that are not published', () => {
    const page = result('inherited', ['not published']);
    assert.deepEqual(syncBadges(page)[0], { sync: 'not published', label: 'Not published', tone: 'notice' });
    assert.equal(needsAction(page), true);
    assert.ok(urgencyRank(page) < urgencyRank(result('inherited')));
    assert.ok(urgencyRank(result('local copy', ['behind source'])) > urgencyRank(page));
  });

  it('explains why an unpublished inherited page needs publishing', () => {
    assert.match(publishNotice(result('inherited', ['not published'])), /not published/i);
    const unpreviewed = result('inherited', ['not published'], { status: { reasons: ['not-previewed'] } });
    assert.match(publishNotice(unpreviewed), /previewed/i);
    assert.equal(publishNotice(result('inherited')), '');
  });

  it('flags pages that need action', () => {
    assert.equal(needsAction(result('local copy', ['behind source'])), true);
    assert.equal(needsAction(result('local copy', ['ready to save'])), true);
    assert.equal(needsAction(result('local copy', ['translating'])), false);
    assert.equal(needsAction(result('local copy', ['blocked by source review'])), false);
    assert.equal(needsAction(result('local copy', ['current'])), false);
    assert.equal(needsAction(undefined), false);
  });

  it('ranks urgency by the most urgent sync', () => {
    const review = urgencyRank(result('local copy', ['needs review']));
    const behind = urgencyRank(result('local copy', ['behind source']));
    const none = urgencyRank(result('inherited'));
    assert.ok(review < behind);
    assert.ok(behind < none);
  });
});

describe('nextStep', () => {
  it('suggests publishing an unpublished inherited page', () => {
    assert.deepEqual(nextStep(result('inherited', ['not published'])), { kind: 'publish', label: 'Publish' });
    assert.equal(nextStep(result('inherited', ['needs review', 'not published'])).kind, 'review');
    assert.equal(nextStep(result('inherited', ['blocked by source review', 'not published'])).kind, 'publish');
  });

  it('prefers review, then save', () => {
    assert.equal(nextStep(result('local copy', ['needs review'])).kind, 'review');
    const ready = result('translation', ['ready to save'], { actions: [action('save')] });
    assert.deepEqual(nextStep(ready), { kind: 'action', action: 'save', label: 'Save' });
  });

  it('offers update only when behind', () => {
    const actions = [action('rollout', { default: true, options: ['merge'] })];
    assert.equal(nextStep(result('local copy', ['current'], { actions })), null);
    assert.equal(nextStep(result('local copy', ['behind source'], { actions })).label, 'Update');
    const translate = [action('translate', { default: true })];
    assert.equal(nextStep(result('translation', ['behind source'], { actions: translate })).action, 'translate');
  });

  it('offers inherit, create or relink', () => {
    const link = [action('rollout', { default: true, creates: true }), action('link')];
    assert.equal(nextStep(result('not created', [], { actions: link })).label, 'Inherit');
    const create = [action('rollout', { default: true, creates: true })];
    assert.equal(nextStep(result('not created', [], { actions: create })).label, 'Create');
    const translate = [action('translate', { default: true, creates: true })];
    assert.equal(nextStep(result('not created', [], { actions: translate })).label, 'Translate');
    assert.equal(nextStep(result('unlinked', [], { actions: [action('relink')] })).label, 'Relink');
  });

  it('skips disabled actions', () => {
    const disabled = [action('rollout', { default: true, enabled: false, reasons: ['no-source'] })];
    assert.equal(nextStep(result('local copy', ['behind source'], { actions: disabled })), null);
  });
});

describe('actionButtons', () => {
  it('splits rollout options and labels actions', () => {
    const buttons = actionButtons(result('local copy', ['current'], {
      actions: [
        action('rollout', { default: true, options: ['merge', 'overwrite'] }),
        action('reconnect', { destructive: true }),
        action('unlink'),
      ],
    }));
    assert.deepEqual(buttons.map((button) => button.label), ['Merge', 'Replace with source', 'Revert to inherited', 'Unlink']);
    assert.deepEqual(buttons.map((button) => button.option), ['merge', 'overwrite', undefined, undefined]);
    assert.equal(buttons[0].primary, true);
    assert.equal(buttons[1].primary, false);
    assert.ok(buttons[2].confirm);
  });

  it('explains disabled actions', () => {
    const [button] = actionButtons(result('local copy', [], {
      actions: [action('relink', { enabled: false, reasons: ['no-source'] })],
    }));
    assert.equal(button.enabled, false);
    assert.equal(button.reason, 'There is no source page');
    assert.equal(reasonText(['custom']), 'custom');
  });

  it('labels creating rollouts', () => {
    const [button] = actionButtons(result('inherited', [], {
      actions: [action('rollout', { creates: true })],
    }));
    assert.equal(button.label, 'Create local copy');
  });
});

describe('formatting helpers', () => {
  it('builds DA editor links without .html', () => {
    assert.equal(editUrl('org', 'gamebox', '/fr/index.html'), 'https://da.live/edit#/org/gamebox/fr/index');
  });

  it('derives page titles', () => {
    assert.equal(pageTitle('/index.html'), 'Home');
    assert.equal(pageTitle('/games/index.html'), 'Games');
    assert.equal(pageTitle('/services/gamebox-plus.html'), 'Gamebox plus');
  });

  it('falls back to depth for level labels', () => {
    assert.equal(levelLabel({ level: 'Region' }, 1), 'Region');
    assert.equal(levelLabel({ level: '' }, 2), 'Level 3');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    assert.equal(formatRelative('2026-11-09T23:59:30Z', now), 'just now');
    assert.equal(formatRelative('2026-11-09T22:00:00Z', now), '2 hours ago');
    assert.equal(formatRelative('2026-11-09T00:00:00Z', now), '1 day ago');
    assert.equal(formatRelative(undefined, now), '');
  });

  it('labels refs relative to a site', () => {
    assert.equal(refLabel({ site: 'a', path: '/x.html' }, 'a'), '/x.html');
    assert.equal(refLabel({ site: 'b', path: '/x.html' }, 'a'), 'b:/x.html');
    assert.equal(refLabel(null, 'a'), '');
  });
});
