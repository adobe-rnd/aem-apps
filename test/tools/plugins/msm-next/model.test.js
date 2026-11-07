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
  pagePathFrom, publishBadge, header, sourceRows, targetTree, flattenTargets, targetRows,
  targetSummary, pageActions, canPropagate, rolloutOptions, runSummary, translatingPages,
  describeFailure, jobMessage, jobsWorthNoting, doneMessage,
} from '../../../../tools/plugins/msm-next/model.js';
import createMockLocalization from '../../../../tools/apps/msm-next/data/mock/mock-localization.js';

const location = (path, extra = {}) => ({
  id: `gamebox:${path}`, site: 'gamebox', path, language: 'en', label: path.slice(1), ...extra,
});

const action = (name, extra = {}) => ({
  action: name, enabled: true, reasons: [], ...extra,
});

const result = (relationship, sync = [], extra = {}) => ({
  location: extra.location ?? location('/amer', { level: 'Region', label: 'Americas' }),
  chain: extra.chain ?? [{ ref: {}, info: { exists: relationship !== 'inherited' } }],
  status: {
    relationship, sync, overridden: Boolean(extra.overridden), effectiveSource: null,
  },
  actions: extra.actions ?? [],
});

const ids = (groups) => groups.map((group) => [group.id, group.buttons.map((button) => button.id)]);

describe('pagePathFrom', () => {
  it('adds .html to DA context paths', () => {
    assert.equal(pagePathFrom('/emea/consoles/x'), '/emea/consoles/x.html');
    assert.equal(pagePathFrom('/emea/x.html'), '/emea/x.html');
    assert.equal(pagePathFrom('/emea/data.json'), '/emea/data.json');
    assert.equal(pagePathFrom('emea/x'), '/emea/x.html');
    assert.equal(pagePathFrom('/emea/'), '/emea/index.html');
    assert.equal(pagePathFrom(''), '/index.html');
  });
});

describe('publishBadge', () => {
  it('labels publish states and hides unknown availability', () => {
    assert.equal(publishBadge(undefined), null);
    assert.equal(publishBadge(null).label, 'Not published');
    assert.equal(publishBadge('live').label, 'Live');
    assert.equal(publishBadge('preview').label, 'Previewed');
  });
});

describe('header', () => {
  it('summarizes the page', () => {
    const info = header(result('local copy', ['behind source', 'current'], { overridden: true }), {
      site: 'gamebox', path: '/amer/hardware/game-console.html', publishState: 'live',
    });
    assert.equal(info.title, 'Game console');
    assert.equal(info.location, 'Americas');
    assert.equal(info.level, 'Region');
    assert.equal(info.language, 'en');
    assert.equal(info.type.label, 'Local copy');
    assert.equal(info.sync.label, 'Update available');
    assert.equal(info.overridden, true);
    assert.equal(info.publish.label, 'Live');
  });

  it('describes unlinked pages as independent', () => {
    const page = result('unlinked');
    page.chain[0].info.overrides = { unlinkedFrom: 'gamebox:/global/x.html' };
    page.location.site = 'gamebox';
    const info = header(page, { site: 'gamebox', path: '/amer/x.html' });
    assert.equal(info.type.label, 'Independent');
    assert.equal(info.type.detail, 'Unlinked from /global/x.html');
    assert.equal(info.publish, null);
  });

  it('falls back to depth for the level', () => {
    const page = result('root', [], { location: location('/global') });
    assert.equal(header(page, { site: 'gamebox', path: '/global/index.html' }).level, 'Level 1');
  });
});

describe('sourceRows', () => {
  const chain = [
    { ref: { site: 'gamebox', path: '/fr/x.html', location: location('/fr') }, info: { exists: true } },
    { ref: { site: 'gamebox', path: '/emea/x.html', location: location('/emea', { level: 'Region' }) }, info: { exists: false } },
    { ref: { site: 'gamebox', path: '/global/x.html', location: location('/global', { level: 'Global' }) }, info: { exists: true } },
  ];

  it('lists the chain above the page, nearest first, with loaded status', () => {
    const results = new Map([['gamebox:/global/x.html', result('root', [])]]);
    const rows = sourceRows({ chain }, results);
    assert.deepEqual(rows.map((row) => row.key), ['gamebox:/emea/x.html', 'gamebox:/global/x.html']);
    assert.equal(rows[0].direct, true);
    assert.equal(rows[0].exists, false);
    assert.equal(rows[0].type, null);
    assert.equal(rows[1].type.label, 'Source');
    assert.equal(rows[1].level, 'Global');
  });

  it('is empty for a source page', () => {
    assert.deepEqual(sourceRows({ chain: chain.slice(2) }), []);
    assert.deepEqual(sourceRows(null), []);
  });
});

describe('target tree', () => {
  const edges = {
    'a:/g/x': [{ site: 'a', path: '/r/x', location: location('/r') }],
    'a:/r/x': [
      { site: 'a', path: '/l1/x', location: location('/l1') },
      { site: 'b', path: '/l2/x', location: location('/l2') },
    ],
    'b:/l2/x': [{ site: 'a', path: '/g/x', location: location('/g') }],
  };
  const find = (model, site, path) => edges[`${site}:${path}`] ?? [];
  const tree = targetTree(null, { site: 'a', path: '/g/x' }, find);

  it('nests direct and indirect targets and stops at cycles', () => {
    assert.equal(tree.length, 1);
    assert.equal(tree[0].key, 'a:/r/x');
    assert.deepEqual(tree[0].children.map((node) => node.key), ['a:/l1/x', 'b:/l2/x']);
    assert.deepEqual(tree[0].children[1].children, []);
  });

  it('flattens with depth', () => {
    assert.deepEqual(flattenTargets(tree).map((node) => [node.key, node.depth]), [
      ['a:/r/x', 0], ['a:/l1/x', 1], ['b:/l2/x', 1],
    ]);
  });

  it('builds rows with status and next step, and summarizes them', () => {
    const results = new Map([
      ['a:/r/x', result('local copy', ['behind source'], { actions: [action('rollout', { default: true, options: ['merge'] })] })],
      ['a:/l1/x', result('inherited', [])],
    ]);
    const rows = targetRows(tree, results);
    assert.equal(rows[0].sync.label, 'Update available');
    assert.deepEqual(rows[0].next, { kind: 'action', action: 'rollout', label: 'Update' });
    assert.equal(rows[1].type.label, 'Inherited');
    assert.equal(rows[1].next, null);
    assert.equal(rows[2].loaded, false);
    assert.deepEqual(targetSummary(rows), {
      total: 3, direct: 1, needsAction: 1, loaded: 2,
    });
  });

  it('uses core targetPages over a real org model', async () => {
    const localization = createMockLocalization({ latency: false });
    const model = await localization.orgModel();
    const nodes = targetTree(model, { site: 'gamebox', path: '/global/index.html' });
    const keys = flattenTargets(nodes).map((node) => node.key);
    assert.ok(keys.includes('gamebox:/amer/index.html'));
    assert.ok(keys.includes('gamebox:/en-us/index.html'));
    assert.ok(keys.includes('gamebox-retail:/pixelmart/index.html'));
    const amer = nodes.find((node) => node.key === 'gamebox:/amer/index.html');
    assert.ok(amer.children.some((node) => node.key === 'gamebox:/en-us/index.html'));
  });
});

describe('pageActions', () => {
  it('groups rollout options under update and marks the next step primary', () => {
    const page = result('local copy', ['behind source'], {
      actions: [
        action('rollout', { default: true, options: ['merge', 'overwrite'] }),
        action('unlink'),
        action('reconnect', { destructive: true }),
      ],
    });
    const { review, groups } = pageActions(page);
    assert.equal(review, false);
    assert.deepEqual(ids(groups), [
      ['update', ['rollout:merge', 'rollout:overwrite']],
      ['relationship', ['unlink', 'reconnect']],
      ['publish', ['preview', 'publish']],
    ]);
    const [merge, replace] = groups[0].buttons;
    assert.equal(merge.primary, true);
    assert.equal(merge.label, 'Merge');
    assert.equal(merge.option, 'merge');
    assert.equal(replace.primary, false);
    assert.equal(replace.label, 'Replace with source');
    const reconnect = groups[1].buttons[1];
    assert.equal(reconnect.label, 'Revert to inherited');
    assert.ok(reconnect.confirm);
    assert.equal(reconnect.destructive, true);
  });

  it('offers a local copy and unlink-with-copy on inherited pages', () => {
    const page = result('inherited', [], {
      actions: [action('rollout', { creates: true }), action('unlink', { creates: true })],
    });
    const { groups } = pageActions(page);
    assert.equal(groups[0].buttons[0].label, 'Create local copy');
    assert.equal(groups[1].buttons[0].label, 'Unlink (creates a local copy)');
  });

  it('shows disabled translate with its reason and a status check while translating', () => {
    const page = result('not created', ['translating'], {
      actions: [action('translate', { enabled: false, reasons: ['translation-in-progress'], default: true })],
    });
    const { groups } = pageActions(page);
    assert.deepEqual(ids(groups), [['translation', ['translate', 'check']]]);
    assert.equal(groups[0].buttons[0].enabled, false);
    assert.equal(groups[0].buttons[0].reason, 'A translation is in progress');
    assert.equal(groups[0].buttons[1].kind, 'check');
  });

  it('labels save and link, and flags review', () => {
    const ready = pageActions(result('translation', ['ready to save'], { actions: [action('save')] }));
    assert.equal(ready.groups[0].buttons[0].label, 'Save translation');
    assert.equal(ready.groups[0].buttons[0].primary, true);
    const missing = pageActions(result('not created', [], { actions: [action('link')] }));
    assert.deepEqual(ids(missing.groups), [['relationship', ['link']]]);
    assert.equal(missing.groups[0].buttons[0].label, 'Inherit');
    assert.equal(pageActions(result('local copy', ['needs review'])).review, true);
  });

  it('is empty without a status', () => {
    assert.deepEqual(pageActions({ status: null }), { review: false, groups: [] });
  });
});

describe('bulk helpers', () => {
  it('allows propagating only from real pages with targets', () => {
    assert.equal(canPropagate(result('root'), [{}]), true);
    assert.equal(canPropagate(result('inherited'), [{}]), true);
    assert.equal(canPropagate(result('root'), []), false);
    assert.equal(canPropagate(result('not created'), [{}]), false);
  });

  it('collects rollout options from targets', () => {
    const results = new Map([
      ['a', result('local copy', [], { actions: [action('rollout', { options: ['overwrite'] })] })],
      ['b', result('local copy', [], { actions: [action('rollout', { options: ['merge', 'overwrite'] })] })],
    ]);
    assert.deepEqual(rolloutOptions([{ key: 'a' }, { key: 'b' }], results), ['overwrite', 'merge']);
    assert.deepEqual(rolloutOptions([], new Map()), ['merge', 'overwrite']);
  });

  it('finds translating pages to check', () => {
    const rows = [{ key: 'gamebox:/fr/x.html', site: 'gamebox', path: '/fr/x.html' }];
    const results = new Map([['gamebox:/fr/x.html', result('translation', ['translating'])]]);
    assert.deepEqual(
      translatingPages({ site: 'gamebox', path: '/emea/x.html' }, result('local copy', ['translating']), rows, results),
      [{ site: 'gamebox', path: '/emea/x.html' }, { site: 'gamebox', path: '/fr/x.html' }],
    );
    assert.deepEqual(translatingPages({ site: 'a', path: '/x' }, result('root', ['current'])), []);
  });
});

describe('runSummary', () => {
  it('counts states and explains issues', () => {
    const summary = runSummary({
      items: [
        { site: 'a', path: '/1', state: 'done' },
        { site: 'a', path: '/2', state: 'done' },
        {
          site: 'a', path: '/3', state: 'failed', error: 'target-unreadable',
        },
        {
          site: 'a', path: '/4', state: 'blocked', reasons: ['parent:failed'],
        },
        {
          site: 'a', path: '/5', state: 'blocked', reasons: ['needs-review'],
        },
        { site: 'a', path: '/6', state: 'sent' },
      ],
    });
    assert.equal(summary.total, 6);
    assert.equal(summary.finished, true);
    assert.deepEqual(summary.counts.map((entry) => [entry.label, entry.count]), [
      ['Updated', 2], ['Blocked', 2], ['Failed', 1], ['sent', 1],
    ]);
    assert.deepEqual(summary.issues.map((issue) => issue.reason), [
      'The written page could not be read back',
      'Source page: failed',
      'This page needs review first',
    ]);
  });

  it('reports progress while running', () => {
    const summary = runSummary({ items: [{ state: 'running' }, { state: 'pending' }] });
    assert.equal(summary.finished, false);
    assert.equal(runSummary(null), null);
  });
});

describe('messages', () => {
  it('describes failures', () => {
    assert.equal(describeFailure({ error: 'action-disabled', reasons: ['no-source'] }), 'This action is disabled: There is no source page');
    assert.equal(describeFailure({ error: 'boom' }), 'boom');
    assert.equal(describeFailure(null), 'Something went wrong');
  });

  it('summarizes job checks', () => {
    assert.equal(jobMessage([{ state: 'ready' }, { state: 'translating' }, { state: 'translating' }]), 'Translation status: 1 ready to save, 2 still translating.');
    assert.equal(jobMessage([{ state: 'none' }]), 'No translation jobs found.');
    assert.equal(jobMessage([{ state: 'translating', progress: { done: 3, total: 10 } }]), 'Translation status: 1 still translating (3 of 10).');
    assert.equal(jobsWorthNoting([{ state: 'translating' }]), false);
    assert.equal(jobsWorthNoting([{ state: 'ready' }]), true);
  });

  it('names finished actions', () => {
    assert.equal(doneMessage('translate', 'Translate'), 'Translation started');
    assert.equal(doneMessage('other', 'Other'), 'Other: done');
  });
});
