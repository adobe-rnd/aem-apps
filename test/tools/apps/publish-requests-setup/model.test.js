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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig, detectVersion, rowsToReplace, suggestVersion, activeConfigOf,
  tabsToConfig, readRules, rulesToRows, readWorkflows, workflowsToRows, readGroups, groupsToRows,
  missingGroups, usedGroupNames, suggestDomains, emailAddresses, readSettings, settingsToRows,
  settingsValues, guidanceItems, rowsOf, describeProblem, draftFromConfig, draftToTabs, mergeTabs,
  readSetup, problemCode,
} from '../../../../tools/apps/publish-requests-setup/model.js';

const sheet = (data) => ({
  total: data.length, limit: data.length, offset: 0, data,
});

const siteConfig = () => ({
  ':names': ['permissions', 'library'],
  ':type': 'multi-sheet',
  ':version': 3,
  permissions: sheet([{ path: 'CONFIG', groups: 'admins', actions: 'write' }]),
  library: sheet([{ title: 'Blocks', path: '/docs/library/blocks.json' }]),
});

// Test helper: the config with one tab set to rows (the app no longer writes DA config itself).
const withTab = (config, tab, rows) => ({
  ...config,
  ':names': [...new Set([...(config[':names'] || []), tab])],
  [tab]: sheet(rows),
});

test('normalizeConfig turns a single-sheet config into a multi-sheet', () => {
  const next = normalizeConfig({ ':type': 'sheet', ':sheetname': 'library', data: [{ path: '/x' }] });
  assert.deepEqual(next[':names'], ['library']);
  assert.deepEqual(rowsOf(next, 'library'), [{ path: '/x' }]);
  assert.equal(next.library[':sheetname'], undefined);
});

test('detectVersion reads library and apps rows, tolerating refs and vendored copies', () => {
  assert.equal(detectVersion(siteConfig()), null);
  const v1 = withTab(siteConfig(), 'apps', [{ path: '/app/acme/site/tools/apps/publish-requests-inbox/publish-requests-inbox' }]);
  assert.equal(detectVersion(v1), 'v1');
  const v2 = withTab(siteConfig(), 'library', [{ Path: 'https://ref--aem-apps--adobe-rnd.aem.live/tools/plugins/request-for-publish-v2/request-for-publish-v2.html' }]);
  assert.equal(detectVersion(v2), 'v2');
  assert.equal(detectVersion(withTab(v2, 'apps', rowsOf(v1, 'apps'))), 'mixed');
});

test('rowsToReplace lists the other version\'s rows a switch removes', () => {
  const config = withTab(siteConfig(), 'library', [
    { title: 'Blocks', path: '/docs/library/blocks.json' },
    { title: 'Old', path: 'https://main--x--y.aem.live/tools/plugins/request-for-publish/request-for-publish.html' },
    { title: 'RfP', path: '/tools/plugins/request-for-publish-v2/request-for-publish-v2.html' },
  ]);
  assert.deepEqual(rowsToReplace(config, 'v2'), ['https://main--x--y.aem.live/tools/plugins/request-for-publish/request-for-publish.html']);
  assert.deepEqual(rowsToReplace(config, 'v1'), ['/tools/plugins/request-for-publish-v2/request-for-publish-v2.html']);
});

test('rules round-trip with lowercase headers, keep hidden columns and leave out empty optional keys', () => {
  const config = tabsToConfig({
    'publish-workflow-config': [
      {
        pattern: '/*', approvers: 'a@x.com,b@x.com', cc: '', notifyonreject: 'true',
      },
      { Pattern: '/products/*', Workflow: 'legal', Approvers: 'ignored@x.com' },
    ],
  });
  const rules = readRules(config);
  assert.equal(rules[0].approvers, 'a@x.com,b@x.com');
  rules[0].cc = ' c@x.com ,';
  assert.deepEqual(rulesToRows(rules)[0], {
    pattern: '/*', approvers: 'a@x.com, b@x.com', cc: 'c@x.com', notifyonreject: 'true',
  });
  const [, workflowRule] = rulesToRows(rules);
  assert.deepEqual(workflowRule, { pattern: '/products/*', workflow: 'legal' });
  assert.deepEqual(rulesToRows([{
    pattern: '/new', workflow: '', approvers: 'n@x.com', cc: '',
  }]), [{ pattern: '/new', approvers: 'n@x.com' }]);
});

test('clearing a rule\'s workflow turns it back into a Single Step rule with its approvers', () => {
  const [rule] = readRules(tabsToConfig({
    'publish-workflow-config': [{ pattern: '/p/*', workflow: 'legal', approvers: 'dl-web' }],
  }));
  rule.workflow = '';
  assert.deepEqual(rulesToRows([rule]), [{ pattern: '/p/*', approvers: 'dl-web' }]);
});

test('workflows group steps by name in row order and round-trip', () => {
  const rows = [
    {
      workflow: 'legal-then-brand', title: 'Legal', approvers: 'dl-legal',
    },
    {
      workflow: 'legal-then-brand', title: 'Brand', description: 'Tone', approvers: 'brand@x.com', cc: 'w@x.com', 'cc can approve': 'true',
    },
  ];
  const workflows = readWorkflows(tabsToConfig({ 'publish-workflow-steps': rows }));
  assert.equal(workflows.length, 1);
  assert.equal(workflows[0].steps[1].ccCanApprove, true);
  assert.deepEqual(workflowsToRows(workflows), rows);
  const withEmpties = readWorkflows(tabsToConfig({
    'publish-workflow-steps': [{
      workflow: 'w', title: 'T', description: '', approvers: 'a@x.com', cc: '', 'cc can approve': '',
    }],
  }));
  assert.deepEqual(workflowsToRows(withEmpties), [{ workflow: 'w', title: 'T', approvers: 'a@x.com' }]);
});

test('groups round-trip and registration domains come from every address', () => {
  const groups = readGroups(tabsToConfig({ 'publish-workflow-groups-to-email': [{ group: 'dl-legal', email: 'l@acme.com,m@acme.com' }] }));
  assert.deepEqual(groupsToRows(groups), [{ group: 'dl-legal', email: 'l@acme.com, m@acme.com' }]);
  const rules = [{
    pattern: '/*', workflow: '', approvers: 'a@Acme.com, dl-legal', cc: 'x@other.org',
  }];
  assert.deepEqual(suggestDomains(emailAddresses(rules, [], groups)), ['acme.com', 'other.org']);
});

test('describeProblem names the tab of a worker validation error', () => {
  assert.equal(
    describeProblem({ field: 'tabs.publish-workflow-config[1].approvers', error: 'Row 2: add approvers' }),
    'Rules: Row 2: add approvers',
  );
  assert.equal(describeProblem({ code: 'no-rules', message: 'No rules yet' }), 'No rules yet');
});

test('missingGroups finds distribution lists used but not defined; workflow rules are skipped', () => {
  const rules = [
    {
      pattern: '/*', workflow: '', approvers: 'dl-web, a@x.com', cc: 'dl-watch',
    },
    {
      pattern: '/p/*', workflow: 'legal', approvers: 'dl-ignored', cc: '',
    },
  ];
  const workflows = [{ name: 'legal', steps: [{ approvers: 'DL-Legal', cc: '' }] }];
  assert.deepEqual(missingGroups(rules, workflows, [{ group: 'dl-legal', email: 'l@x.com' }]), ['dl-web', 'dl-watch']);
});

test('list names that contain @ are lists, not email addresses', () => {
  const groups = [{ group: 'dl-superauthors@adobe.com', email: 'a@acme.com' }];
  const rules = [{
    pattern: '/*', workflow: '', approvers: 'DL-SuperAuthors@adobe.com, b@other.org', cc: '',
  }];
  assert.deepEqual(usedGroupNames(rules, [], groups), ['DL-SuperAuthors@adobe.com']);
  assert.deepEqual(missingGroups(rules, [], groups), []);
  assert.deepEqual(emailAddresses(rules, [], groups), ['b@other.org', 'a@acme.com']);
  assert.deepEqual(suggestDomains(emailAddresses(rules, [], groups)), ['other.org', 'acme.com']);
});

test('settings keep unknown keys, renumber guidance items and drop empty values', () => {
  const settings = readSettings(tabsToConfig({
    'publish-workflow-settings': [
      { key: 'request.comments.required', value: 'true' },
      { key: 'request.guidance.item.1', value: 'One' },
      { key: 'request.guidance.item.1.marker', value: '✓' },
      { key: 'custom.thing', value: 'keep' },
    ],
  }));
  const values = settingsValues(settings);
  assert.equal(values.commentsRequired, 'true');
  assert.deepEqual(guidanceItems(settings), ['One']);
  const rows = settingsToRows(settings, { ...values, commentsRequired: '', supportContact: 'help@x.com' }, ['', 'Two', 'Three']);
  assert.deepEqual(rows, [
    { key: 'request.support.contact', value: 'help@x.com' },
    { key: 'request.guidance.item.1', value: 'Two' },
    { key: 'request.guidance.item.2', value: 'Three' },
    { key: 'request.guidance.item.1.marker', value: '✓' },
    { key: 'custom.thing', value: 'keep' },
  ]);
});

test('guidance item markers move with their item and go with a removed item', () => {
  const settings = readSettings(tabsToConfig({
    'publish-workflow-settings': [
      { key: 'request.guidance.item.1', value: 'One' },
      { key: 'request.guidance.item.2', value: 'Two' },
      { key: 'request.guidance.item.3', value: 'Three' },
      { key: 'request.guidance.item.1.marker', value: 'a' },
      { key: 'request.guidance.item.2.marker', value: 'b' },
      { key: 'request.guidance.item.3.marker', value: 'c' },
      { key: 'request.guidance.item.9.marker', value: 'orphan' },
    ],
  }));
  const values = settingsValues(settings);
  // "One" removed, "Three" moved first, "Two" edited in place.
  const rows = settingsToRows(settings, values, ['Three', 'Two, edited']);
  assert.deepEqual(rows, [
    { key: 'request.guidance.item.1', value: 'Three' },
    { key: 'request.guidance.item.2', value: 'Two, edited' },
    { key: 'request.guidance.item.1.marker', value: 'c' },
    { key: 'request.guidance.item.2.marker', value: 'b' },
    { key: 'request.guidance.item.9.marker', value: 'orphan' },
  ]);
  // Unchanged items keep their markers on the same numbers.
  assert.deepEqual(
    settingsToRows(settings, values, guidanceItems(settings)).map(({ key }) => key),
    settings.map(({ key }) => key),
  );
});

test('suggestVersion picks Single Step unless a rule uses a workflow or workflows are defined', () => {
  assert.equal(suggestVersion(null), 'v1');
  assert.equal(suggestVersion(tabsToConfig({ 'publish-workflow-config': [{ pattern: '/*', approvers: 'a@x.com', workflow: '' }] })), 'v1');
  assert.equal(suggestVersion(tabsToConfig({ 'publish-workflow-config': [{ pattern: '/*', Workflow: 'legal' }] })), 'v2');
  assert.equal(suggestVersion(tabsToConfig({ 'publish-workflow-steps': [{ workflow: 'legal', title: 'L', approvers: 'a@x.com' }] })), 'v2');
});

test('activeConfigOf uses the site config when it has rules, else the org config', () => {
  const site = withTab(siteConfig(), 'publish-workflow-config', [{ pattern: '/*', approvers: 'a@x.com' }]);
  const org = withTab(siteConfig(), 'publish-workflow-steps', [{ workflow: 'w' }]);
  assert.equal(activeConfigOf(site, org), site);
  assert.equal(activeConfigOf(siteConfig(), org), org);
  assert.equal(activeConfigOf(null, null), null);
});

const rulesConfig = (rules, groups, steps) => tabsToConfig({
  'publish-workflow-config': rules,
  ...(groups ? { 'publish-workflow-groups-to-email': groups } : {}),
  ...(steps ? { 'publish-workflow-steps': steps } : {}),
});

test('draftFromConfig and draftToTabs round-trip rules, lists and workflows', () => {
  const config = rulesConfig(
    [{ pattern: '/*', approvers: 'dl-web, dl-new' }, { pattern: '/p/*', workflow: 'legal' }],
    [{ group: 'dl-web', email: 'a@x.com' }],
    [{ workflow: 'legal', title: 'Legal', approvers: 'l@x.com' }],
  );
  const draft = draftFromConfig('rules', config);
  assert.deepEqual(draft.groups.map((g) => g.group), ['dl-web', 'dl-new']);
  assert.deepEqual(draftToTabs('rules', draft, { v2: true }), {
    'publish-workflow-config': [{ pattern: '/*', approvers: 'dl-web, dl-new' }, { pattern: '/p/*', workflow: 'legal' }],
    'publish-workflow-groups-to-email': [{ group: 'dl-web', email: 'a@x.com' }, { group: 'dl-new', email: '' }],
    'publish-workflow-steps': [{ workflow: 'legal', title: 'Legal', approvers: 'l@x.com' }],
  });
  const v1 = draftToTabs('rules', draft, { v2: false });
  assert.equal('publish-workflow-steps' in v1, false);
  assert.equal(draftToTabs('rules', { ...draft, dropSteps: true }, { v2: false })['publish-workflow-steps'], null);
  const empty = draftFromConfig('rules', {});
  assert.deepEqual(empty.rules.map((r) => r.pattern), ['/*']);
  const settings = draftFromConfig('settings', tabsToConfig({ 'publish-workflow-settings': [{ key: 'request.comments.required', value: 'true' }] }));
  assert.deepEqual(draftToTabs('settings', settings), { 'publish-workflow-settings': [{ key: 'request.comments.required', value: 'true' }] });
  assert.deepEqual(draftToTabs('settings', draftFromConfig('settings', {})), { 'publish-workflow-settings': null });
});

test('mergeTabs re-applies only my changes on top of a concurrent change', () => {
  const base = draftToTabs('rules', draftFromConfig('rules', rulesConfig(
    [{ pattern: '/*', approvers: 'a@x.com' }, { pattern: '/old/*', approvers: 'a@x.com' }],
    [{ group: 'dl-web', email: 'w@x.com' }],
  )), { v2: false });
  // I changed /*, removed /old/* and added /mine/*.
  const mine = draftToTabs('rules', draftFromConfig('rules', rulesConfig(
    [{ pattern: '/*', approvers: 'b@x.com' }, { pattern: '/mine/*', approvers: 'dl-web' }],
    [{ group: 'dl-web', email: 'w@x.com' }],
  )), { v2: false });
  // Someone else added /theirs/* after /*, and a list.
  const theirs = draftToTabs('rules', draftFromConfig('rules', rulesConfig(
    [{ pattern: '/*', approvers: 'a@x.com' }, { pattern: '/theirs/*', approvers: 't@x.com' }, { pattern: '/old/*', approvers: 'a@x.com' }],
    [{ group: 'dl-web', email: 'w@x.com' }, { group: 'dl-legal', email: 'l@x.com' }],
  )), { v2: false });
  const result = mergeTabs(base, mine, theirs);
  assert.equal(result.ok, true);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.tabs['publish-workflow-config'], [
    { pattern: '/*', approvers: 'b@x.com' },
    { pattern: '/theirs/*', approvers: 't@x.com' },
    { pattern: '/mine/*', approvers: 'dl-web' },
  ]);
  assert.deepEqual(result.tabs['publish-workflow-groups-to-email'], [
    { group: 'dl-web', email: 'w@x.com' },
    { group: 'dl-legal', email: 'l@x.com' },
  ]);
});

test('mergeTabs reports a conflict when both sides changed the same rule, keeping mine', () => {
  const base = { 'publish-workflow-config': [{ pattern: '/*', approvers: 'a@x.com' }, { pattern: '/x', approvers: 'x@x.com' }] };
  const mine = { 'publish-workflow-config': [{ pattern: '/*', approvers: 'b@x.com' }] };
  const theirs = { 'publish-workflow-config': [{ pattern: '/*', approvers: 'c@x.com' }, { pattern: '/x', approvers: 'y@x.com' }] };
  const result = mergeTabs(base, mine, theirs);
  assert.equal(result.ok, true);
  assert.deepEqual(result.tabs['publish-workflow-config'], [{ pattern: '/*', approvers: 'b@x.com' }]);
  assert.deepEqual(result.conflicts, [
    { tab: 'publish-workflow-config', key: '/*', theirs: [{ pattern: '/*', approvers: 'c@x.com' }] },
    { tab: 'publish-workflow-config', key: '/x', theirs: [{ pattern: '/x', approvers: 'y@x.com' }] },
  ]);
  // Both made the same change: no conflict.
  const same = mergeTabs(base, mine, { 'publish-workflow-config': [{ pattern: '/*', approvers: 'b@x.com' }] });
  assert.deepEqual(same.conflicts, []);
});

test('mergeTabs merges workflows by name and settings by key', () => {
  const step = (workflow, title) => ({ workflow, title, approvers: 'a@x.com' });
  const base = { 'publish-workflow-steps': [step('legal', 'L1'), step('legal', 'L2')] };
  const mine = { 'publish-workflow-steps': [step('legal', 'L1'), step('legal', 'L2'), step('brand', 'B1')] };
  const theirs = { 'publish-workflow-steps': [step('legal', 'L1'), step('legal', 'L2 renamed')] };
  const result = mergeTabs(base, mine, theirs);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.tabs['publish-workflow-steps'], [step('legal', 'L1'), step('legal', 'L2 renamed'), step('brand', 'B1')]);

  const settings = mergeTabs(
    { 'publish-workflow-settings': [{ key: 'a', value: '1' }] },
    { 'publish-workflow-settings': [{ key: 'a', value: '1' }, { key: 'b', value: 'mine' }] },
    { 'publish-workflow-settings': null },
  );
  assert.deepEqual(settings.tabs, { 'publish-workflow-settings': [{ key: 'b', value: 'mine' }] });
  const removed = mergeTabs(
    { 'publish-workflow-settings': [{ key: 'a', value: '1' }] },
    { 'publish-workflow-settings': null },
    { 'publish-workflow-settings': [{ key: 'a', value: '1' }] },
  );
  assert.deepEqual(removed.tabs, { 'publish-workflow-settings': null });
});

test('mergeTabs gives up on blank or duplicate keys and returns what changed', () => {
  const base = { 'publish-workflow-config': [{ pattern: '/*', approvers: 'a@x.com' }] };
  const mine = { 'publish-workflow-config': [{ pattern: '/*', approvers: 'a@x.com' }, { pattern: '', approvers: 'b@x.com' }] };
  const theirs = { 'publish-workflow-config': [{ pattern: '/*', approvers: 'c@x.com' }] };
  const result = mergeTabs(base, mine, theirs);
  assert.equal(result.ok, false);
  assert.deepEqual(result.incoming, { 'publish-workflow-config': [{ pattern: '/*', approvers: 'c@x.com' }] });
});

test('readSetup maps the worker setup view onto the registration and workflow state', () => {
  const view = {
    active: 'site', version: 'h1', siteTabs: {}, orgTabs: null, validation: { errors: [], warnings: [] },
  };
  const installed = { version: 'v1', site: { version: 'v1', library: 'v1', apps: 'v1' }, org: null };
  const registered = readSetup({
    ok: true,
    status: 200,
    data: {
      registration: { emailProvider: 'default', allowedEmailDomains: ['x.com'] },
      availableProviders: ['default', 'custom-api'],
      providerWarnings: { default: 'w' },
      canEdit: true,
      installed,
      workflowConfig: view,
    },
  });
  assert.deepEqual(registered.registration, {
    status: 'registered',
    config: {
      emailProvider: 'default', allowedEmailDomains: ['x.com'], availableProviders: ['default', 'custom-api'], providerWarnings: { default: 'w' }, canEdit: true,
    },
  });
  assert.deepEqual(registered.workflow, {
    ...view, installed, canEdit: true, permissionsMode: 'unknown',
  });
  assert.equal(registered.canEdit, true);
  assert.equal(registered.problem, null);

  const unregistered = readSetup({
    ok: true,
    status: 200,
    data: {
      registration: null, availableProviders: ['custom-api'], canEdit: false, workflowConfig: view,
    },
  });
  assert.equal(unregistered.registration.status, 'unregistered');
  assert.equal(unregistered.canEdit, false);

  const missing = readSetup({ ok: false, status: 404, data: { code: 'site-not-found', error: 'nope' } });
  assert.equal(missing.problem, 'site-not-found');
  assert.deepEqual(missing.registration, { status: 'unknown', code: 'site-not-found', error: 'nope' });
  assert.equal(missing.workflow, null);

  assert.equal(readSetup({ ok: false, status: 503, data: { code: 'permission-check-unavailable' } }).problem, 'unavailable');
  assert.equal(readSetup({ ok: false, status: 0, data: { error: 'Failed to fetch' } }).problem, 'unavailable');
});

test('problemCode keeps definite worker answers apart from outages', () => {
  assert.equal(problemCode({ status: 403, data: { code: 'preview-write-required' } }), 'preview-write-required');
  assert.equal(problemCode({ status: 403, data: { error: 'not registered' } }), null);
  assert.equal(problemCode({ status: 502, data: {} }), 'unavailable');
  assert.equal(problemCode({ status: 0, data: {} }), 'unavailable');
});
