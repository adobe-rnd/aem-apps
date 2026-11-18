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
  // Single Step shows workflow rules and workflows as their own errors, not field errors.
  assert.deepEqual(rulesDraftErrors(draft, { v2: false }), {});
});

test('rulesDraftErrors checks distribution lists, ignoring fully blank rows', () => {
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
