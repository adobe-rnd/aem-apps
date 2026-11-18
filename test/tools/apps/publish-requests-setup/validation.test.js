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
// The editor's checks before a save, against the worker's validateWorkflowTabs and parseRows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  patternProblem, rulesDraftErrors, settingsDraftErrors, rulesToRows, readRules, tabsToConfig,
  settingsFields, workflowRemovalProblem, stepRemovalProblem, rulesToRename, renameWorkflow,
} from '../../../../tools/apps/publish-requests-setup/model.js';

const rule = (fields) => ({
  pattern: '/*', workflow: '', approvers: 'a@x.com', cc: '', ...fields,
});
const step = (fields) => ({
  title: 'Review', description: '', approvers: 'a@x.com', cc: '', ccCanApprove: false, ...fields,
});
const v2 = { v2: true };
const errorsOf = (draft, options) => rulesDraftErrors({
  rules: [], workflows: [], groups: [], ...draft,
}, options);

// ======== Patterns ========

test('patternProblem accepts the patterns the worker accepts', () => {
  ['/*', '*', '/', '/about', '/products/*', '/a/b-c_d.html', '//a', '/a/b/*', ' /trimmed/* ']
    .forEach((pattern) => assert.equal(patternProblem(pattern), null, pattern));
});

test('patternProblem names what is wrong with a pattern', () => {
  assert.equal(patternProblem(''), 'Add a pattern, such as /products/*.');
  assert.equal(patternProblem('  '), 'Add a pattern, such as /products/*.');
  ['products/*', '**', 'a'].forEach((pattern) => {
    assert.equal(patternProblem(pattern), 'Start the pattern with /, or use /* for every page.', pattern);
  });
  ['/a b', '/a?x', '/a#x', '/a\\b'].forEach((pattern) => {
    assert.equal(patternProblem(pattern), "A pattern can't contain spaces, ?, # or \\.", pattern);
  });
  ['/a/*/b', '/a*', '/*/x', '/a/**'].forEach((pattern) => {
    assert.equal(patternProblem(pattern), '* can only end a pattern, as in /products/*.', pattern);
  });
  ['/a/../b', '/./x', '/a/..', '/a/./*'].forEach((pattern) => {
    assert.equal(patternProblem(pattern), "A pattern can't contain . or .. folders.", pattern);
  });
});

test('rulesDraftErrors flags a missing, invalid or repeated pattern on the pattern field', () => {
  const errors = errorsOf({
    rules: [
      rule({ pattern: '/a/*' }),
      rule({ pattern: '' }),
      rule({ pattern: 'a/*' }),
      rule({ pattern: ' /a/* ' }),
      rule({ pattern: '/A/*' }),
      rule({ pattern: '*' }),
      rule({ pattern: '/*' }),
    ],
  });
  assert.deepEqual(errors, {
    'pattern-1': 'Add a pattern, such as /products/*.',
    'pattern-2': 'Start the pattern with /, or use /* for every page.',
    // The worker compares trimmed patterns, in their case: an earlier rule always wins.
    'pattern-3': 'A rule above already uses this pattern.',
  });
});

// ======== Rules ========

test('rulesDraftErrors flags an added rule left empty, once, on its pattern', () => {
  const blank = {
    pattern: '', workflow: '', approvers: '', cc: '',
  };
  assert.deepEqual(errorsOf({ rules: [rule(), blank] }), { 'pattern-1': 'Fill in this rule, or remove it.' });
  assert.deepEqual(errorsOf({ rules: [{ ...blank, pattern: '  ' }] }, v2), { 'pattern-0': 'Fill in this rule, or remove it.' });
  // Some content: each missing field says what it needs.
  assert.deepEqual(errorsOf({ rules: [{ ...blank, cc: 'c@x.com' }] }), {
    'pattern-0': 'Add a pattern, such as /products/*.',
    'approvers-0': 'Add at least one approver.',
  });
});

test('rulesDraftErrors refuses workflow rules and workflows in Single Step (requires-v2)', () => {
  const draft = {
    rules: [rule({ workflow: 'legal', approvers: '' }), rule({ pattern: '/b/*' })],
    workflows: [{ name: 'legal', steps: [step()] }],
  };
  assert.deepEqual(errorsOf(draft), {
    'workflow-0': "Single Step can't use workflows: use approvers instead.",
    'workflows-v1': 'Remove the workflows to save in Single Step.',
  });
  // Removing the workflows on save (dropSteps) leaves only the rule to fix.
  assert.deepEqual(errorsOf({ ...draft, dropSteps: true }), {
    'workflow-0': "Single Step can't use workflows: use approvers instead.",
  });
});

test('a workflow made of spaces is no workflow: the rule keeps and saves its approvers', () => {
  const [read] = readRules(tabsToConfig({ 'publish-workflow-config': [{ pattern: '/*', workflow: ' ', approvers: 'a@x.com' }] }));
  assert.equal(read.workflow, '');
  const rows = rulesToRows([rule({ workflow: '  ', approvers: 'a@x.com' })]);
  assert.deepEqual(rows, [{ pattern: '/*', approvers: 'a@x.com' }]);
  assert.deepEqual(errorsOf({ rules: [rule({ workflow: '  ' })] }), {});
});

// ======== Recipients ========

test('rulesDraftErrors allows at most 100 recipients per cell', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => `u${i}@x.com`).join(', ');
  assert.deepEqual(errorsOf({ rules: [rule({ approvers: list(100), cc: list(100) })] }), {});
  assert.deepEqual(errorsOf({ rules: [rule({ approvers: list(101), cc: `${list(101)}, bad` })] }), {
    'approvers-0': 'At most 100 entries.',
    'cc-0': 'At most 100 entries.',
  });
  assert.deepEqual(errorsOf({ groups: [{ group: 'dl', email: list(101) }] }), {
    'group-email-0': 'At most 100 addresses.',
  });
  const steps = { workflows: [{ name: 'w', steps: [step({ approvers: list(101) })] }] };
  assert.deepEqual(errorsOf(steps, v2), { 'step-approvers-0-0': 'At most 100 entries.' });
});

test('rulesDraftErrors hints at commas when entries are separated otherwise', () => {
  assert.deepEqual(errorsOf({ rules: [rule({ approvers: 'a@x.com; b@x.com' })] }), {
    'approvers-0': 'Not an email address or a defined list: a@x.com; b@x.com. Separate entries with commas.',
  });
  assert.deepEqual(errorsOf({ rules: [rule({ approvers: 'a@x.com b@x.com' })] }), {
    'approvers-0': 'Not an email address or a defined list: a@x.com b@x.com. Separate entries with commas.',
  });
  assert.deepEqual(errorsOf({ groups: [{ group: 'dl', email: 'a@x.com;b@x.com, nope' }] }), {
    'group-email-0': 'Not an email address: a@x.com;b@x.com, nope. Separate addresses with commas.',
  });
  // Empty entries are ignored, as in the worker.
  assert.deepEqual(errorsOf({ rules: [rule({ approvers: ', a@x.com,, ' })] }), {});
});

// ======== Workflows ========

test('rulesDraftErrors blocks workflow names that only differ in case or spaces', () => {
  const draft = {
    rules: [rule({ workflow: 'Review', approvers: '' })],
    workflows: [
      { name: 'Review', steps: [step()] },
      { name: 'review', steps: [step()] },
      { name: ' REVIEW ', steps: [step()] },
      { name: 'brand', steps: [step()] },
    ],
  };
  assert.deepEqual(errorsOf(draft, v2), {
    'workflow-name-1': 'A workflow above has this name. Names ignore case.',
    'workflow-name-2': 'A workflow above has this name. Names ignore case.',
  });
});

test('rulesDraftErrors flags added steps and workflows left empty', () => {
  const blankStep = {
    title: '', description: ' ', approvers: '', cc: '', ccCanApprove: true,
  };
  const draft = {
    workflows: [
      { name: 'legal', steps: [step(), blankStep] },
      { name: 'empty', steps: [] },
      { name: '', steps: [blankStep] },
      { name: '', steps: [] },
      { name: '', steps: [step()] },
    ],
  };
  assert.deepEqual(errorsOf(draft, v2), {
    'title-0-1': 'Fill in this step, or remove it.',
    'workflow-name-1': 'Add a step, or remove this workflow.',
    'workflow-name-2': 'Fill in this workflow, or remove it.',
    'workflow-name-3': 'Fill in this workflow, or remove it.',
    'workflow-name-4': 'Name this workflow.',
  });
});

test('an unstaffed used workflow is flagged once, not on top of an empty first step', () => {
  const draft = {
    rules: [rule({ workflow: 'legal', approvers: '' })],
    workflows: [{
      name: 'legal',
      steps: [{
        title: '', description: '', approvers: '', cc: '', ccCanApprove: false,
      }, step({ approvers: '' })],
    }],
  };
  assert.deepEqual(errorsOf(draft, v2), { 'title-0-0': 'Fill in this step, or remove it.' });
  draft.workflows[0].steps.shift();
  assert.deepEqual(errorsOf(draft, v2), {
    'step-approvers-0-0': 'Rules use this workflow: add approvers to at least one step.',
  });
});

test('a step with content but no approvers is allowed: the worker only skips it', () => {
  const draft = {
    rules: [rule({ workflow: 'legal', approvers: '' })],
    workflows: [{ name: 'legal', steps: [step(), step({ approvers: '', cc: 'c@x.com' })] }],
  };
  assert.deepEqual(errorsOf(draft, v2), {});
});

// ======== Distribution lists ========

test('rulesDraftErrors flags an added list left empty', () => {
  assert.deepEqual(errorsOf({ groups: [{ group: ' ', email: '' }] }), {
    'group-0': 'Fill in this list, or remove it.',
  });
  // A list the rules use, added for filling in, blocks until it has addresses.
  assert.deepEqual(errorsOf({
    rules: [rule({ approvers: 'dl-web' })], groups: [{ group: 'dl-web', email: '' }],
  }), { 'group-email-0': 'Add at least one email address.' });
});

// ======== Limits ========

test('rulesDraftErrors keeps each cell within 4000 characters', () => {
  const long = `/${'a'.repeat(4000)}`;
  assert.deepEqual(errorsOf({ rules: [rule({ pattern: long })] }), { 'pattern-0': 'At most 4000 characters.' });
  const emails = Array.from({ length: 90 }, (_, i) => `${'u'.repeat(40)}${i}@example.com`).join(', ');
  assert.deepEqual(errorsOf({ rules: [rule({ approvers: emails })] }), { 'approvers-0': 'At most 4000 characters.' });
  const draft = {
    workflows: [{ name: 'w', steps: [step({ description: 'd'.repeat(4001), title: 't'.repeat(4001) })] }],
  };
  assert.deepEqual(errorsOf(draft, v2), {
    'title-0-0': 'At most 4000 characters.',
    'description-0-0': 'At most 4000 characters.',
  });
  // A column the editor doesn't show is flagged on the row's first field.
  const kept = rule({ row: { pattern: '/*', notes: 'n'.repeat(4001) } });
  assert.deepEqual(errorsOf({ rules: [kept] }), {
    'pattern-0': "The notes column is longer than 4000 characters. Shorten it in the site's config.",
  });
});

test('rulesDraftErrors allows at most 20 columns per row', () => {
  const extra = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`x${i}`, 'v']));
  // rulesToRows sends pattern and approvers here, plus the kept columns.
  assert.deepEqual(errorsOf({ rules: [rule({ row: extra(18) })] }), {});
  assert.deepEqual(errorsOf({ rules: [rule({ row: extra(19) })] }), {
    'pattern-0': "This row has more than 20 columns. Remove some in the site's config.",
  });
});

test('rulesDraftErrors allows at most 500 rows per tab', () => {
  const rules = Array.from({ length: 501 }, (_, i) => rule({ pattern: `/p${i}` }));
  assert.deepEqual(errorsOf({ rules }), { 'rules-limit': 'At most 500 rules. Remove some, or use broader patterns.' });
  assert.deepEqual(errorsOf({ rules: rules.slice(1) }), {});
  const groups = Array.from({ length: 501 }, (_, i) => ({ group: `dl-${i}`, email: 'a@x.com' }));
  assert.deepEqual(errorsOf({ groups }), { 'lists-limit': 'At most 500 lists.' });
  const workflows = [
    { name: 'a', steps: Array.from({ length: 300 }, () => step()) },
    { name: 'b', steps: Array.from({ length: 201 }, () => step()) },
  ];
  assert.deepEqual(errorsOf({ workflows }, v2), { 'workflows-limit': 'At most 500 steps across all workflows.' });
});

// ======== Settings ========

const settingsDraft = (values, items = '') => ({ settings: [], values, items });

test('settingsDraftErrors accepts the values the worker accepts', () => {
  assert.deepEqual(settingsDraftErrors(settingsDraft({
    commentsRequired: 'TRUE',
    commentsLength: ' 10000 ',
    ccCanApprove: 'false',
    supportContact: 's'.repeat(254),
    guidanceTitle: 't'.repeat(200),
    guidanceText: 'x'.repeat(2000),
    accentColor: '#3b63fb',
    accentColorHover: 'rgb(10, 20, 30)',
  }, `${'i'.repeat(500)}\n\nsecond`)), {});
  ['#abc', '#abcd', '#aabbccdd', 'rebeccapurple', 'hsl(10 20% 30% / 50%)'].forEach((accentColor) => {
    assert.deepEqual(settingsDraftErrors(settingsDraft({ accentColor })), {}, accentColor);
  });
  assert.deepEqual(settingsDraftErrors(settingsDraft({})), {});
});

test('settingsDraftErrors flags each value the worker would refuse, on its field', () => {
  assert.deepEqual(settingsDraftErrors(settingsDraft({
    commentsRequired: 'yes',
    commentsLength: '0',
    ccCanApprove: '1',
    supportContact: 's'.repeat(255),
    guidanceTitle: 't'.repeat(201),
    guidanceText: 'x'.repeat(2001),
    accentColor: 'blue!',
    accentColorHover: 'var(--x)',
  }, `ok\n${'i'.repeat(501)}`)), {
    'comments-required': "Set to 'yes', not true or false: tick or untick it.",
    'comments-length': 'Enter a whole number from 1 to 10000.',
    'cc-can-approve': "Set to '1', not true or false: tick or untick it.",
    'support-contact': 'At most 254 characters.',
    'guidance-title': 'At most 200 characters.',
    'guidance-text': 'At most 2000 characters.',
    'guidance-items': 'Line 2 is longer than 500 characters.',
    'accent-color': 'Not a CSS color. Use one like #3b63fb.',
    'accent-color-hover': 'Not a CSS color. Use one like #3b63fb.',
  });
  ['10001', '1.5', '-1', '1e3', 'ten'].forEach((commentsLength) => {
    assert.deepEqual(Object.keys(settingsDraftErrors(settingsDraft({ commentsLength }))), ['comments-length'], commentsLength);
  });
});

test('settingsDraftErrors allows at most 500 settings rows', () => {
  const items = Array.from({ length: 501 }, (_, i) => `item ${i}`).join('\n');
  assert.deepEqual(settingsDraftErrors(settingsDraft({}, items)), {
    'guidance-items': 'At most 500 settings in all: remove some items.',
  });
});

test('settingsFields shows a CC approval value that is set in any form, so it can be fixed', () => {
  const workflowOnly = tabsToConfig({ 'publish-workflow-config': [{ pattern: '/*', workflow: 'legal' }] });
  ['TRUE', 'false', 'yes'].forEach((ccCanApprove) => {
    assert.ok(settingsFields('v2', workflowOnly, { ccCanApprove }).includes('ccCanApprove'), ccCanApprove);
  });
  assert.ok(!settingsFields('v2', workflowOnly, { ccCanApprove: ' ' }).includes('ccCanApprove'));
});

// ======== Editing duplicate workflow names ========

test('a duplicate workflow can be removed, or lose its last step, while its twin remains', () => {
  const rules = [rule({ pattern: '/a/*', workflow: 'Review', approvers: '' })];
  const first = { name: 'Review', steps: [step()] };
  const twin = { name: 'review ', steps: [step()] };
  const workflows = [first, twin];
  assert.equal(workflowRemovalProblem(rules, twin, workflows), null);
  assert.equal(stepRemovalProblem(rules, twin, workflows), null);
  assert.equal(workflowRemovalProblem(rules, first, workflows), null);
  // Without the twin (or a twin without steps) the rule still needs it.
  assert.match(workflowRemovalProblem(rules, first, [first]), /^Used by \/a\/\*\./);
  assert.match(workflowRemovalProblem(rules, first, [first, { name: 'review', steps: [] }]), /^Used by/);
  assert.match(stepRemovalProblem(rules, first, [first]), /^Used by/);
});

test('renaming a duplicate workflow leaves the rules with its twin', () => {
  const rules = [rule({ pattern: '/a/*', workflow: 'Review', approvers: '' })];
  const first = { name: 'Review', steps: [step()] };
  const twin = { name: 'review', steps: [step()] };
  const workflows = [first, twin];
  assert.deepEqual(rulesToRename(rules, workflows, twin), []);
  assert.deepEqual(rulesToRename(rules, workflows, first), []);
  renameWorkflow(rulesToRename(rules, workflows, twin), twin, 'brand');
  assert.equal(rules[0].workflow, 'Review');
  // Once the names differ, a rename moves the rules again.
  assert.deepEqual(rulesToRename(rules, workflows, first), rules);
});
