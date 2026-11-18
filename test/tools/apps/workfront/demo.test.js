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
/* global globalThis */
/* eslint-disable import/no-relative-packages -- Repository tests import the local app package. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { connectWorkfront } from '../../../../tools/apps/workfront/api.js';
import { createDemoClient, DEMO_CONTEXT } from '../../../../tools/apps/workfront/demo.js';
import { filterCatalog, isLinkedToPage } from '../../../../tools/apps/workfront/model.js';

const page = {
  siteId: 'northstar/website',
  siteName: 'website',
  path: '/collections/fall.html',
  url: 'https://da.live/canvas#/northstar/website/collections/fall',
};

test('explicit demo activation bypasses configuration, credentials and all API requests', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'));
  const host = {
    embedded: true,
    context: page,
    actions: { daFetch: () => assert.fail('Unexpected configuration request') },
    getToken: () => assert.fail('Unexpected token access'),
  };
  const { client, context } = await connectWorkfront(host, '?other=value&demo=true');
  assert.equal(client.mode, 'demo');
  assert.deepEqual(context, page);
  const catalog = await client.load();
  const task = catalog.tasks[0];
  await client.updateTask(task, { name: 'Updated demo task' });
  await client.completeTask(task.id);
  await client.addNote(task.id, 'Demo update');
  await client.linkPage(catalog.tasks[1].id, page);
  await client.createTask({ name: 'New demo task', projectId: catalog.projects[0].id }, page);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('demo parameter presence enables standalone demo regardless of its value', async () => {
  const host = { embedded: false, context: null, actions: null };
  await Promise.all([
    '?demo', '?demo=', '?demo=true', '?demo=false', '?demo=1', '?demo=TRUE', '?other=value&demo',
  ].map(async (search) => {
    const { client, context } = await connectWorkfront(host, search);
    assert.equal(client.mode, 'demo');
    assert.deepEqual(context, DEMO_CONTEXT);
    const catalog = await client.load();
    assert.ok(isLinkedToPage(catalog.tasks[0], context));
  }));
  await Promise.all(['', '?mode=demo', '?Demo=true']
    .map((search) => assert.rejects(connectWorkfront(host, search), /Open Workfront from/)));
});

test('normal connection still loads DA configuration and uses the host token', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({ data: url.includes('ID=%24%24USER.ID') ? [{ ID: 'user', name: 'Author' }] : [] }),
    };
  });
  const configRequests = [];
  const host = {
    embedded: true,
    context: page,
    actions: {
      daFetch: async (url) => {
        configRequests.push(url);
        return {
          ok: true,
          json: async () => ({ data: [{ key: 'workfront.origin', value: 'https://example.my.workfront.com' }] }),
        };
      },
    },
    getToken: () => 'test-host-token',
  };
  const { client, context } = await connectWorkfront(host, '?other=value');
  assert.equal(client.mode, 'live');
  assert.deepEqual(context, page);
  await client.load();
  assert.deepEqual(configRequests, ['https://admin.da.live/config/northstar/website/']);
  assert.equal(requests.length, 4);
  requests.forEach(({ url, options }) => {
    assert.ok(url.startsWith('https://example.my.workfront.com/attask/api/'));
    assert.equal(options.headers.Authorization, 'Bearer test-host-token');
  });
  await assert.rejects(connectWorkfront({
    ...host,
    actions: { daFetch: async () => { throw new Error('Offline'); } },
  }), /could not be reached/);
});

test('demo catalog supports the existing scopes and exposes no Workfront record URLs', async () => {
  const client = createDemoClient(page);
  const catalog = await client.load();
  const context = { ...page, userId: catalog.userId };
  ['page', 'site', 'all', 'me', 'completed'].forEach((scope) => {
    assert.ok(filterCatalog(catalog, context, scope).tasks.length, `No demo tasks in ${scope}`);
  });
  assert.equal(filterCatalog(catalog, context, 'requested').tasks.length, 0);
  assert.ok(filterCatalog(catalog, context, 'user', 'demo-designer').tasks.length);
  const created = await client.createTask({
    name: 'Author-requested task', projectId: catalog.projects[0].id,
  }, context);
  assert.deepEqual(filterCatalog(await client.load(), context, 'requested').tasks
    .map((item) => item.id), [created.id]);
  [...catalog.projects, ...catalog.tasks].forEach((item) => assert.equal(item.url, ''));
});

test('the shared view-only demo task rejects edits and completion but remains readable', async () => {
  const client = createDemoClient(page);
  const catalog = await client.load();
  const readOnly = catalog.tasks.find((item) => item.id === 'demo-legal');
  await assert.rejects(client.updateTask(readOnly, { name: 'Changed' }), { status: 403 });
  await assert.rejects(client.completeTask(readOnly.id), { status: 403 });
  await assert.rejects(client.linkPage(readOnly.id, page), { status: 403 });
  const reloaded = await client.load();
  assert.deepEqual(reloaded.tasks.find((item) => item.id === readOnly.id), readOnly);
});

test('demo writes persist within the client, reuse validation, and do not leak through results', async () => {
  const client = createDemoClient(page);
  const catalog = await client.load();
  const context = { ...page, userId: catalog.userId };
  const projectId = catalog.projects[0].id;
  const created = await client.createTask({
    name: '  Demo task  ',
    projectId,
    description: '  Demo brief  ',
    dueDate: '2027-01-15',
    priority: 3,
    assignMe: true,
  }, context);
  assert.equal(created.name, 'Demo task');
  assert.equal(created.description, 'Demo brief');
  assert.equal(created.requesterId, catalog.userId);
  assert.deepEqual(created.assigneeIds, [catalog.userId]);
  assert.ok(isLinkedToPage(created, context));
  assert.equal(created.dueDate, '2027-01-15');
  assert.equal(created.priority, 3);
  const edited = await client.updateTask(created, {
    name: 'Edited task',
    statusCode: 'INP',
    percentComplete: 60,
    dueDate: '',
    priority: 4,
  });
  assert.equal(edited.statusCode, 'INP');
  assert.equal(edited.status, 'In progress');
  assert.equal(edited.percentComplete, 60);
  assert.equal(edited.dueDate, null);
  const completed = await client.completeTask(created.id);
  assert.equal(completed.statusCode, 'CPL');
  assert.equal(completed.percentComplete, 100);
  const note = await client.addNote(created.id, '  A demo update  ');
  assert.equal(note.author, 'Demo Author');
  assert.equal(note.text, 'A demo update');
  note.text = 'Mutated result';
  created.name = 'Mutated result';
  catalog.tasks[0].notes.length = 0;
  const reloaded = await client.load();
  const saved = reloaded.tasks.find((item) => item.id === created.id);
  assert.equal(saved.name, 'Edited task');
  assert.equal(saved.notes[0].text, 'A demo update');
  assert.equal(reloaded.tasks[0].notes.length, 1);
  const reset = await createDemoClient(page).load();
  assert.equal(reset.tasks.some((item) => item.id === created.id), false);
  await assert.rejects(client.updateTask(saved, { percentComplete: 101 }), /Progress/);
  await assert.rejects(client.addNote(saved.id, ' '), /Enter an update/);
  await assert.rejects(client.createTask({
    name: 'Task', projectId: 'missing',
  }, context), /Select a demo project/);
  await assert.rejects(client.createTask({ name: ' ', projectId }, context), /Enter a task name/);
  await assert.rejects(client.completeTask('missing'), /Demo task not found/);
});

test('demo linking is idempotent and rejects overwriting an existing page link', async () => {
  const client = createDemoClient(page);
  const catalog = await client.load();
  const unlinked = catalog.tasks.find((item) => !item.pageUrl);
  const linked = await client.linkPage(unlinked.id, page);
  assert.equal(linked.added, true);
  assert.ok(isLinkedToPage(linked.item, page));
  assert.equal((await client.linkPage(unlinked.id, page)).added, false);
  await assert.rejects(client.linkPage(unlinked.id, {
    ...page, path: '/different', url: 'https://da.live/canvas#/northstar/website/different',
  }), /already links to/);
  const reloaded = await client.load();
  assert.ok(isLinkedToPage(reloaded.tasks.find((item) => item.id === unlinked.id), page));
});
