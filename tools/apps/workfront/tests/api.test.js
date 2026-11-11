import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkfrontClient } from '../api.js';

const page = { siteId: 'northstar/website', path: '/collections/fall.html', url: 'https://da.live/canvas#/northstar/website/collections/fall' };
const link = { siteId: 'northstar/website', path: '/collections/fall', url: page.url };
const task = { ID: 'task-1', name: 'Write copy', projectID: 'project-1' };
const options = {
  workfrontOrigin: 'https://northstar.my.workfront.com',
  apiVersion: 'v21.0',
  getToken: () => 'ims-access-token',
};
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const isCurrentUser = (url) => url.includes('/user/search?ID=%24%24USER.ID&');

test('direct mode requires a safe Workfront origin and supported API version', () => {
  assert.throws(() => createWorkfrontClient({ ...options, workfrontOrigin: 'https://attacker.example' }), /valid HTTPS/);
  assert.throws(() => createWorkfrontClient({ ...options, workfrontOrigin: 'http://northstar.my.workfront.com' }), /valid HTTPS/);
  assert.throws(() => createWorkfrontClient({ ...options, apiVersion: 'latest' }), /supported Workfront API version/);
});

test('proxy mode sends API calls to the proxy but keeps tenant links', async () => {
  assert.throws(() => createWorkfrontClient({ ...options, proxyOrigin: 'http://proxy.example' }), /valid HTTPS Workfront proxy/);
  const urls = [];
  const client = createWorkfrontClient({ ...options, proxyOrigin: 'https://wf-proxy.example.workers.dev/', fetchImpl: async (url) => {
    urls.push(url);
    if (isCurrentUser(url)) return response([{ ID: 'alex', name: 'Alex' }]);
    if (url.includes('/task/')) return response([task]);
    return response([]);
  } });
  const catalog = await client.load();
  assert.equal(urls.every((url) => url.startsWith('https://wf-proxy.example.workers.dev/attask/api/v21.0/')), true);
  assert.equal(catalog.tasks[0].url, 'https://northstar.my.workfront.com/task/task-1/overview');
});

test('catalog calls the tenant API with the host bearer token and normalizes records', async () => {
  const calls = [];
  const client = createWorkfrontClient({ ...options, fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.Authorization, 'Bearer ims-access-token');
    assert.equal(init.headers.SessionID, undefined);
    assert.match(url, /^https:\/\/northstar\.my\.workfront\.com\/attask\/api\/v21\.0\//);
    if (isCurrentUser(url)) return response([{ ID: 'alex', name: 'Alex Morgan', roleID: 'designer', userRoles: [{ roleID: 'editor' }] }]);
    if (url.includes('/user/search')) return response([{ ID: 'alex', name: 'Alex Morgan' }]);
    if (url.includes('/project/')) return response([{ ID: 'project-1', name: 'Fall launch', ownerID: 'sam', projectUsers: [{ userID: 'alex' }], URL: 'https://da.live/#/northstar/website' }]);
    return response([{ ...task, assignedToID: 'alex', assignments: [{ assignedToID: 'alex', roleID: 'designer' }, { roleID: 'editor' }], URL: page.url, notes: [{ noteText: 'Approved messaging.', owner: { name: 'Sam' } }] }]);
  } });
  const catalog = await client.load();
  assert.equal(catalog.userId, 'alex');
  assert.equal(calls.some((url) => url.includes('/user/search?ID=%24%24USER.ID&fields=ID%2Cname')), true);
  assert.equal(calls.some((url) => url.includes('/user/current')), false);
  assert.equal(calls.some((url) => url.includes('/session')), false);
  assert.deepEqual(catalog.tasks[0].pageLinks, [link]);
  assert.deepEqual(catalog.projects[0].siteIds, [page.siteId]);
  assert.deepEqual(catalog.projects[0].pageLinks, []);
  assert.equal(calls.some((url) => url.includes('/task/search') && url.includes('%2CURL%2C')), true);
  assert.equal(calls.some((url) => url.includes('parameterValues')), false);
  assert.equal(catalog.projects[0].ownerId, 'sam');
  assert.deepEqual(catalog.projects[0].memberIds, ['sam', 'alex']);
  assert.equal(calls.some((url) => url.includes('/project/search') && url.includes('ownerID%2CprojectUsers%3AuserID')), true);
  assert.deepEqual(catalog.tasks[0].assigneeIds, ['alex']);
  assert.deepEqual(catalog.tasks[0].roleIds, ['editor']);
  assert.deepEqual(catalog.users, [{ id: 'alex', name: 'Alex Morgan', roleIds: ['designer', 'editor'] }]);
  assert.equal(catalog.tasks[0].notes[0].text, 'Approved messaging.');
  assert.equal(catalog.tasks[0].url, 'https://northstar.my.workfront.com/task/task-1/overview');
});

test('a task is reread before linking and an existing association is never rewritten', async () => {
  const calls = [];
  const client = createWorkfrontClient({ ...options, fetchImpl: async (url, init) => {
    calls.push(init.method);
    return response({ ...task, URL: 'https://main--website--northstar.aem.live/collections/fall' });
  } });
  assert.equal((await client.linkPage(task.ID, page)).added, false);
  assert.deepEqual(calls, ['GET']);
});

test('concurrent clicks share one write to the URL field', async () => {
  let writes = 0;
  const client = createWorkfrontClient({ ...options, fetchImpl: async (url, init) => {
    if (init.method === 'PUT') {
      writes += 1;
      assert.deepEqual([...init.body.keys()], ['URL']);
      assert.equal(init.body.get('URL'), page.url);
      return response({ ID: task.ID });
    }
    return response({ ...task, URL: '' });
  } });
  await Promise.all([client.linkPage(task.ID, page), client.linkPage(task.ID, page)]);
  assert.equal(writes, 1);
});

test('linking never overwrites a URL that points elsewhere', async () => {
  const methods = [];
  const client = createWorkfrontClient({ ...options, fetchImpl: async (url, init) => {
    methods.push(init.method);
    return response({ ...task, URL: 'https://da.live/canvas#/northstar/website/about' });
  } });
  await assert.rejects(client.linkPage(task.ID, page), /already links to https:\/\/da.live\/canvas#\/northstar\/website\/about/);
  assert.deepEqual(methods, ['GET']);
});

test('task creation submits the page URL in a single write', async () => {
  let writes = 0;
  const client = createWorkfrontClient({ ...options, fetchImpl: async (url, init) => {
    writes += 1;
    assert.equal(init.method, 'POST');
    assert.equal(init.body.get('projectID'), 'project-1');
    assert.equal(init.body.get('URL'), page.url);
    assert.equal(init.body.has('DE:EW Page Links'), false);
    return response({ ...task, URL: init.body.get('URL') });
  } });
  const created = await client.createTask({ name: 'Write copy', projectId: 'project-1' }, page);
  assert.equal(writes, 1);
  assert.deepEqual(created.pageLinks, [link]);
});

test('authentication and permission errors have actionable messages', async () => {
  for (const status of [401, 403]) {
    const client = createWorkfrontClient({ ...options, fetchImpl: async () => response(null, status) });
    await assert.rejects(client.load(), (error) => error.status === status && /token|permission/.test(error.message));
  }
});

test('other API errors include the Workfront error message', async () => {
  const client = createWorkfrontClient({ ...options, fetchImpl: async () => response({ error: { message: 'Unsupported query' } }, 400) });
  await assert.rejects(client.load(), (error) => error.status === 400 && /\(400\): Unsupported query/.test(error.message));
});

test('the latest host token is read for each direct API request', async () => {
  let token = 'first-ims-token';
  const headers = [];
  const client = createWorkfrontClient({
    ...options,
    getToken: () => token,
    fetchImpl: async (url, init) => {
      headers.push(init.headers.Authorization);
      if (isCurrentUser(url)) return response([{ ID: 'alex', name: 'Alex Morgan' }]);
      if (url.includes('/user/search')) return response([]);
      return response([]);
    },
  });
  await client.load();
  token = 'refreshed-ims-token';
  await client.load();
  assert.equal(headers.includes('Bearer first-ims-token'), true);
  assert.equal(headers.includes('Bearer refreshed-ims-token'), true);
});

test('missing host token blocks the request without sending credentials', async () => {
  let calls = 0;
  const client = createWorkfrontClient({ ...options, getToken: () => '', fetchImpl: async () => { calls += 1; } });
  await assert.rejects(client.load(), /Experience Workspace Workfront token is unavailable/);
  assert.equal(calls, 0);
});

test('unrecognized URL values are ignored rather than inferring a match', async () => {
  const client = createWorkfrontClient({ ...options, fetchImpl: async (url) => {
    if (isCurrentUser(url)) return response([{ ID: 'alex', name: 'Alex' }]);
    if (url.includes('/task/')) return response([{ ...task, URL: 'https://example.com/fall' }]);
    return response([]);
  } });
  const [loaded] = (await client.load()).tasks;
  assert.deepEqual([loaded.pageLinks, loaded.siteIds, loaded.pageUrl], [[], [], 'https://example.com/fall']);
});

test('failed writes are marked uncertain and are not automatically retried', async () => {
  let calls = 0;
  const client = createWorkfrontClient({ ...options, fetchImpl: async () => { calls += 1; throw new TypeError('Network failure'); } });
  await assert.rejects(client.createTask({ name: 'New copy', projectId: 'project-1' }, page), (error) => error.uncertain);
  assert.equal(calls, 1);
});

test('an incomplete success response does not invite a duplicate task creation', async () => {
  const client = createWorkfrontClient({ ...options, fetchImpl: async () => response({ ID: 'new-task' }) });
  await assert.rejects(client.createTask({ name: 'New copy', projectId: 'project-1' }, page), (error) => error.uncertain && /may have been created/.test(error.message));
});

test('catalog paginates instead of silently truncating All', async () => {
  let pages = 0;
  const client = createWorkfrontClient({ ...options, fetchImpl: async (url) => {
    if (isCurrentUser(url)) return response([{ ID: 'alex', name: 'Alex Morgan' }]);
    if (url.includes('/user/search')) return response([{ ID: 'alex', name: 'Alex Morgan' }]);
    if (url.includes('/task/')) return response([]);
    if (url.includes('/user/')) return response([{ ID: 'alex', name: 'Alex' }]);
    pages += 1;
    const offset = Number(new URL(url, 'https://plugin.example').searchParams.get('$$FIRST'));
    return response(offset === 0 ? Array.from({ length: 100 }, (_, index) => ({ ID: `project-${index}`, name: `Project ${index}` })) : [{ ID: 'project-last', name: 'Last project' }]);
  } });
  assert.equal((await client.load()).projects.length, 101);
  assert.equal(pages, 2);
});