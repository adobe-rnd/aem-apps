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
import fixture, { singleStep } from './fixture-client.js';

const ctx = { org: 'example', site: 'website', path: '/drafts/page' };
const row = {
  path: ctx.path, status: 'pending', requester: 'author@example.com', comment: 'Updated the introduction.', created: '2026-01-01T10:00:00Z', step: '',
};
const twoSteps = [
  {
    index: 1, title: 'Legal review', description: 'Claims and disclaimers.', approvers: ['legal@example.com'], cc: [],
  },
  {
    index: 2, title: 'Brand review', description: 'Tone and imagery.', approvers: ['brand@example.com'], cc: ['watcher@example.com'],
  },
];
const base = {
  own: [], approvable: [], page: [], approvers: ['reviewer@example.com'], cc: [], steps: singleStep, settings: { commentsRequired: false, commentsMinLength: 1 },
};
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
const stepClass = (index) => current.shadowRoot.querySelectorAll('.step')[index - 1]?.className;
// Step bodies are collapsed by default; expand before asserting on their contents.
const open = async (index = 1) => { current.toggle(index); await tick(); };
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
await test('request form only shows a hint when a minimum note length is required', async () => {
  await show();
  assert(!current.shadowRoot.querySelector('#comment-hint'), 'unnecessary request hint shown');
  assert(current.shadowRoot.querySelector('#comment').getAttribute('aria-describedby') === 'field-error', 'optional note references a missing hint');
  await show({ ...base, settings: { commentsRequired: true, commentsMinLength: 10 } });
  assert(current.shadowRoot.querySelector('#comment-hint')?.textContent === 'At least 10 characters.', 'required note length hint missing');
  assert(current.shadowRoot.querySelector('#comment').getAttribute('aria-describedby') === 'comment-hint field-error', 'required note is not linked to its hint');
});
await test('pending request automatically shows requester actions', async () => {
  await show({ ...base, own: [row] });
  assert(/Awaiting approval/.test(text()), 'wrong requester status');
  await open();
  assert(button('Resend notification') && button('Withdraw…'), 'missing requester actions');
  assert(!button('Approve & publish'), 'unauthorized approval shown');
});
await test('approvable request automatically shows decisions and author note', async () => {
  await show({ ...base, approvable: [row] });
  assert(button('Approve & publish'), 'missing inline approval on the collapsed current step');
  await open();
  assert(button('Reject…'), 'missing rejection');
  assert(text().includes(row.comment), 'author note missing');
  assert(!button('Withdraw…'), 'non-owner withdrawal shown');
});
await test('overlapping roles expose both capabilities without a selector', async () => {
  await show({ ...base, own: [row], approvable: [row] });
  await open();
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
  await open();
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
await test('double-click guard and draft preservation', async () => {
  let count = 0;
  let fail;
  await show(base, {
    submit: () => { count += 1; return new Promise((resolve, reject) => { fail = reject; }); },
  });
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
await test('publication failure offers completion-only recovery', async () => {
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
await test('publication remains visible when the follow-up status read fails', async () => {
  let broken = false;
  await show({ ...base, approvable: [row] }, {
    load: async () => {
      if (broken) throw new Error('Status unavailable');
      return { ...base, approvable: [row] };
    },
    approve: async () => {
      broken = true;
      throw Object.assign(new Error('Recording failed'), { published: true });
    },
  });
  button('Approve & publish').click();
  await tick();
  assert(/Published/.test(text()), 'confirmed publication disappeared after a read failure');
  assert(!button('Approve & publish'), 'repeat publication offered');
});
await test('published page with no remaining request does not offer an unsafe retry', async () => {
  let removed = false;
  await show({ ...base, approvable: [row] }, {
    load: async () => ({ ...base, approvable: removed ? [] : [row] }),
    approve: async () => {
      removed = true;
      throw Object.assign(new Error('Notification failed'), { published: true });
    },
  });
  button('Approve & publish').click();
  await tick();
  assert(!button('Retry request update'), 'retry offered for a request that has disappeared');
  assert(!button('Request publish'), 'new request form masks incomplete outcome');
});

await test('ambiguous publication blocks another publish attempt', async () => {
  let published = 0;
  await show({ ...base, approvable: [row] }, {
    approve: async () => {
      published += 1;
      throw Object.assign(new Error('Response lost'), { publishUnknown: true });
    },
  });
  button('Approve & publish').click();
  await tick();
  assert(/Publication outcome unknown/.test(text()), 'unknown publication is not explicit');
  assert(!button('Approve & publish'), 'a normal second publish is still available');
  await current.act('approve');
  assert(published === 1, 'programmatic second action was not guarded');
});
await test('page changes clear stale content before the first new render', async () => {
  await show({ ...base, own: [row] }, {
    load: (context) => (context.path === ctx.path
      ? Promise.resolve({ ...base, own: [row] }) : new Promise(() => {})),
  });
  current.context = { ...ctx, path: '/drafts/second' };
  await current.updateComplete;
  assert(!button('Request publish') && !text().includes(row.comment), 'old content or premature form flashed');
});
await test('primary button has AA text contrast in light and dark themes', async () => {
  await show({ ...base, approvable: [row] });
  const luminance = (color) => color.match(/\d+(?:\.\d+)?/g).slice(0, 3)
    .map((channel) => Number(channel) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  const previous = document.documentElement.style.colorScheme;
  try {
    ['light', 'dark'].forEach((scheme) => {
      document.documentElement.style.colorScheme = scheme;
      const styles = getComputedStyle(button('Approve & publish'));
      const colors = [luminance(styles.color), luminance(styles.backgroundColor)]
        .sort((a, b) => a - b);
      assert((colors[1] + 0.05) / (colors[0] + 0.05) >= 4.5, `${scheme} button contrast below 4.5`);
    });
  } finally { document.documentElement.style.colorScheme = previous; }
});

await test('site theme colours the primary action and links with AA contrast, and clears when absent', async () => {
  const luminance = (color) => color.match(/\d+(?:\.\d+)?/g).slice(0, 3)
    .map((channel) => Number(channel) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (styles) => {
    const colors = [luminance(styles.color), luminance(styles.backgroundColor)]
      .sort((a, b) => a - b);
    return (colors[1] + 0.05) / (colors[0] + 0.05);
  };
  const settings = { ...base.settings, accentColor: '#903', accentColorHover: '#730026' };
  await show({ ...base, approvable: [row], settings });
  const previous = document.documentElement.style.colorScheme;
  try {
    ['light', 'dark'].forEach((scheme) => {
      document.documentElement.style.colorScheme = scheme;
      const styles = getComputedStyle(button('Approve & publish'));
      assert(styles.backgroundColor === 'rgb(153, 0, 51)', `${scheme} primary action ignores theme.accent-color`);
      assert(contrast(styles) >= 4.5, `${scheme} themed button contrast below 4.5`);
      const link = getComputedStyle(current.shadowRoot.querySelector('footer a'));
      assert(link.color === 'rgb(153, 0, 51)', `${scheme} link ignores theme.accent-color`);
    });
  } finally { document.documentElement.style.colorScheme = previous; }
  assert(current.style.getPropertyValue('--pw-accent-hover') === '#730026', 'hover accent not applied');
  current.client = { load: async () => structuredClone({ ...base, approvable: [row] }) };
  await tick();
  assert(getComputedStyle(button('Approve & publish')).backgroundColor !== 'rgb(153, 0, 51)', 'stale theme kept for an unthemed site');
});

await test('late page A response cannot overwrite page B', async () => {
  let finish;
  await show(base, {
    load: (context) => (context.path === ctx.path
      ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(base)),
  });
  current.context = { ...ctx, path: '/drafts/second' };
  await tick();
  finish({ ...base, own: [row] });
  await tick();
  assert(text().includes('/drafts/second') && !text().includes(row.comment), 'old response displayed on new page');
});

const enter = (selector, value) => {
  const field = current.shadowRoot.querySelector(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
const mutations = (calls) => calls.filter((call) => call.body || ['preview', 'publish'].includes(call.route));

await test('local integration: request, approver review and successful publication', async () => {
  const { client, calls, state } = fixture();
  await show(base, client);
  enter('#comment', 'Please review the updated introduction.');
  button('Request publish').click();
  await tick();
  assert(text().includes('Request sent.'), 'requester did not become pending');
  await open();
  assert(button('Withdraw…'), 'requester actions missing after submission');
  state.role = 'approver';
  await current.refresh();
  await tick();
  assert(text().includes('Please review the updated introduction.'), 'reviewer lost request note');
  button('Approve & publish').click();
  await tick();
  assert(text().includes('Published. The publish request is complete.'), 'approval completion missing');
  assert(state.rows.length === 0, 'approved request remains pending');
  assert(mutations(calls).map((call) => call.route).join(',')
    === 'preview,/api/requests,publish,/api/requests/approve', 'incorrect approval sequence');
  const { body } = mutations(calls)[1];
  assert(Object.keys(body).sort().join(',') === 'comment,org,path,site', 'client supplied identity or recipients');
});
await test('local integration: request, denial validation, cancel and confirmed denial', async () => {
  const { client, calls, state } = fixture();
  await show(base, client);
  button('Request publish').click();
  await tick();
  state.role = 'approver';
  await current.refresh();
  await tick();
  await open();
  button('Reject…').click();
  await tick();
  button('Cancel').click();
  await tick();
  assert(button('Approve & publish'), 'cancel did not restore review');
  button('Reject…').click();
  await tick();
  button('Reject request').click();
  await tick();
  assert(text().includes('Enter a reason for rejection.'), 'missing denial validation');
  assert(!calls.some((call) => call.route.endsWith('/reject')), 'empty denial sent');
  enter('#reason', 'Please correct the page heading.');
  button('Reject request').click();
  await tick();
  assert(text().includes('Request rejected.') && state.rows.length === 0, 'denial did not complete');
  assert(!calls.some((call) => call.route === 'publish'), 'denial published content');
  assert(calls.find((call) => call.route.endsWith('/reject')).body.reason === 'Please correct the page heading.', 'denial reason lost');
});
await test('local integration: resend then withdraw without another preview or publication', async () => {
  const { client, calls, state } = fixture({ rows: [row] });
  await show(base, client);
  await open();
  button('Resend notification').click();
  await tick();
  assert(text().includes('Notification sent again.'), 'resend receipt missing');
  assert(state.rows[0].comment === row.comment, 'resend changed note');
  button('Withdraw…').click();
  await tick();
  button('Withdraw request').click();
  await tick();
  assert(text().includes('Request withdrawn.') && state.rows.length === 0, 'withdrawal incomplete');
  assert(mutations(calls).map((call) => call.route).join(',') === '/api/requests,/api/requests/withdraw', 'unexpected content mutation');
});
await test('local integration: required note blocks preview and submission', async () => {
  const { client, calls } = fixture({ required: true });
  await show(base, client);
  enter('#comment', 'Short');
  button('Request publish').click();
  await tick();
  assert(text().includes('Enter at least 10 characters.'), 'required note not validated');
  assert(mutations(calls).length === 0, 'invalid request produced mutations');
});
await test('local integration: preview failure keeps the note and sends no request', async () => {
  const { client, calls } = fixture({ failPreview: 503 });
  await show(base, client);
  enter('#comment', 'Preserve this review note.');
  button('Request publish').click();
  await tick();
  assert(text().includes('Preview failed'), 'preview failure not reported');
  assert(current.shadowRoot.querySelector('#comment').value === 'Preserve this review note.', 'note lost');
  assert(mutations(calls).map((call) => call.route).join(',') === 'preview', 'request sent after preview failure');
});
await test('local integration: completion retry does not publish twice', async () => {
  const { client, calls, state } = fixture({ role: 'approver', rows: [row], failRecord: true });
  await show(base, client);
  button('Approve & publish').click();
  await tick();
  assert(button('Retry request update') && !button('Approve & publish'), 'unsafe recovery controls');
  state.failRecord = false;
  button('Retry request update').click();
  await tick();
  assert(text().includes('The publish request is now complete.'), 'recovery incomplete');
  assert(calls.filter((call) => call.route === 'publish').length === 1, 'recovery republished');
});
await test('local integration: unknown publication cannot be retried', async () => {
  const { client, calls } = fixture({ role: 'approver', rows: [row], unknownPublish: true });
  await show(base, client);
  button('Approve & publish').click();
  await tick();
  assert(text().includes('Publication outcome unknown'), 'unknown outcome hidden');
  assert(!button('Approve & publish') && !button('Retry request update'), 'unsafe retry offered');
  await current.act('approve');
  assert(calls.filter((call) => call.route === 'publish').length === 1, 'unknown publication retried');
  assert(!calls.some((call) => call.route.endsWith('/approve')), 'unconfirmed publication recorded');
});

await test('resolved request notice lists the possible outcomes without refresh guidance', async () => {
  const { client, state } = fixture({ rows: [row] });
  await show(base, client);
  state.rows = [];
  await current.refresh();
  await tick();
  assert(current.shadowRoot.querySelector('.notice')?.textContent === 'This request is no longer pending. It has been approved, rejected or withdrawn.', 'incorrect resolved request notice');
});

await test('every step is listed with its title and description, collapsed by default', async () => {
  await show({ ...base, steps: twoSteps, approvable: [row] });
  assert(current.shadowRoot.querySelectorAll('.step').length === 2, 'steps not listed');
  assert(text().includes('Legal review') && text().includes('Claims and disclaimers.'), 'step title or description missing');
  assert(!current.shadowRoot.querySelector('.step-body'), 'a step body was expanded by default');
  assert(/Step 1 of 2/.test(text()), 'step position missing from the summary');
});
await test('an intermediate step approves without publishing', async () => {
  await show({ ...base, steps: twoSteps, approvable: [row] });
  assert(button('Approve') && !button('Approve & publish'), 'intermediate step offers publication');
});
await test('approving names the step that was notified next', async () => {
  await show({ ...base, steps: twoSteps, approvable: [row] }, { approve: async () => {} });
  button('Approve').click();
  await tick();
  assert(text().includes('Brand review'), 'next step not named in the approval notice');
});
await test('an untitled next step is named by its number', async () => {
  const mixed = [twoSteps[0], { ...twoSteps[1], title: '' }];
  await show({ ...base, steps: mixed, approvable: [row] }, { approve: async () => {} });
  button('Approve').click();
  await tick();
  assert(text().includes('Step 2'), 'untitled next step not named by number');
});
await test('the last staffed step publishes even when later steps are empty', async () => {
  const empty = {
    index: 2, title: 'Empty', description: '', approvers: [], cc: [],
  };
  await show({ ...base, steps: [twoSteps[0], empty], approvable: [row] });
  assert(button('Approve & publish'), 'last staffed step does not publish');
});
await test('the final step is the only one that publishes', async () => {
  const approved = { ...row, step: 'legal@example.com:1:2026-01-01T11:00:00Z' };
  await show({ ...base, steps: twoSteps, approvable: [approved] });
  assert(button('Approve & publish') && !button('Approve'), 'final step does not publish');
  assert(/Step 2 of 2/.test(text()), 'wrong current step');
});
await test('completed steps show their approver and expand to the approval time', async () => {
  const approved = { ...row, step: 'legal@example.com:1:2026-01-01T11:00:00Z' };
  await show({ ...base, steps: twoSteps, approvable: [approved] });
  assert(/approved/.test(stepClass(1)) && /current/.test(stepClass(2)), 'wrong step states');
  assert(text().includes('Approved by legal@example.com'), 'approver missing from the completed step');
  await open(1);
  assert(current.shadowRoot.querySelector('time[datetime="2026-01-01T11:00:00Z"]'), 'approval time missing');
});
await test('an upcoming step is inert and expands to its approvers', async () => {
  await show({ ...base, steps: twoSteps, approvable: [row] });
  assert(/upcoming/.test(stepClass(2)), 'later step is not marked upcoming');
  await open(2);
  assert(text().includes('brand@example.com') && text().includes('watcher@example.com'), 'upcoming approvers or cc missing');
  assert(!button('Approve') || button('Approve').closest('.step-body') === null, 'upcoming step offers an action');
});
await test('an approver of a later step cannot act on the current one', async () => {
  await show({ ...base, steps: twoSteps, approvable: [{ ...row, canApproveNow: false }] });
  assert(!button('Approve') && !button('Approve & publish'), 'action offered outside the current step');
  await open(1);
  assert(!button('Reject…'), 'rejection offered outside the current step');
});
await test('an uninvolved viewer sees a read-only stepper, not an initiation form', async () => {
  await show({ ...base, steps: twoSteps, page: [row] });
  assert(!button('Request publish'), 'initiation form offered while a request is pending');
  assert(current.shadowRoot.querySelectorAll('.step').length === 2, 'steps not listed');
  assert(/Awaiting approval/.test(text()), 'wrong status for an uninvolved viewer');
  await open(1);
  assert(!button('Approve') && !button('Reject…') && !button('Withdraw…'), 'actions offered to an uninvolved viewer');
  assert(!current.shadowRoot.querySelector('.decision-actions'), 'empty action row rendered');
});
const untitledStep = [{
  index: 1, title: '', description: '', approvers: ['reviewer@example.com'], cc: [],
}];
await test('a lone unlabelled step renders no stepper', async () => {
  await show({ ...base, steps: untitledStep });
  assert(!current.shadowRoot.querySelector('.steps'), 'stepper shown for a single unlabelled step');
  assert(!/Step 1/.test(text()), 'placeholder step label shown');
  assert(button('Request publish'), 'missing request action');
  assert(current.shadowRoot.querySelector('a[href*="diff.html"]'), 'missing review link');
});
await test('a lone unlabelled step keeps the decisions inline', async () => {
  await show({ ...base, steps: untitledStep, approvable: [row] });
  assert(!current.shadowRoot.querySelector('.steps'), 'stepper shown for a single unlabelled step');
  assert(button('Approve & publish') && button('Reject…'), 'decisions missing without a stepper');
  assert(text().includes(row.comment), 'author note missing');
  assert(/Pending approval/.test(text()), 'step counter shown for a single step');
});
await test('a lone unlabelled step keeps the requester actions inline', async () => {
  await show({ ...base, steps: untitledStep, own: [row] });
  assert(button('Resend notification') && button('Withdraw…'), 'requester actions missing without a stepper');
  assert(!button('Approve & publish'), 'unauthorized approval shown');
});
await test('a step with no approvers is skipped', async () => {
  const gapped = [twoSteps[0], {
    index: 2, title: 'Unstaffed', description: '', approvers: [], cc: [],
  }, { ...twoSteps[1], index: 3 }];
  await show({ ...base, steps: gapped, approvable: [{ ...row, step: 'legal@example.com:1:T' }] });
  assert(/skipped/.test(stepClass(2)), 'unstaffed step not skipped');
  assert(/current/.test(stepClass(3)), 'current step did not move past the skipped one');
});
await test('local integration: a two-step request publishes only on the last approval', async () => {
  const { client, calls, state } = fixture({ role: 'approver', rows: [row], steps: twoSteps });
  await show({ ...base, steps: twoSteps }, client);
  button('Approve').click();
  await tick();
  assert(text().includes('Step approved.') && text().includes('Brand review'), 'intermediate approval not reported');
  assert(!calls.some((call) => call.route === 'publish'), 'intermediate approval published');
  assert(state.rows.length === 1 && state.rows[0].step.includes(':1:'), 'step log not written');
  assert(/Step 2 of 2/.test(text()), 'request did not advance');
  button('Approve & publish').click();
  await tick();
  assert(calls.filter((call) => call.route === 'publish').length === 1, 'final approval did not publish');
  assert(state.rows.length === 0, 'completed request remains pending');
  assert(calls.filter((call) => call.route === '/api/requests/approve')
    .map((call) => call.body.step).join(',') === '1,2', 'client did not send the step it acted on');
});
await test('local integration: approving a step someone else advanced is refused', async () => {
  const { client, calls, state } = fixture({ role: 'approver', rows: [row], steps: twoSteps });
  await show({ ...base, steps: twoSteps }, client);
  state.rows = [{ ...row, step: 'someone@example.com:1:T' }];
  button('Approve').click();
  await tick();
  assert(!calls.some((call) => call.route === 'publish'), 'stale approval published');
  assert(/changed|no longer pending|advanced/.test(text()), 'stale approval was not reported');
});

const scenario = new URLSearchParams(window.location.search).get('view') || 'request';
const demo = fixture({ role: scenario === 'approver' ? 'approver' : 'requester', rows: scenario === 'request' ? [] : [row] });
await show(base, demo.client);
document.querySelector('#results').textContent = results.join('\n');
document.documentElement.dataset.result = results.some((result) => result.startsWith('FAIL')) ? 'fail' : 'pass';
