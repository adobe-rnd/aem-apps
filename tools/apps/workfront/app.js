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
/* eslint no-use-before-define: ["error", { "functions": false }] */
import loadConfig from './config.js';
import { createWorkfrontClient } from './api.js';
import { connectToHost, putBriefInChat } from './host.js';
import {
  filterCatalog, formatBrief, isLinkedToPage, pageKey, searchUsers,
} from './model.js';

const find = (selector) => document.querySelector(selector);
const findAll = (selector) => [...document.querySelectorAll(selector)];
const state = {
  client: null,
  host: null,
  context: {},
  catalog: { projects: [], tasks: [], users: [] },
  scope: 'page',
  userFilter: '',
  tab: 'tasks',
  search: '',
  searchOpen: false,
  searchIndex: -1,
  previousScope: 'page',
  selected: null,
  loading: true,
  error: null,
  linking: new Set(),
  creating: false,
  createUncertain: false,
};
const scopeNames = {
  all: 'All', site: 'This site', page: 'This page', me: 'Assigned to me', user: 'Selected user',
};
const avatarColors = ['teal', 'coral', 'blue', 'gold'];
let toastTimer;
let loadVersion = 0;

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function icon(name, className = '') {
  if (name === 'loader-circle') {
    const spinner = node('span', 'nx-loading-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    return spinner;
  }
  const element = node('span', `icon${className ? ` ${className}` : ''}`);
  element.dataset.icon = name;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function button(text, iconName, className = 'button nx-action-btn') {
  const element = node('button', className);
  element.type = 'button';
  if (iconName) element.append(icon(iconName));
  element.append(document.createTextNode(text));
  return element;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function externalLink(url, label, iconOnly = false) {
  const element = node('a', iconOnly ? 'icon-button small nx-action-btn-icon nx-btn-sm' : 'linked-page');
  const href = safeUrl(url);
  if (href) element.href = href;
  else element.setAttribute('aria-disabled', 'true');
  element.target = '_blank';
  element.rel = 'noopener noreferrer';
  element.title = label;
  element.setAttribute('aria-label', label);
  if (!iconOnly) element.append(document.createTextNode(label));
  element.append(icon('arrow-up-right'));
  return element;
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0])
    .join('')
    .toUpperCase();
}

function avatar(user, size = 'small') {
  const index = state.catalog.users
    .findIndex((entry) => entry.id === user?.id || entry.name === user?.name);
  const color = avatarColors[Math.max(index, 0) % avatarColors.length];
  const element = node('span', `avatar avatar-${color} avatar-${size}`, initials(user?.name));
  element.title = user?.name || 'Unassigned';
  element.setAttribute('aria-label', user?.name || 'Unassigned');
  return element;
}

function dateLabel(value, year = false) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(date);
}

function projectFor(task) {
  return state.catalog.projects.find((project) => project.id === task.projectId);
}

function selectedItem() {
  if (!state.selected) return null;
  return state.catalog[state.selected.type === 'project' ? 'projects' : 'tasks'].find((item) => item.id === state.selected.id);
}

function reasonElement(reason) {
  const element = node('span', 'match-reason');
  element.append(icon(reason?.includes('assigned') || reason?.startsWith('Assigned') || reason?.includes('team') ? 'user-round' : 'link'), node('span', '', reason));
  return element;
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  find('#toast-text').textContent = message;
  find('#toast-icon').replaceChildren(icon(error ? 'circle-alert' : 'circle-check'));
  find('#toast').classList.toggle('is-error', error);
  find('#toast').hidden = false;
  toastTimer = setTimeout(() => { find('#toast').hidden = true; }, 6000);
}

function chooseItem(item) {
  const selected = state.selected?.id === item.id && state.selected.type === item.type;
  state.selected = selected ? null : { id: item.id, type: item.type };
  render();
  document.getElementById(itemId(item))?.focus();
}

function renderEnvironment() {
  const user = state.catalog.users.find((entry) => entry.id === state.catalog.userId);
  find('#current-user').textContent = initials(user?.name);
  find('#current-user').title = user?.name || 'Current user unavailable';
  let status = 'Workfront connected';
  if (state.error) status = 'Not connected';
  if (state.loading) status = 'Connecting';
  find('#connection-status').replaceChildren(node('span', 'status-dot'), node('span', '', status));
  find('#connection-status').classList.toggle('is-live', !state.loading && !state.error);
}

function chooseUser(user) {
  if (state.scope !== 'user') state.previousScope = state.scope;
  state.userFilter = user.id;
  state.scope = 'user';
  state.search = '';
  state.searchOpen = false;
  state.searchIndex = -1;
  state.selected = null;
  render();
  find('#search').focus();
}

function renderSearch() {
  const selected = state.catalog.users.find((user) => user.id === state.userFilter);
  find('#selected-user').hidden = state.scope !== 'user';
  find('#selected-user-name').textContent = selected?.name || 'Selected user';
  find('#selected-user').setAttribute('aria-label', `Remove user filter: ${selected?.name || 'Selected user'}`);
  const suggestions = find('#user-suggestions');
  suggestions.replaceChildren();
  const users = state.searchOpen && !state.loading && !state.error
    ? searchUsers(state.catalog.users, state.search) : [];
  if (state.searchIndex >= users.length) state.searchIndex = -1;
  users.forEach((user, index) => {
    const option = node('div', 'user-suggestion');
    option.id = `user-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-label', user.name);
    option.setAttribute('aria-selected', String(index === state.searchIndex));
    option.append(avatar(user), node('span', '', user.name));
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => chooseUser(user));
    suggestions.append(option);
  });
  suggestions.hidden = !users.length;
  const search = find('#search');
  search.setAttribute('aria-expanded', String(Boolean(users.length)));
  if (users[state.searchIndex]) {
    search.setAttribute('aria-activedescendant', `user-option-${state.searchIndex}`);
    suggestions.children[state.searchIndex].scrollIntoView({ block: 'nearest' });
  } else {
    search.removeAttribute('aria-activedescendant');
  }
}

function renderControls(filtered) {
  findAll('input[name="context"]').forEach((input) => {
    input.checked = input.value === state.scope;
    input.disabled = state.loading || (input.value === 'page' && !pageKey(state.context))
      || (input.value === 'site' && !state.context.siteId) || (input.value === 'me' && !state.catalog.userId);
  });
  find('#new-task').disabled = state.loading || Boolean(state.error) || !pageKey(state.context) || !state.catalog.projects.length;
  find('#new-task').title = !pageKey(state.context) ? 'A current page is required' : 'Create a task for this page';
  find('#refresh').disabled = state.loading || state.creating || state.linking.size > 0;
  find('#refresh').hidden = state.loading;
  find('#clear-search').hidden = !state.search;
  if (find('#search').value !== state.search) find('#search').value = state.search;
  renderSearch();
  const counts = {
    projects: filtered.projects.length,
    tasks: filtered.tasks.length,
  };
  findAll('[data-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(state.tab === tab.dataset.tab));
    tab.tabIndex = state.tab === tab.dataset.tab ? 0 : -1;
    find(`#count-${tab.dataset.tab}`).textContent = counts[tab.dataset.tab];
  });
  find('#results').setAttribute('aria-labelledby', `tab-${state.tab}`);
  find('#results').setAttribute('aria-busy', String(state.loading));
}

function itemId(item) {
  return `item-${item.type}-${encodeURIComponent(item.id)}`;
}

function itemAccordion(item) {
  const container = node('article', 'item-accordion');
  const heading = node('h2');
  const row = node('button', 'item-row');
  row.type = 'button';
  row.id = itemId(item);
  const expanded = state.selected?.type === item.type && state.selected.id === item.id;
  row.setAttribute('aria-expanded', String(expanded));
  row.setAttribute('aria-controls', `${row.id}-details`);
  row.setAttribute('aria-label', `${item.type === 'task' ? 'Task' : 'Project'}: ${item.name}. ${item.matchReason}`);
  const summary = node('span', 'item-summary');
  const tasks = item.type === 'project' ? state.catalog.tasks.filter((task) => task.projectId === item.id) : [];
  const subtitle = item.type === 'task'
    ? projectFor(item)?.name || 'Project unavailable'
    : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  summary.append(node('span', 'item-name', item.name), node('span', 'item-subtitle', subtitle), reasonElement(item.matchReason));
  const owner = node('span', 'item-owner');
  const ownerIds = item.type === 'task' ? item.assigneeIds || [] : [item.ownerId];
  const users = ownerIds
    .map((id) => state.catalog.users.find((user) => user.id === id)).filter(Boolean);
  if (users.length) {
    const firstName = users[0].name.split(' ')[0];
    const ownerName = users.length > 1 ? `${firstName} +${users.length - 1}` : firstName;
    owner.append(avatar(users[0]), node('span', 'item-owner-name', ownerName));
    owner.title = users.map((user) => user.name).join(', ');
  } else {
    owner.append(node('span', 'item-owner-name', 'Unassigned'));
    owner.title = 'Unassigned';
  }
  row.append(summary, owner, node('span', 'item-due', dateLabel(item.dueDate)), icon('chevron-right', 'row-chevron'));
  row.addEventListener('click', () => chooseItem(item));
  heading.append(row);
  const detail = node('div', 'item-detail');
  detail.id = `${row.id}-details`;
  detail.setAttribute('role', 'region');
  detail.setAttribute('aria-labelledby', row.id);
  detail.hidden = !expanded;
  if (expanded) detail.append(itemDetail(item));
  container.append(heading, detail);
  return container;
}

function stateMessage(kind, title, text, actions = []) {
  const container = node('div', `${kind}-state`);
  const symbol = node('span', 'state-symbol');
  symbol.append(icon(kind === 'error' ? 'unplug' : 'link'));
  const commands = node('div', 'state-actions');
  commands.append(...actions);
  container.append(symbol, node('h2', '', title), node('p', 'state-text', text), commands);
  if (kind === 'error') container.setAttribute('role', 'alert');
  return container;
}

function renderResults(filtered) {
  const results = find('#results');
  results.replaceChildren();
  if (state.loading) {
    const loading = node('div', 'loading-state');
    loading.setAttribute('role', 'status');
    loading.append(
      node('span', 'sr-only', `Loading Workfront ${state.tab}`),
      node('div', 'skeleton skeleton-row'),
      node('div', 'skeleton skeleton-row'),
      node('div', 'skeleton skeleton-row'),
    );
    results.append(loading);
    return;
  }
  if (state.error) {
    const retry = button('Retry connection', 'refresh-cw');
    retry.addEventListener('click', reload);
    const actions = [retry];
    const message = stateMessage('error', 'Workfront could not be loaded', state.error.message, actions);
    results.append(message);
    return;
  }
  const visible = filtered[state.tab];
  const selectedVisible = visible.some(
    (item) => item.id === state.selected?.id && item.type === state.selected.type,
  );
  if (!selectedVisible) {
    state.selected = null;
  }
  if (!visible.length) {
    let title = `No ${state.tab} in this context`;
    let text = `No ${state.tab} are associated with ${scopeNames[state.scope].toLowerCase()}.`;
    const actions = [];
    if (state.search) {
      title = 'No matching items';
      text = `No results for "${state.search}" in ${scopeNames[state.scope]}.`;
      const clear = button('Clear search', 'x');
      clear.addEventListener('click', clearSearch);
      actions.push(clear);
    } else if (state.scope === 'page' && !pageKey(state.context)) {
      title = 'No page selected';
      text = 'The current page is unavailable from Experience Workspace.';
    } else if (state.scope === 'page') {
      title = `No ${state.tab} linked to this page`;
      text = `There are no ${state.tab} associated with ${state.context.path}.`;
    }
    if (!state.search && state.scope !== 'all') {
      const all = button('View all items', 'layers');
      all.addEventListener('click', () => { state.scope = 'all'; state.userFilter = ''; render(); });
      actions.push(all);
    }
    results.append(stateMessage('empty', title, text, actions));
  } else {
    results.append(...visible.map(itemAccordion));
  }
}

function metadata(label, content) {
  const element = node('div');
  const value = node('div', 'metadata-value');
  value.append(...(Array.isArray(content) ? content : [document.createTextNode(content)]));
  element.append(node('span', 'metadata-label', label), value);
  return element;
}

function itemDetail(item) {
  const inner = node('div', 'detail-inner');
  const top = node('div', 'detail-topline');
  const type = node('div', 'detail-type');
  type.append(
    icon(item.type === 'task' ? 'list-todo' : 'folder'),
    node('span', 'eyebrow', item.type.toUpperCase()),
    node('span', 'detail-reference', `/ ${item.reference || item.id}`),
  );
  top.append(type, externalLink(item.url, `Open ${item.name} in Workfront`, true));
  inner.append(top);
  if (item.type === 'task') {
    const project = projectFor(item);
    const parent = button(project?.name || 'Project unavailable', 'folder', 'detail-project nx-action-btn-quiet');
    parent.disabled = !project;
    parent.addEventListener('click', () => {
      state.tab = 'projects';
      state.search = '';
      chooseItem(project);
    });
    inner.append(parent);
  }
  if (item.status) {
    const status = node('div', 'detail-status');
    status.classList.toggle('is-complete', item.status === 'Complete');
    status.classList.toggle('is-not-started', item.status === 'Not started' || item.status === 'Planning');
    status.append(node('span', 'status-dot'), document.createTextNode(item.status));
    inner.append(status);
  }
  const info = node('div', 'detail-metadata');
  if (item.type === 'task') {
    const owners = (item.assigneeIds || [])
      .map((id) => state.catalog.users.find((user) => user.id === id)).filter(Boolean);
    const content = owners.flatMap((owner) => [avatar(owner), node('span', '', owner.name)]);
    info.append(metadata('Assigned to', content.length ? content : 'Unassigned'));
  } else {
    const total = state.catalog.tasks.filter((task) => task.projectId === item.id).length;
    info.append(metadata('Project tasks', `${total} task${total === 1 ? '' : 's'}`));
  }
  info.append(metadata('Due date', [icon('calendar-days'), node('span', '', dateLabel(item.dueDate, true))]));
  inner.append(info);
  const actions = node('div', 'detail-actions');
  const copy = button('Copy to chat', 'message-square', 'button nx-btn-primary');
  copy.addEventListener('click', () => copyBrief(item));
  actions.append(copy);
  if (item.type === 'task') {
    const linked = isLinkedToPage(item, state.context);
    const busy = state.linking.has(item.id);
    let linkLabel = 'Link to this page';
    if (busy) linkLabel = 'Linking task';
    if (linked) linkLabel = 'Linked to this page';
    let linkIcon = linked ? 'check' : 'link';
    if (busy) linkIcon = 'loader-circle';
    const link = button(linkLabel, linkIcon, `button nx-action-btn${linked ? ' is-linked' : ''}`);
    link.disabled = linked || busy || !pageKey(state.context);
    link.title = 'Link this task to the current page';
    if (!pageKey(state.context)) link.title = 'A current page is required';
    if (linked) link.title = 'This page is already linked to this task';
    link.addEventListener('click', () => linkTask(item));
    actions.append(link);
  } else {
    const create = button('New task in project', 'plus');
    create.disabled = !pageKey(state.context);
    create.addEventListener('click', () => openCreate(item.id));
    actions.append(create);
  }
  inner.append(actions);
  const brief = node('section', 'detail-section');
  const briefHeading = node('div', 'detail-section-heading');
  briefHeading.append(icon('file-text'), node('h3', '', 'Brief'));
  const content = node('div', 'brief-content');
  if (item.description?.trim()) item.description.trim().split(/\n\s*\n/).forEach((text) => content.append(node('p', '', text)));
  else content.append(node('p', 'empty-brief', 'No brief added.'));
  brief.append(briefHeading, content);
  inner.append(brief);
  const notes = node('section', 'detail-section detail-notes');
  const notesHeading = node('div', 'detail-section-heading');
  const entries = (item.notes || []).filter((note) => note.text?.trim());
  notesHeading.append(icon('message-square'), node('h3', '', 'Notes'), node('span', 'count-badge', String(entries.length)));
  notes.append(notesHeading);
  if (!entries.length) notes.append(node('p', 'state-text', 'No notes yet.'));
  entries.forEach((entry) => {
    const note = node('div', 'note');
    const heading = node('div', 'note-heading');
    heading.append(avatar({ name: entry.author || 'Workfront user' }), node('span', 'note-name', entry.author || 'Workfront user'));
    if (entry.date) heading.append(node('span', 'note-date', dateLabel(entry.date)));
    note.append(heading, node('p', 'note-text', entry.text));
    notes.append(note);
  });
  inner.append(notes);
  const links = node('div', 'detail-match');
  links.append(reasonElement(item.matchReason));
  if (item.pageUrl) {
    const label = item.pageLinks?.[0]?.path || item.siteIds?.[0] || item.pageUrl;
    links.append(externalLink(item.pageUrl, label));
  }
  inner.append(links);
  return inner;
}

function render() {
  const {
    catalog, context, scope, userFilter, search,
  } = state;
  const filtered = filterCatalog(catalog, context, scope, userFilter, search);
  renderEnvironment();
  renderControls(filtered);
  renderResults(filtered);
}

async function reload() {
  if (state.creating || state.linking.size > 0) return;
  loadVersion += 1;
  const version = loadVersion;
  state.loading = true;
  state.error = null;
  state.selected = null;
  render();
  try {
    const host = await connectToHost();
    if (version !== loadVersion) return;
    state.host = host;
    if (!host.embedded || !host.context) {
      throw new Error('Open Workfront from the Experience Workspace editor to load page context.');
    }
    state.context = host.context;
    const config = await loadConfig(host.context.siteId, host.actions?.daFetch);
    if (version !== loadVersion) return;
    const client = createWorkfrontClient({ ...config, getToken: () => host.getToken() });
    const catalog = await client.load();
    if (version !== loadVersion) return;
    state.client = client;
    state.catalog = catalog;
    state.context = { ...state.context, userId: catalog.userId };
  } catch (error) {
    console.error('Error while loading.', error);
    if (version !== loadVersion) return;
    state.error = error;
  } finally {
    if (version === loadVersion) {
      state.loading = false;
      render();
    }
  }
}

async function linkTask(task) {
  if (state.linking.has(task.id) || isLinkedToPage(task, state.context)) return;
  state.linking.add(task.id);
  render();
  try {
    const result = await state.client.linkPage(task.id, state.context);
    const index = state.catalog.tasks.findIndex((entry) => entry.id === task.id);
    state.catalog.tasks[index] = result.item;
    notify(result.added ? 'Task linked to this page.' : 'This task is already linked to this page.');
  } catch (error) {
    notify(error.message, true);
  } finally {
    state.linking.delete(task.id);
    render();
  }
}

function copyBrief(item) {
  const text = formatBrief(item, projectFor(item));
  try {
    putBriefInChat(state.host.actions, text);
    notify('Brief added to the chat draft.');
  } catch (error) {
    notify(error.message, true);
  }
}

function openCreate(projectId) {
  if (!pageKey(state.context) || state.loading || state.error) return;
  const selected = selectedItem();
  const chosen = projectId || (selected?.type === 'project' ? selected.id : selected?.projectId);
  const form = find('#create-form');
  form.reset();
  findAll('#create-form input, #create-form select, #create-form textarea, #create-form button').forEach((element) => { element.disabled = false; });
  state.createUncertain = false;
  find('#create-error').hidden = true;
  find('#task-project').replaceChildren(...state.catalog.projects.map((project) => new Option(project.name, project.id)));
  if (chosen && state.catalog.projects.some((project) => project.id === chosen)) find('#task-project').value = chosen;
  find('#task-page').value = state.context.url;
  find('#create-dialog').showModal();
  find('#task-name').focus();
}

async function createTask(event) {
  event.preventDefault();
  if (state.creating || state.createUncertain) return;
  const values = { name: find('#task-name').value, projectId: find('#task-project').value, description: find('#task-brief').value };
  state.creating = true;
  find('#create-error').hidden = true;
  findAll('#create-form input, #create-form select, #create-form textarea, #create-form button').forEach((element) => { element.disabled = true; });
  find('#submit-task').replaceChildren(icon('loader-circle'), document.createTextNode('Creating task'));
  try {
    const task = await state.client.createTask(values, state.context);
    state.catalog.tasks.push(task);
    state.selected = { id: task.id, type: 'task' };
    state.scope = 'page';
    state.userFilter = '';
    state.tab = 'tasks';
    state.search = '';
    find('#create-dialog').close();
    notify('Task created and linked to this page.');
  } catch (error) {
    find('#create-error').textContent = error.message;
    find('#create-error').hidden = false;
    state.createUncertain = Boolean(error.uncertain);
  } finally {
    state.creating = false;
    findAll('#create-form input, #create-form select, #create-form textarea, #create-form button').forEach((element) => { element.disabled = false; });
    find('#submit-task').disabled = state.createUncertain;
    find('#submit-task').replaceChildren(icon('plus'), document.createTextNode('Create task'));
    render();
  }
}

function clearSearch() {
  state.search = '';
  state.searchOpen = false;
  state.searchIndex = -1;
  render();
  find('#search').focus();
}

findAll('input[name="context"]').forEach((input) => input.addEventListener('change', () => {
  state.scope = input.value;
  state.userFilter = '';
  state.selected = null;
  render();
}));
find('#selected-user').addEventListener('click', () => {
  state.userFilter = '';
  state.scope = state.previousScope;
  state.selected = null;
  render();
  find('#search').focus();
});
find('#search').addEventListener('input', (event) => {
  state.search = event.target.value;
  state.searchOpen = true;
  state.searchIndex = -1;
  render();
});
find('#search').addEventListener('focus', () => {
  state.searchOpen = true;
  renderSearch();
});
find('#search').addEventListener('blur', () => {
  state.searchOpen = false;
  state.searchIndex = -1;
  renderSearch();
});
find('#search').addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!find('#user-suggestions').hidden) {
      state.searchOpen = false;
      state.searchIndex = -1;
      renderSearch();
    } else {
      clearSearch();
    }
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (state.loading || state.error) return;
    const users = searchUsers(state.catalog.users, state.search);
    if (!users.length) return;
    event.preventDefault();
    state.searchOpen = true;
    state.searchIndex = event.key === 'ArrowDown'
      ? (state.searchIndex + 1) % users.length
      : (state.searchIndex <= 0 ? users.length : state.searchIndex) - 1;
    renderSearch();
  }
  if (event.key === 'Enter' && !find('#user-suggestions').hidden && state.searchIndex >= 0) {
    event.preventDefault();
    chooseUser(searchUsers(state.catalog.users, state.search)[state.searchIndex]);
  }
});
find('#clear-search').addEventListener('click', clearSearch);
findAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
  if (state.tab !== tab.dataset.tab) state.selected = null;
  state.tab = tab.dataset.tab;
  render();
}));
find('.results-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = findAll('[data-tab]');
  const current = tabs.findIndex((tab) => tab.dataset.tab === state.tab);
  let index = (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  if (event.key === 'Home') index = 0;
  if (event.key === 'End') index = tabs.length - 1;
  tabs[index].click();
  tabs[index].focus();
});
find('#refresh').addEventListener('click', reload);
find('#new-task').addEventListener('click', () => openCreate());
find('#create-form').addEventListener('submit', createTask);
find('#create-dialog').addEventListener('cancel', (event) => { if (state.creating) event.preventDefault(); });
findAll('[data-close]').forEach((control) => control.addEventListener('click', () => { if (!state.creating || control.dataset.close !== 'create-dialog') find(`#${control.dataset.close}`).close(); }));
find('#dismiss-toast').addEventListener('click', () => { clearTimeout(toastTimer); find('#toast').hidden = true; });
reload();
