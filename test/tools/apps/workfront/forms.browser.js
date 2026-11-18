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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const find = (selector) => document.querySelector(selector);
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const enter = (selector, value) => {
  const control = find(selector);
  control.value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  return control;
};
const checkError = (control) => {
  const error = document.getElementById(`${control.id}-error`);
  assert(control.getAttribute('aria-invalid') === 'true', `${control.id}: missing invalid state`);
  assert(control.getAttribute('aria-describedby')?.split(/\s+/).includes(error?.id), `${control.id}: missing error association`);
  assert(error?.textContent.trim(), `${control.id}: missing error text`);
  assert(!control.labels[0]?.contains(error), `${control.id}: error text is part of the field label`);
  assert(document.activeElement === control, `${control.id}: invalid field not focused`);
};
const checkClear = (control) => {
  assert(!control.hasAttribute('aria-invalid'), `${control.id}: invalid state not cleared`);
  assert(!document.getElementById(`${control.id}-error`), `${control.id}: error not cleared`);
};

export default async function runFormTests() {
  assert(new URLSearchParams(window.location.search).has('demo'), 'Run only in demo mode.');
  assert(!find('#new-task').disabled, 'Wait for demo data to load.');
  const results = [];
  find('#new-task').click();
  const name = enter('#task-name', '   ');
  find('#create-form').requestSubmit();
  checkError(name);
  assert(find('#create-error').hidden, 'Field validation became a request error.');
  name.setAttribute('aria-describedby', `${name.id}-error task-page`);
  enter('#task-name', 'Accessible form regression');
  checkClear(name);
  assert(name.getAttribute('aria-describedby') === 'task-page', 'Unrelated description was removed.');
  name.removeAttribute('aria-describedby');
  results.push('PASS create: whitespace name is associated, focused, and cleared on correction');

  enter('#task-name', '');
  find('#create-form').requestSubmit();
  checkError(name);
  find('[data-close="create-dialog"]').click();
  find('#new-task').click();
  checkClear(name);
  assert(!name.hasAttribute('aria-describedby'), 'Reopening retained an error association.');
  results.push('PASS create: required name errors reset when reopened');

  enter('#task-name', 'Accessible form regression');
  find('#create-form').requestSubmit();
  await tick();
  assert(!find('#create-dialog').open, 'Valid creation did not close the dialog.');
  const toast = document.querySelector('nx-toast');
  await toast?.updateComplete;
  assert(toast?.shadowRoot.querySelector('[role="status"]')?.textContent.includes('demo only'), 'Missing shared success notification.');
  toast.shadowRoot.querySelector('button').click();
  assert(!toast.isConnected, 'Shared toast could not be dismissed.');
  results.push('PASS create: valid submission succeeds with a dismissible shared demo notification');

  const edit = [...document.querySelectorAll('button')].find((control) => control.textContent.trim() === 'Edit task');
  assert(edit, 'Created task has no edit action.');
  edit.click();
  const editName = enter('#edit-name', '   ');
  find('#edit-form').requestSubmit();
  checkError(editName);
  assert(find('#edit-error').hidden, 'Edit validation became a request error.');
  enter('#edit-name', 'Corrected form regression');
  checkClear(editName);
  const progress = enter('#edit-progress', '101');
  find('#edit-form').requestSubmit();
  checkError(progress);
  enter('#edit-progress', '50');
  checkClear(progress);
  results.push('PASS edit: name and progress errors are associated and clear when corrected');

  enter('#edit-name', ' ');
  find('#edit-form').requestSubmit();
  checkError(editName);
  find('[data-close="edit-dialog"]').click();
  edit.click();
  checkClear(editName);
  assert(!editName.hasAttribute('aria-describedby'), 'Reopening edit retained an error association.');
  enter('#edit-name', 'Corrected form regression');
  find('#edit-form').requestSubmit();
  await tick();
  assert(!find('#edit-dialog').open, 'Valid edit did not close the dialog.');
  results.push('PASS edit: reopening resets errors and valid edits still save');

  const copy = [...document.querySelectorAll('button')].find((control) => control.textContent.trim() === 'Copy to chat');
  copy.click();
  await tick();
  const errorToast = [...document.querySelectorAll('nx-toast')].find((item) => item.variant === 'error');
  await errorToast?.updateComplete;
  assert(errorToast?.shadowRoot.querySelector('[role="alert"]')?.textContent.trim(), 'Missing shared error notification.');
  assert(document.querySelectorAll('nx-toast').length >= 2, 'Notifications did not stack.');
  results.push('PASS notifications: errors are alerts and stack with success messages');
  return results;
}
