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
  pagePathFrom, publishBadge, header, targetTree, flattenTargets, targetRows, targetSummary,
  canPropagate, rolloutOptions, runSummary, translatingPages, describeFailure, jobMessage,
  jobsWorthNoting, doneMessage, localeBadge, regionName, languageName, formatDate, statusPill,
  sourceInfo, detailRows, stateCard, menuItems, defaultUpdate, pickerRows, togglePick,
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

const sourceRef = {
  site: 'gamebox',
  path: '/global/hardware/game-console.html',
  location: location('/global', { label: 'Global', level: 'Global' }),
};

const withSource = (page, ref = sourceRef) => {
  page.status.effectiveSource = ref;
  return page;
};

const ids = (items) => items.map((item) => item.id);

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

describe('language display', () => {
  it('builds the locale badge, region and language names', () => {
    assert.equal(localeBadge('es-MX'), 'ES-MX');
    assert.equal(localeBadge(null), null);
    assert.equal(regionName('es-MX'), 'Mexico');
    assert.equal(regionName('es-419'), 'Latin America');
    assert.equal(regionName('en'), null);
    assert.equal(regionName('nonsense!'), null);
    assert.equal(languageName('es-MX'), 'Spanish');
    assert.equal(languageName('zh-Hant-TW'), 'Traditional Chinese');
    assert.equal(languageName('nonsense!'), 'nonsense!');
  });

  it('formats dates and skips unknown ones', () => {
    assert.equal(formatDate('2026-10-28T12:00:00Z', { timeZone: 'UTC' }), 'Oct 28, 2026');
    assert.equal(formatDate(undefined), '');
    assert.equal(formatDate('nope'), '');
  });
});

describe('header', () => {
  it('summarizes the page with the most urgent status and the last sync', () => {
    const page = result('local copy', ['behind source', 'current'], {
      overridden: true,
      location: location('/es-mx', { language: 'es-MX', label: 'Mexican Spanish' }),
      chain: [{ ref: {}, info: { exists: true, base: { at: '2026-10-28T12:00:00Z' } } }],
    });
    const info = header(page, { path: '/es-mx/hardware/game-console.html', timeZone: 'UTC' });
    assert.equal(info.title, 'Game console');
    assert.equal(info.badge, 'ES-MX');
    assert.equal(info.badgeTitle, 'Mexican Spanish');
    assert.deepEqual(info.pill, { label: 'Update available', tone: 'notice', sync: 'behind source' });
    assert.equal(info.overridden, true);
    assert.equal(info.lastSynced, 'Oct 28, 2026');
  });

  it('omits the last sync when unknown and falls back to the type for the pill', () => {
    const info = header(result('unlinked'), { path: '/amer/index.html' });
    assert.equal(info.title, 'Home');
    assert.equal(info.lastSynced, '');
    assert.deepEqual(info.pill, { label: 'Independent', tone: 'neutral', sync: null });
  });

  it('maps every sync state to a pill', () => {
    assert.equal(statusPill(result('local copy', ['needs review', 'behind source'])).label, 'Needs review');
    assert.equal(statusPill(result('local copy', ['needs review'])).tone, 'negative');
    assert.equal(statusPill(result('translation', ['ready to save'])).label, 'Ready to save');
    assert.equal(statusPill(result('not created', ['translating'])).label, 'Translating');
    assert.equal(statusPill(result('local copy', ['current'])).tone, 'positive');
    assert.equal(statusPill(result('root')).label, 'Source');
  });
});

describe('detailRows', () => {
  it('lists type, source, language, locale and location', () => {
    const page = withSource(result('local copy', ['current'], {
      location: location('/es-mx', { language: 'es-MX', label: 'Mexican Spanish', level: 'Locale' }),
    }));
    const rows = detailRows(page, { site: 'gamebox' });
    assert.deepEqual(rows.map((row) => [row.label, row.value]), [
      ['Type', 'Local copy'],
      ['Source', 'Game console (Global)'],
      ['Language', 'Spanish'],
      ['Locale', 'Mexico'],
      ['Location', 'Mexican Spanish · Locale'],
    ]);
    assert.equal(rows[1].detail, '/global/hardware/game-console.html');
    assert.equal(rows.some((row) => row.label === 'Sync mode'), false);
  });

  it('marks the source page, cross-site sources and publish state', () => {
    const root = result('root', [], { location: location('/global', { label: 'Global', level: 'Global' }) });
    const rows = detailRows(root, { site: 'gamebox', publishState: 'live' });
    assert.equal(rows[1].value, 'None (this is the source)');
    assert.equal(rows[3].value, '—');
    assert.equal(rows[4].value, 'Global');
    assert.deepEqual(rows[5], {
      id: 'publish', label: 'Published', value: 'Live', detail: '',
    });
    const retail = withSource(result('local copy'));
    assert.equal(detailRows(retail, { site: 'gamebox-retail' })[1].detail, 'gamebox:/global/hardware/game-console.html');
    assert.deepEqual(detailRows({ location: null }), []);
  });

  it('describes the source page', () => {
    assert.deepEqual(sourceInfo(withSource(result('local copy'))), {
      site: 'gamebox', path: '/global/hardware/game-console.html', label: 'Global', title: 'Game console',
    });
    assert.equal(sourceInfo(result('root')), null);
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
    assert.deepEqual(rows[0].pill, { label: 'Update available', tone: 'notice', sync: 'behind source' });
    assert.equal(rows[2].pill, null);
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

describe('stateCard', () => {
  const rollout = action('rollout', { default: true, options: ['merge', 'overwrite'] });

  it('offers Sync now and Compare for an update, with the local changes note', () => {
    const page = withSource(result('local copy', ['behind source'], { overridden: true, actions: [rollout] }));
    const card = stateCard(page);
    assert.equal(card.id, 'update');
    assert.equal(card.title, 'Available updates');
    assert.equal(card.tone, 'notice');
    assert.match(card.text, /Sync to apply the latest content/);
    assert.equal(card.note, 'This page contains local changes that may be affected by synchronization.');
    const shape = (button) => [button.label, button.style, button.option ?? null];
    assert.deepEqual(card.buttons.map(shape), [
      ['Sync now', 'primary', 'merge'], ['Compare with source', 'link', null],
    ]);
    assert.equal(stateCard(withSource(result('local copy', ['behind source'], { actions: [rollout] }))).note, null);
  });

  it('says Translate now when translate is the default refresh', () => {
    const page = withSource(result('translation', ['behind source'], {
      actions: [action('translate', { default: true }), action('rollout')],
    }));
    const [button] = stateCard(page).buttons;
    assert.equal(button.label, 'Translate now');
    assert.equal(button.action, 'translate');
    assert.equal(defaultUpdate(page).action, 'translate');
  });

  it('shows a disabled sync with its reason', () => {
    const page = result('local copy', ['behind source'], {
      actions: [action('rollout', { default: true, enabled: false, reasons: ['backend-unsupported'] })],
    });
    const [button] = stateCard(page).buttons;
    assert.equal(button.enabled, false);
    assert.equal(button.reason, 'Not supported on this backend yet');
    assert.equal(stateCard(page).buttons.length, 1);
  });

  it('shows conflicts without buttons and locks linked variations', () => {
    const card = stateCard(result('local copy', ['needs review', 'behind source'], { actions: [rollout] }));
    assert.equal(card.id, 'review');
    assert.equal(card.title, 'Conflicts');
    assert.equal(card.tone, 'negative');
    assert.deepEqual(card.buttons, []);
    assert.equal(card.locksVariations, true);
    assert.equal(stateCard(result('local copy', ['behind source'], { actions: [rollout] })).locksVariations, false);
  });

  it('explains blocked, translating, ready and deleted sources', () => {
    const blocked = stateCard(withSource(result('local copy', ['blocked by source review'])));
    assert.equal(blocked.id, 'blocked');
    assert.deepEqual(ids(blocked.buttons), ['open-source']);
    const translating = stateCard(result('not created', ['translating']));
    assert.equal(translating.title, 'Translation in progress');
    assert.deepEqual(translating.buttons.map((button) => [button.kind, button.label]), [['check', 'Check status']]);
    const ready = stateCard(result('translation', ['ready to save'], { actions: [action('save')] }));
    assert.equal(ready.title, 'Translation ready');
    assert.deepEqual(ready.buttons.map((button) => [button.action, button.label, button.style]), [['save', 'Save translation', 'primary']]);
    assert.equal(stateCard(result('local copy', ['source deleted'])).id, 'source-deleted');
  });

  it('describes inherited, not created and unlinked pages', () => {
    const inherited = stateCard(withSource(result('inherited', [], { actions: [action('rollout', { creates: true })] })));
    assert.equal(inherited.text, 'This page inherits content from Global.');
    assert.deepEqual(inherited.buttons.map((button) => [button.kind, button.label]), [['publish', 'Publish']]);

    const missing = stateCard(withSource(result('not created', [], {
      actions: [action('rollout', { default: true }), action('link')],
    })));
    assert.equal(missing.id, 'not-created');
    assert.deepEqual(missing.buttons.map((button) => [button.action, button.label, button.style]), [
      ['rollout', 'Create', 'primary'], ['link', 'Inherit', 'link'],
    ]);
    const noLink = stateCard(result('not created', [], {
      actions: [action('translate', { default: true }), action('link', { enabled: false })],
    }));
    assert.deepEqual(noLink.buttons.map((button) => button.label), ['Translate']);

    const unlinked = result('unlinked', [], { actions: [action('relink')] });
    unlinked.chain[0].info.overrides = { unlinkedFrom: 'gamebox:/amer/x.html' };
    unlinked.location.site = 'gamebox';
    const card = stateCard(unlinked);
    assert.equal(card.title, 'Independent — unlinked from /amer/x.html');
    assert.deepEqual(card.buttons.map((button) => [button.action, button.label]), [['relink', 'Relink']]);
  });

  it('shows no card when up to date, for sources and standalone pages', () => {
    assert.equal(stateCard(result('local copy', ['current'])), null);
    assert.equal(stateCard(result('root')), null);
    assert.equal(stateCard(result('standalone')), null);
    assert.equal(stateCard({ status: null }), null);
    assert.equal(stateCard(result('unavailable')).id, 'unavailable');
  });
});

describe('menuItems', () => {
  const links = { sourceUrl: 'https://da.live/edit#/o/gamebox/global/x', appUrl: 'https://app' };

  it('lists replace, relationship, publish and link items for a local copy', () => {
    const page = result('local copy', ['behind source'], {
      actions: [
        action('rollout', { default: true, options: ['merge', 'overwrite'] }),
        action('unlink'),
        action('reconnect', { destructive: true }),
      ],
    });
    const items = menuItems(page, { ...links, hasTargets: true });
    assert.deepEqual(ids(items), [
      'replace', 'unlink', 'reconnect', 'preview', 'publish', 'cascade', 'open-source', 'open-app',
    ]);
    const [replace, unlink, reconnect] = items;
    assert.deepEqual([replace.action, replace.option, replace.destructive, Boolean(replace.confirm)], ['rollout', 'overwrite', true, true]);
    assert.ok(unlink.confirm);
    assert.equal(reconnect.label, 'Revert to inherited');
    assert.ok(reconnect.confirm);
    assert.deepEqual([...new Set(items.map((item) => item.group))], ['page', 'publish', 'links']);
    assert.equal(items.at(-1).href, 'https://app');
  });

  it('hides replace when overwrite is not allowed and offers a local copy on inherited pages', () => {
    const merged = result('local copy', [], { actions: [action('rollout', { options: ['merge'] })] });
    assert.equal(ids(menuItems(merged)).includes('replace'), false);
    const inherited = result('inherited', [], {
      actions: [action('rollout', { creates: true, options: ['merge', 'overwrite'] }), action('unlink', { creates: true })],
    });
    const items = menuItems(inherited);
    assert.deepEqual(ids(items), ['create-copy', 'unlink', 'preview', 'publish']);
    assert.equal(items[1].label, 'Unlink (creates a local copy)');
  });

  it('offers relink, keeps disabled reasons and the mock review resolver', () => {
    const unlinked = menuItems(result('unlinked', [], { actions: [action('relink', { enabled: false, reasons: ['no-source'] })] }));
    assert.equal(unlinked[0].label, 'Relink');
    assert.equal(unlinked[0].enabled, false);
    assert.equal(unlinked[0].reason, 'There is no source page');
    const review = result('local copy', ['needs review']);
    assert.equal(ids(menuItems(review, { canResolve: true })).includes('resolve'), true);
    assert.equal(ids(menuItems(review)).includes('resolve'), false);
  });

  it('skips publish items for pages that are not created', () => {
    assert.deepEqual(ids(menuItems(result('not created'), { hasTargets: true })), []);
  });
});

describe('target picker', () => {
  const tree = [
    {
      key: 'gamebox:/amer/x.html',
      location: location('/amer', { label: 'Americas', level: 'Region' }),
      children: [
        {
          key: 'gamebox:/es-419/x.html',
          location: location('/es-419', { label: 'Latin American Spanish' }),
          children: [{ key: 'gamebox:/es-mx/x.html', location: location('/es-mx', { label: 'Mexican Spanish', level: 'Locale' }), children: [] }],
        },
      ],
    },
    { key: 'gamebox:/emea/x.html', location: location('/emea', { label: 'EMEA', level: 'Region' }), children: [] },
  ];
  const rows = pickerRows(tree, 0);

  it('lists locations depth-first with level labels', () => {
    assert.deepEqual(rows.map((row) => [row.id, row.depth, row.level, row.parentId]), [
      ['gamebox:/amer', 0, 'Region', null],
      ['gamebox:/es-419', 1, 'Level 3', 'gamebox:/amer'],
      ['gamebox:/es-mx', 2, 'Locale', 'gamebox:/es-419'],
      ['gamebox:/emea', 0, 'Region', null],
    ]);
  });

  it('includes ancestors when checking and descendants when unchecking', () => {
    const checked = togglePick(rows, new Set(), 'gamebox:/es-mx', true);
    assert.deepEqual([...checked].sort(), ['gamebox:/amer', 'gamebox:/es-419', 'gamebox:/es-mx']);
    const unchecked = togglePick(rows, new Set([...checked, 'gamebox:/emea']), 'gamebox:/amer', false);
    assert.deepEqual([...unchecked], ['gamebox:/emea']);
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
    assert.equal(jobMessage([{ state: 'none' }]), 'No translations found.');
    assert.equal(jobMessage([{ state: 'translating', progress: { done: 3, total: 10 } }]), 'Translation status: 1 still translating (3 of 10).');
    assert.equal(jobsWorthNoting([{ state: 'translating' }]), false);
    assert.equal(jobsWorthNoting([{ state: 'ready' }]), true);
  });

  it('names finished actions', () => {
    assert.equal(doneMessage('translate', 'Translate'), 'Translation started');
    assert.equal(doneMessage('other', 'Other'), 'Other: done');
  });
});
