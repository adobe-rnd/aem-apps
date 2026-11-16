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
  setTab, normalizeConfig, detectVersion, applyInstall, rowsToReplace, INSTALL,
  tabsToConfig, readRules, rulesToRows, readWorkflows, workflowsToRows, readGroups, groupsToRows,
  missingGroups, suggestDomains, emailAddresses, readSettings, settingsToRows,
  settingsValues, guidanceItems, rowsOf, describeProblem,
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

test('setTab replaces one tab and keeps permissions, other tabs and tab order', () => {
  const next = setTab(siteConfig(), 'library', [{ title: 'X', path: '/x' }]);
  assert.deepEqual(next[':names'], ['permissions', 'library']);
  assert.deepEqual(next.permissions, siteConfig().permissions);
  assert.equal(next.library.total, 1);
  const added = setTab(next, 'apps', [{ title: 'A', path: '/a' }]);
  assert.deepEqual(added[':names'], ['permissions', 'library', 'apps']);
  const removed = setTab(added, 'apps', []);
  assert.deepEqual(removed[':names'], ['permissions', 'library']);
  assert.equal(removed.apps, undefined);
});

test('setTab starts from an empty multi-sheet when the site has no config', () => {
  const next = setTab(null, 'apps', [{ path: '/a' }]);
  assert.equal(next[':type'], 'multi-sheet');
  assert.deepEqual(next[':names'], ['apps']);
});

test('normalizeConfig turns a single-sheet config into a multi-sheet', () => {
  const next = normalizeConfig({ ':type': 'sheet', ':sheetname': 'library', data: [{ path: '/x' }] });
  assert.deepEqual(next[':names'], ['library']);
  assert.deepEqual(rowsOf(next, 'library'), [{ path: '/x' }]);
});

test('detectVersion reads library and apps rows, tolerating refs and vendored copies', () => {
  assert.equal(detectVersion(siteConfig()), null);
  const v1 = setTab(siteConfig(), 'apps', [{ path: '/app/acme/site/tools/apps/publish-requests-inbox/publish-requests-inbox' }]);
  assert.equal(detectVersion(v1), 'v1');
  const v2 = setTab(siteConfig(), 'library', [{ Path: 'https://ref--aem-apps--adobe-rnd.aem.live/tools/plugins/request-for-publish-v2/request-for-publish-v2.html' }]);
  assert.equal(detectVersion(v2), 'v2');
  assert.equal(detectVersion(setTab(v2, 'apps', rowsOf(v1, 'apps'))), 'mixed');
});

test('applyInstall swaps versions, keeps unrelated rows and existing same-version rows', () => {
  const vendoredV2 = { title: 'RfP', path: '/tools/plugins/request-for-publish-v2/request-for-publish-v2.html' };
  const config = setTab(siteConfig(), 'library', [
    { title: 'Blocks', path: '/docs/library/blocks.json' },
    { title: 'Old', path: 'https://main--x--y.aem.live/tools/plugins/request-for-publish/request-for-publish.html' },
    vendoredV2,
  ]);
  assert.deepEqual(rowsToReplace(config, 'v2'), ['https://main--x--y.aem.live/tools/plugins/request-for-publish/request-for-publish.html']);
  const next = applyInstall(config, 'v2');
  assert.deepEqual(rowsOf(next, 'library'), [{ title: 'Blocks', path: '/docs/library/blocks.json' }, vendoredV2]);
  assert.deepEqual(rowsOf(next, 'apps'), [INSTALL.v2.apps]);
  assert.equal(detectVersion(next), 'v2');
  assert.deepEqual(next.permissions, siteConfig().permissions);
  assert.equal(detectVersion(applyInstall(next, 'v1')), 'v1');
});

test('rules round-trip with lowercase headers and keep columns the editor hides', () => {
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
    pattern: '/*', workflow: '', approvers: 'a@x.com, b@x.com', cc: 'c@x.com', notifyonreject: 'true',
  });
  const [, workflowRule] = rulesToRows(rules);
  assert.equal(workflowRule.workflow, 'legal');
  assert.equal(workflowRule.approvers, '');
  assert.deepEqual(rulesToRows([{
    pattern: '/new', workflow: '', approvers: 'n@x.com', cc: '',
  }]), [{
    pattern: '/new', workflow: '', approvers: 'n@x.com', cc: '',
  }]);
});

test('workflows group steps by name in row order and round-trip', () => {
  const rows = [
    {
      workflow: 'legal-then-brand', title: 'Legal', description: '', approvers: 'dl-legal', cc: '', 'cc can approve': '',
    },
    {
      workflow: 'legal-then-brand', title: 'Brand', description: 'Tone', approvers: 'brand@x.com', cc: 'w@x.com', 'cc can approve': 'true',
    },
  ];
  const workflows = readWorkflows(tabsToConfig({ 'publish-workflow-steps': rows }));
  assert.equal(workflows.length, 1);
  assert.equal(workflows[0].steps[1].ccCanApprove, true);
  assert.deepEqual(workflowsToRows(workflows), rows);
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
