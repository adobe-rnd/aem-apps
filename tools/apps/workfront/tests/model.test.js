import assert from 'node:assert/strict';
import test from 'node:test';
import { addPageLink, filterCatalog, formatBrief, isLinkedToPage, parsePageUrl, taskDraft } from '../model.js';

const page = {
  siteId: 'northstar/website',
  path: '/products/trail.html',
  url: 'https://da.live/edit#/northstar/website/products/trail.html',
  userId: 'alex',
};

const catalog = {
  projects: [
    { id: 'launch', type: 'project', name: 'Trail launch', siteIds: ['northstar/website'], ownerId: 'sam', memberIds: ['sam', 'alex'] },
    { id: 'other', type: 'project', name: 'Trail launch', siteIds: ['northstar/other'], ownerId: 'sam', memberIds: ['sam'] },
  ],
  tasks: [
    { id: 'linked', type: 'task', name: 'Write product copy', projectId: 'launch', pageLinks: [page], assigneeIds: ['alex'] },
    { id: 'title-only', type: 'task', name: 'Trail launch', projectId: 'other', pageLinks: [], assigneeIds: ['sam'] },
    { id: 'site-only', type: 'task', name: 'Update navigation', projectId: 'launch', pageLinks: [], assigneeIds: ['sam'] },
  ],
  users: [{ id: 'alex', name: 'Alex Morgan' }, { id: 'sam', name: 'Sam Chen' }],
};

test('defaults to this page and never infers relevance from titles', () => {
  const result = filterCatalog(catalog, page);
  assert.deepEqual(result.tasks.map((task) => task.id), ['linked']);
  assert.deepEqual(result.projects.map((project) => project.id), ['launch']);
  assert.equal(result.projects[0].matchReason, '1 task linked to this page');
});

test('site filter uses explicit associations, including the parent project', () => {
  const result = filterCatalog(catalog, page, 'site');
  assert.deepEqual(result.tasks.map((task) => task.id), ['linked', 'site-only']);
  assert.equal(result.tasks[1].matchReason, 'Project linked to this site');
});

test('All includes only projects I own or am on, and their tasks', () => {
  const result = filterCatalog(catalog, page, 'all');
  assert.deepEqual(result.projects.map((project) => project.id), ['launch']);
  assert.equal(result.projects[0].matchReason, 'You are on the project team');
  assert.deepEqual(result.tasks.map((task) => task.id), ['linked', 'site-only']);
  assert.equal(result.tasks[0].matchReason, 'Assigned to you');
  assert.equal(result.tasks[1].matchReason, 'In your project');
  const owner = filterCatalog(catalog, { ...page, userId: 'sam' }, 'all');
  assert.equal(owner.projects.length, 2);
  assert.equal(owner.projects[0].matchReason, 'You own this project');
  assert.equal(filterCatalog(catalog, { ...page, userId: null }, 'all').projects.length, 0);
});

test('Assigned to me and selected user use exact assignee IDs', () => {
  assert.deepEqual(filterCatalog(catalog, page, 'me').tasks.map((task) => task.id), ['linked']);
  const selected = filterCatalog(catalog, page, 'user', 'sam');
  assert.deepEqual(selected.tasks.map((task) => task.id), ['title-only', 'site-only']);
  assert.equal(selected.tasks[0].matchReason, 'Assigned to Sam Chen');
  assert.equal(filterCatalog(catalog, { ...page, userId: null }, 'me').tasks.length, 0);
});

test('tasks assigned only to a job role match users who hold that role', () => {
  const withRoles = {
    ...catalog,
    tasks: [...catalog.tasks, { id: 'role-only', type: 'task', name: 'Review copy', projectId: 'other', pageLinks: [], assigneeIds: [], roleIds: ['editor'] }],
    users: [{ id: 'alex', name: 'Alex Morgan', roleIds: ['editor'] }, { id: 'sam', name: 'Sam Chen', roleIds: [] }],
  };
  const mine = filterCatalog(withRoles, page, 'me');
  assert.equal(mine.tasks.find((task) => task.id === 'role-only').matchReason, 'Assigned to your job role');
  assert.equal(mine.projects.find((project) => project.id === 'other').matchReason, '1 task assigned to you');
  assert.equal(filterCatalog(withRoles, page, 'all').tasks.some((task) => task.id === 'role-only'), true);
  assert.equal(filterCatalog(withRoles, page, 'user', 'alex').tasks.find((task) => task.id === 'role-only').matchReason, "Assigned to Alex Morgan's job role");
  assert.equal(filterCatalog(withRoles, page, 'user', 'sam').tasks.some((task) => task.id === 'role-only'), false);
});

test('search narrows the selected context rather than bypassing it', () => {
  assert.equal(filterCatalog(catalog, page, 'page', '', 'Trail launch').tasks.length, 0);
  assert.equal(filterCatalog(catalog, page, 'page', '', 'product').tasks.length, 1);
});

test('linking is immutable and does not duplicate a page-to-task association', () => {
  const task = catalog.tasks[2];
  const first = addPageLink(task, page);
  const second = addPageLink(first.item, { ...page, path: 'products/trail.html' });
  assert.equal(first.added, true);
  assert.equal(second.added, false);
  assert.equal(second.item.pageLinks.length, 1);
  assert.equal(task.pageLinks.length, 0);
});

test('identical paths on different sites are not the same page', () => {
  assert.equal(isLinkedToPage(catalog.tasks[0], { ...page, siteId: 'northstar/other' }), false);
});

test('missing page context never matches or permits writes', () => {
  assert.equal(filterCatalog(catalog, {}).tasks.length, 0);
  assert.throws(() => addPageLink(catalog.tasks[2], {}), /current page/);
  assert.throws(() => taskDraft({ name: 'New task', projectId: 'launch' }, {}), /current page/);
});

test('new task includes the selected project and current page link', () => {
  const draft = taskDraft({ name: '  New copy  ', projectId: 'launch', description: 'Keep it concise.' }, page);
  assert.equal(draft.name, 'New copy');
  assert.equal(draft.projectId, 'launch');
  assert.equal(draft.description, 'Keep it concise.');
  assert.equal(draft.pageUrl, page.url);
  assert.equal(isLinkedToPage(draft, page), true);
  assert.throws(() => taskDraft({ name: ' ', projectId: 'launch' }, page), /task name/);
  assert.throws(() => taskDraft({ name: 'New task' }, page), /project/);
});

test('chat brief includes title, Workfront URL, brief and attributed notes', () => {
  const brief = formatBrief({
    ...catalog.tasks[0],
    url: 'https://northstar.my.workfront.com/task/linked',
    description: 'A useful brief.',
    notes: [{ author: 'Sam', text: 'Use the approved messaging.' }],
  }, catalog.projects[0]);
  assert.match(brief, /^Write product copy\n\nhttps:\/\/northstar.my.workfront.com\/task\/linked/);
  assert.match(brief, /Project: Trail launch/);
  assert.match(brief, /A useful brief/);
  assert.match(brief, /Sam: Use the approved messaging/);
});
test('Workfront URL values are read from DA and AEM links', () => {
  assert.deepEqual(parsePageUrl('https://da.live/canvas#/andreas-haller/eds-coworker/index'), {
    siteId: 'andreas-haller/eds-coworker', path: '/index', url: 'https://da.live/canvas#/andreas-haller/eds-coworker/index',
  });
  assert.deepEqual(parsePageUrl('https://da.live/#/andreas-haller/eds-coworker'), {
    siteId: 'andreas-haller/eds-coworker', path: null, url: 'https://da.live/#/andreas-haller/eds-coworker',
  });
  assert.deepEqual(parsePageUrl('https://main--eds-coworker--andreas-haller.aem.page/'), {
    siteId: 'andreas-haller/eds-coworker', path: '/index', url: 'https://main--eds-coworker--andreas-haller.aem.page/',
  });
  assert.deepEqual(parsePageUrl(' https://main--eds-coworker--andreas-haller.aem.live/products/Trail.html '), {
    siteId: 'andreas-haller/eds-coworker', path: '/products/trail', url: 'https://main--eds-coworker--andreas-haller.aem.live/products/Trail.html',
  });
  assert.equal(parsePageUrl('https://da.live/edit#/andreas-haller/eds-coworker/docs/intro').path, '/docs/intro');
  [
    ['https://da.live/canvas#/andreas-haller/eds-coworker/', '/index'],
    ['https://da.live/canvas#/andreas-haller/eds-coworker/docs/', '/docs/index'],
    ['https://da.live/canvas#/andreas-haller/eds-coworker/docs', '/docs'],
    ['https://main--eds-coworker--andreas-haller.aem.page/docs/', '/docs/index'],
    ['https://main--eds-coworker--andreas-haller.aem.page/docs', '/docs'],
    ['https://main--eds-coworker--andreas-haller.aem.live', '/index'],
  ].forEach(([url, path]) => assert.equal(parsePageUrl(url).path, path, url));
  ['', 'not a url', 'http://da.live/#/org/repo', 'https://da.live/#/org', 'https://example.com/page', 'https://eds-coworker--andreas-haller.aem.page/']
    .forEach((value) => assert.equal(parsePageUrl(value), null, value));
});

test('every supported link format matches the open document', () => {
  const context = { siteId: 'andreas-haller/eds-coworker', path: '/index.html' };
  const item = (url) => {
    const link = parsePageUrl(url);
    return { siteIds: link ? [link.siteId] : [], pageLinks: link?.path ? [link] : [] };
  };
  ['https://da.live/canvas#/andreas-haller/eds-coworker/index', 'https://main--eds-coworker--andreas-haller.aem.page/', 'https://main--eds-coworker--andreas-haller.aem.live/']
    .forEach((url) => assert.equal(isLinkedToPage(item(url), context), true, url));
  const siteOnly = { id: 's', type: 'task', name: 'Site task', ...item('https://da.live/#/andreas-haller/eds-coworker') };
  const scoped = { projects: [], tasks: [siteOnly], users: [] };
  assert.equal(filterCatalog(scoped, context, 'page').tasks.length, 0);
  assert.equal(filterCatalog(scoped, context, 'site').tasks[0].matchReason, 'Linked to this site');
});

test('linking refuses to replace a URL that points elsewhere', () => {
  const linked = { ...catalog.tasks[2], pageUrl: 'https://da.live/#/northstar/website' };
  assert.throws(() => addPageLink(linked, page), /already links to https:\/\/da.live\/#\/northstar\/website/);
});
