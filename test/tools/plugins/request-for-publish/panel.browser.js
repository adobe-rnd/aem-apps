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
/* eslint-disable no-await-in-loop */
import '../../../../tools/plugins/request-for-publish/panel.js';

const ctx = { org: 'example', site: 'website', path: '/drafts/page' };
const row = { path: ctx.path, status: 'pending', requester: 'author@example.com', comment: 'Updated the introduction.', created: '2026-01-01T10:00:00Z' };
const base = { own: [], approvable: [], approvers: ['reviewer@example.com'], cc: [], settings: { commentsRequired: false, commentsMinLength: 1 } };
const mount = document.querySelector('#mount');
const results = [];
let current;

const tick = async () => {
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  await current?.updateComplete;
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const text = () => current.shadowRoot.textContent;
const button = (label) => [...current.shadowRoot.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
async function show(data = base, overrides = {}) {
  current = document.createElement('request-for-publish');
  current.context = ctx;
  current.client = { load: async () => structuredClone(data), ...overrides };
  mount.replaceChildren(current);
  await tick();
  return current;
}
async function test(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); } catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
}

await test('initiation derives from an empty queue, with no role selector or SMART guidance', async () => {
  await show();
  assert(button('Request publish'), 'missing request action');
  assert(!current.shadowRoot.querySelector('select'), 'role selector present');
  assert(!/SMART|Streamline Site Structure/.test(text()), 'guidance was not removed');
  assert(current.shadowRoot.querySelector('a[href*="diff.html"]'), 'missing diff link');
});
await test('pending request automatically shows requester actions', async () => {
  await show({ ...base, own: [row] });
  assert(/Awaiting approval/.test(text()), 'wrong requester status');
  assert(button('Resend notification') && button('Withdraw…'), 'missing requester actions');
  assert(!button('Approve & publish'), 'unauthorized approval shown');
});
await test('approvable request automatically shows decisions and author note', async () => {
  await show({ ...base, approvable: [row] });
  assert(button('Approve & publish') && button('Reject…'), 'missing decisions');
  assert(text().includes(row.comment), 'author note missing');
  assert(!button('Withdraw…'), 'non-owner withdrawal shown');
});
await test('overlapping roles expose both capabilities without a selector', async () => {
  await show({ ...base, own: [row], approvable: [row] });
  assert(button('Approve & publish') && button('Withdraw…'), 'overlapping roles hidden');
});
await test('loading and failed lookups cannot become an initiation form', async () => {
  let rejectLoad;
  await show(base, { load: () => new Promise((resolve, reject) => { rejectLoad = reject; }) });
  assert(!button('Request publish'), 'request form flashed during load');
  rejectLoad(new Error('Unavailable'));
  await tick();
  assert(!button('Request publish') && button('Refresh'), 'failed read is not blocked');
});
await test('reject requires a reason and confirmation', async () => {
  let count = 0;
  await show({ ...base, approvable: [row] }, { reject: async () => { count += 1; } });
  button('Reject…').click();
  await tick();
  button('Reject request').click();
  await tick();
  assert(count === 0, 'empty rejection sent');
  const reason = current.shadowRoot.querySelector('#reason');
  reason.value = 'Please correct the heading';
  reason.dispatchEvent(new Event('input', { bubbles: true }));
  button('Reject request').click();
  await tick();
  assert(count === 1, 'confirmed rejection not sent');
});
await test('double-click submission is guarded and note survives failure', async () => {
  let count = 0;
  let fail;
  await show(base, { submit: () => { count += 1; return new Promise((resolve, reject) => { fail = reject; }); } });
  const note = current.shadowRoot.querySelector('#comment');
  note.value = 'Keep this note';
  note.dispatchEvent(new Event('input', { bubbles: true }));
  const submit = button('Request publish');
  submit.click(); submit.click();
  assert(count === 1, 'duplicate submission sent');
  fail(new Error('Preview failed'));
  await tick();
  assert(current.shadowRoot.querySelector('#comment').value === 'Keep this note', 'draft lost');
});
await test('known publication followed by failure offers completion-only recovery', async () => {
  let completion = 0;
  await show({ ...base, approvable: [row] }, {
    approve: async () => { throw Object.assign(new Error('Recording failed'), { published: true }); },
    complete: async () => { completion += 1; },
  });
  button('Approve & publish').click();
  await tick();
  assert(/Published/.test(text()) && button('Retry request update'), 'partial outcome hidden');
  assert(!button('Approve & publish'), 'repeat publication offered');
  button('Retry request update').click();
  await tick();
  assert(completion === 1, 'completion retry not wired');
});
await test('late page A response cannot overwrite page B', async () => {
  let finish;
  await show(base, { load: (context) => (context.path === ctx.path ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(base)) });
  current.context = { ...ctx, path: '/drafts/second' };
  await tick();
  finish({ ...base, own: [row] });
  await tick();
  assert(text().includes('/drafts/second') && !text().includes(row.comment), 'old response displayed on new page');
});

const scenario = new URLSearchParams(location.search).get('view') || 'request';
await show({ ...base, own: scenario === 'requester' ? [row] : [], approvable: scenario === 'approver' ? [row] : [] });
document.querySelector('#results').textContent = results.join('\n');
document.documentElement.dataset.result = results.some((result) => result.startsWith('FAIL')) ? 'fail' : 'pass';
