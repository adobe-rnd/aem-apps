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
  isEmailAddress, rulesDraftErrors, settingsFields, commentsLengthDefault, tabsToConfig,
  rulesUsingWorkflow, workflowRemovalProblem, stepRemovalProblem, renameWorkflow,
} from '../../../../tools/apps/publish-requests-setup/model.js';

const rule = (fields) => ({
  pattern: '/*', workflow: '', approvers: '', cc: '', ...fields,
});
const step = (fields) => ({
  title: 'Review', description: '', approvers: '', cc: '', ccCanApprove: false, ...fields,
});

test('isEmailAddress accepts what the worker accepts', () => {
  assert.equal(isEmailAddress('a@example.com'), true);
  assert.equal(isEmailAddress('first.last+tag@sub.example.co.uk'), true);
  ['', 'dl-web', 'a@b', '@example.com', 'a b@example.com', 'a@@example.com'].forEach((value) => {
    assert.equal(isEmailAddress(value), false, value);
  });
});

test('rulesDraftErrors accepts emails and defined lists, including list names with @', () => {
  const draft = {
    rules: [rule({ approvers: 'a@x.com, DL-Web', cc: 'dl-super@adobe.com' })],
    workflows: [],
    groups: [
      { group: 'dl-web', email: 'b@x.com' },
      { group: 'dl-super@adobe.com', email: 'c@x.com, d@x.com' },
    ],
  };
  assert.deepEqual(rulesDraftErrors(draft), {});
});

test('rulesDraftErrors flags bad entries on the field that holds them', () => {
  const draft = {
    rules: [
      rule({ approvers: 'a@x.com, bob, c@x', cc: 'not an email' }),
      rule({ pattern: '/p/*', approvers: '' }),
    ],
    workflows: [],
    groups: [],
  };
  assert.deepEqual(rulesDraftErrors(draft), {
    'approvers-0': 'Not an email address or a defined list: bob, c@x',
    'cc-0': 'Not an email address or a defined list: not an email',
    'approvers-1': 'Add at least one approver.',
  });
});

test('rulesDraftErrors skips workflow rules and checks Multi Step steps only in v2', () => {
  const draft = {
    rules: [rule({ workflow: 'legal', approvers: 'junk' })],
    workflows: [
      { name: 'legal', steps: [step({ approvers: 'l@x.com', cc: 'oops' }), step({ approvers: 'dl-x' })] },
      { name: ' ', steps: [step({ approvers: 'a@x.com' })] },
    ],
    groups: [],
  };
  assert.deepEqual(rulesDraftErrors(draft, { v2: true }), {
    'step-cc-0-0': 'Not an email address or a defined list: oops',
    'step-approvers-0-1': 'Not an email address or a defined list: dl-x',
    'workflow-name-1': 'Name this workflow.',
  });
  // Single Step refuses workflow rules and workflows (the worker's requires-v2).
  assert.deepEqual(rulesDraftErrors(draft, { v2: false }), {
    'workflow-0': "Single Step can't use workflows: use approvers instead.",
    'workflows-v1': 'Remove the workflows to save in Single Step.',
  });
});

test('rulesDraftErrors checks distribution lists, including fully blank rows', () => {
  const draft = {
    rules: [rule({ approvers: 'dl-a, dl-b, dl-c' })],
    workflows: [],
    groups: [
      { group: 'dl-a', email: '' },
      { group: 'dl-b', email: 'x@y.com, nope' },
      { group: 'DL-A', email: 'z@y.com' },
      { group: 'dl-c', email: 'c@y.com' },
      { group: '', email: '' },
      { group: '', email: 'q@y.com' },
      { group: 'a,b', email: 'q@y.com' },
    ],
  };
  assert.deepEqual(rulesDraftErrors(draft), {
    'group-email-0': 'Add at least one email address.',
    'group-email-1': 'Not an email address: nope',
    'group-2': 'This list is already defined above.',
    'group-4': 'Fill in this list, or remove it.',
    'group-5': 'Name this list.',
    'group-6': "A list name can't contain a comma.",
  });
});

test('settingsFields lists only the settings each version reads', () => {
  const inline = tabsToConfig({ 'publish-workflow-config': [{ pattern: '/*', approvers: 'a@x.com' }] });
  const workflowOnly = tabsToConfig({ 'publish-workflow-config': [{ pattern: '/*', workflow: 'legal' }] });
  const common = ['commentsRequired', 'commentsLength', 'supportContact', 'accentColor', 'accentColorHover'];
  assert.deepEqual(settingsFields('v1', workflowOnly, {}).sort(), [...common, 'ccCanApprove'].sort());
  assert.deepEqual(settingsFields('v2', inline, {}).sort(), [...common, 'ccCanApprove', 'guidance'].sort());
  // In Multi Step, CC approval only applies to rules without a workflow.
  assert.deepEqual(settingsFields('v2', workflowOnly, {}).sort(), [...common, 'guidance'].sort());
  // A value that is already set stays visible, so it can be cleared.
  assert.ok(settingsFields('v2', workflowOnly, { ccCanApprove: 'true' }).includes('ccCanApprove'));
});

test('commentsLengthDefault follows each version\'s plugin', () => {
  assert.equal(commentsLengthDefault('v1'), 10);
  assert.equal(commentsLengthDefault('v2'), 1);
});

test('rulesUsingWorkflow finds the draft rules naming a workflow, in any case', () => {
  const rules = [
    rule({ pattern: '/a/*', workflow: 'Legal' }),
    rule({ pattern: '/b/*', workflow: 'brand' }),
    rule({ pattern: '/c/*', workflow: ' legal ' }),
    rule({ pattern: '/d/*' }),
  ];
  assert.deepEqual(rulesUsingWorkflow(rules, 'legal').map((r) => r.pattern), ['/a/*', '/c/*']);
  assert.deepEqual(rulesUsingWorkflow(rules, 'LEGAL ').map((r) => r.pattern), ['/a/*', '/c/*']);
  assert.deepEqual(rulesUsingWorkflow(rules, 'other'), []);
  // A blank name is no workflow: rules without one don't "use" it.
  assert.deepEqual(rulesUsingWorkflow(rules, ' '), []);
});

test('workflowRemovalProblem refuses a workflow rules use, and allows it once none does', () => {
  const legal = { name: 'multi-step-test-2', steps: [step({ approvers: 'a@x.com' })] };
  const rules = [rule({ pattern: '/drafts/multi-step-test-2/*', workflow: 'Multi-Step-Test-2' })];
  assert.equal(
    workflowRemovalProblem(rules, legal),
    "Used by /drafts/multi-step-test-2/*. Change that rule's workflow first.",
  );
  rules.push(rule({ pattern: '', workflow: 'multi-step-test-2' }));
  assert.equal(
    workflowRemovalProblem(rules, legal),
    "Used by /drafts/multi-step-test-2/*, rule 2. Change those rules' workflow first.",
  );
  // The draft as edited counts: rules moved to None or another workflow, or removed, free it.
  rules[0].workflow = '';
  rules[1].workflow = 'brand';
  assert.equal(workflowRemovalProblem(rules, legal), null);
  assert.equal(workflowRemovalProblem([], legal), null);
});

test('stepRemovalProblem keeps the last step of a workflow rules use', () => {
  const rules = [rule({ pattern: '/a/*', workflow: 'legal' })];
  const one = { name: 'legal', steps: [step({ approvers: 'a@x.com' })] };
  const two = { name: 'legal', steps: [step({ approvers: 'a@x.com' }), step()] };
  assert.equal(
    stepRemovalProblem(rules, one),
    "Used by /a/*. A workflow needs at least one step: add another first, or change that rule's workflow.",
  );
  assert.equal(stepRemovalProblem(rules, two), null);
  assert.equal(stepRemovalProblem([], one), null);
});

test('renameWorkflow moves the rules that used the old name, even past blanks and clashes', () => {
  const rules = [
    rule({ pattern: '/a/*', workflow: 'legal' }),
    rule({ pattern: '/b/*', workflow: 'legal-x' }),
    rule({ pattern: '/c/*' }),
  ];
  const legal = { name: 'legal', steps: [step()] };
  // The rules to move are taken once, when the rename starts.
  const linked = rulesUsingWorkflow(rules, legal.name);
  renameWorkflow(linked, legal, '');
  // While the name is blank, the rules keep the last name.
  assert.equal(rules[0].workflow, 'legal');
  assert.equal(legal.name, '');
  renameWorkflow(linked, legal, 'legal-');
  renameWorkflow(linked, legal, 'legal-x');
  // Passing through another workflow's name doesn't take its rules along.
  renameWorkflow(linked, legal, ' legal-xy ');
  assert.deepEqual(rules.map((r) => r.workflow), ['legal-xy', 'legal-x', '']);
  assert.equal(legal.name, ' legal-xy ');
});

test('rulesDraftErrors flags a rule whose workflow is missing or has no steps, in v2', () => {
  const draft = {
    rules: [
      rule({ pattern: '/a/*', workflow: 'Legal' }),
      rule({ pattern: '/b/*', workflow: 'gone' }),
      rule({ pattern: '/c/*', workflow: 'empty' }),
    ],
    workflows: [
      { name: 'legal', steps: [step({ approvers: 'a@x.com' })] },
      { name: 'empty', steps: [] },
    ],
    groups: [],
  };
  assert.deepEqual(rulesDraftErrors(draft, { v2: true }), {
    'workflow-1': "There's no workflow gone. Pick one, or None.",
    'workflow-2': "There's no workflow empty. Pick one, or None.",
    'workflow-name-1': 'Add a step, or remove this workflow.',
  });
});

test('rulesDraftErrors flags a workflow rules use when none of its steps can approve', () => {
  const draft = {
    rules: [rule({ pattern: '/a/*', workflow: 'legal' })],
    workflows: [
      { name: 'legal', steps: [step(), step({ cc: 'c@x.com' })] },
      // Unused: the worker only skips its steps, so no error here.
      { name: 'draft', steps: [step()] },
      { name: 'cc', steps: [step({ cc: 'c@x.com', ccCanApprove: true })] },
    ],
    groups: [],
  };
  assert.deepEqual(rulesDraftErrors(draft, { v2: true }), {
    'step-approvers-0-0': 'Rules use this workflow: add approvers to at least one step.',
  });
  draft.rules.push(rule({ pattern: '/b/*', workflow: 'cc' }));
  assert.equal(Object.keys(rulesDraftErrors(draft, { v2: true })).length, 1);
  draft.workflows[0].steps[1].approvers = 'b@x.com';
  assert.deepEqual(rulesDraftErrors(draft, { v2: true }), {});
});
