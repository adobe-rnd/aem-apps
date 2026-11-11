import config from './config.js';
import { createWorkfrontClient } from './api.js';
import { connectToHost, putBriefInChat } from './host.js';
import { filterCatalog, formatBrief, isLinkedToPage, pageKey } from './model.js';
const find = (selector) => document.querySelector(selector);
const findAll = (selector) => [...document.querySelectorAll(selector)];
const state = {
  client: null, host: null, context: {},
  catalog: { projects: [], tasks: [], users: [] },
  scope: 'page', userFilter: '', tab: 'all', search: '', selected: null,
  loading: true, error: null, mobileDetail: false, linking: new Set(), 
  creating: false, createUncertain: false,
};
const scopeNames = { all: 'All', site: 'This site', page: 'This page', me: 'Assigned to me', user: 'Selected user' };
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
  const element = node('span', `icon${className ? ` ${className}` : ''}`);
  element.dataset.icon = name;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function button(text, iconName, className = 'button button-secondary') {
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
  const element = node('a', iconOnly ? 'icon-button small' : 'linked-page');
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
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function avatar(user, size = 'small') {
  const index = state.catalog.users.findIndex((entry) => entry.id === user?.id || entry.name === user?.name);
  const element = node('span', `avatar avatar-${avatarColors[Math.max(index, 0) % avatarColors.length]} avatar-${size}`, initials(user?.name));
  element.title = user?.name || 'Unassigned';
  element.setAttribute('aria-label', user?.name || 'Unassigned');
  return element;
}

function dateLabel(value, year = false) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(date);
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
  state.selected = { id: item.id, type: item.type };
  state.mobileDetail = true;
  render();
  find('.mobile-back')?.focus();
}

function renderContext() {
  const context = state.context;
  const thumbnail = find('#page-thumbnail');
  if (!thumbnail.querySelector('.icon')) {
    thumbnail.replaceChildren(icon('file-text'));
  }
  const pageTitle = find('#page-title');
  pageTitle.replaceChildren(document.createTextNode(context.title || (state.loading ? 'Getting page context' : 'No page selected')));
  const href = safeUrl(context.url);
  if (href) {
    pageTitle.href = href;
    pageTitle.append(icon('arrow-up-right'));
  } else {
    pageTitle.removeAttribute('href');
  }
  find('#page-path').textContent = context.siteId
    ? `${context.siteId.replace('/', ' / ')}${context.path ? ` / ${context.path.replace(/^\//, '').replace(/\//g, ' / ')}` : ''}`
    : state.loading ? 'Waiting for Experience Workspace' : 'Page context is unavailable';
  const linked = state.catalog.tasks.filter((task) => isLinkedToPage(task, context)).length;
  find('#page-link-count').replaceChildren(icon('link'), node('span', '', `${linked} linked task${linked === 1 ? '' : 's'}`));
  find('#page-link-count').hidden = !pageKey(context);
}

function renderEnvironment() {
  const user = state.catalog.users.find((entry) => entry.id === state.catalog.userId);
  find('#current-user').textContent = initials(user?.name);
  find('#current-user').title = user?.name || 'Current user unavailable';
  find('#connection-status').replaceChildren(node('span', 'status-dot'), node('span', '', 'Workfront connected'));
  find('#connection-status').classList.add('is-live');
  find('#user-filter').replaceChildren(new Option('Select a user', ''), ...state.catalog.users.map((entry) => new Option(entry.name, entry.id)));
  find('#user-filter').value = state.userFilter;
}

function renderControls(filtered) {
  findAll('input[name="context"]').forEach((input) => {
    input.checked = input.value === state.scope;
    input.disabled = state.loading || (input.value === 'page' && !pageKey(state.context))
      || (input.value === 'site' && !state.context.siteId) || (input.value === 'me' && !state.catalog.userId);
  });
  find('#user-filter').disabled = state.loading || !state.catalog.users.length;
  find('#user-filter').value = state.userFilter;
  find('.user-filter-wrap').classList.toggle('is-active', state.scope === 'user');
  find('#new-task').disabled = state.loading || Boolean(state.error) || !pageKey(state.context) || !state.catalog.projects.length;
  find('#new-task').title = !pageKey(state.context) ? 'A current page is required' : 'Create a task for this page';
  find('#refresh').disabled = state.loading || state.creating;
  find('#refresh').classList.toggle('spin', state.loading);
  find('#clear-search').hidden = !state.search;
  if (find('#search').value !== state.search) find('#search').value = state.search;
  const counts = { all: filtered.projects.length + filtered.tasks.length, projects: filtered.projects.length, tasks: filtered.tasks.length };
  findAll('[data-tab]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(state.tab === tab.dataset.tab));
    tab.tabIndex = state.tab === tab.dataset.tab ? 0 : -1;
    find(`#count-${tab.dataset.tab}`).textContent = counts[tab.dataset.tab];
  });
  find('#results').setAttribute('aria-labelledby', `tab-${state.tab}`);
  find('#results').setAttribute('aria-busy', String(state.loading));
}

function sectionHeading(title, count, iconName) {
  const heading = node('h2', 'section-heading');
  heading.append(icon(iconName), document.createTextNode(title), node('span', 'count-badge', String(count)));
  return heading;
}

function projectCard(project) {
  const card = node('button', 'project-card');
  card.type = 'button';
  card.classList.toggle('is-selected', state.selected?.type === 'project' && state.selected.id === project.id);
  card.setAttribute('aria-label', `View project: ${project.name}. ${project.matchReason}`);
  card.setAttribute('aria-pressed', String(state.selected?.type === 'project' && state.selected.id === project.id));
  const top = node('span', 'project-card-top');
  const symbol = node('span', 'project-symbol');
  symbol.append(icon('folder'));
  top.append(symbol, node('span', 'project-reference', project.reference || project.id), icon('arrow-up-right'));
  const bottom = node('span', 'project-card-bottom');
  const stack = node('span', 'avatar-stack');
  const tasks = state.catalog.tasks.filter((task) => task.projectId === project.id);
  const people = [...new Set(tasks.flatMap((task) => task.assigneeIds || []))].slice(0, 3);
  people.forEach((id) => stack.append(avatar(state.catalog.users.find((user) => user.id === id))));
  bottom.append(stack, node('span', 'task-total', `${tasks.length} task${tasks.length === 1 ? '' : 's'}`));
  card.append(top, node('span', 'project-name', project.name), node('span', 'project-description', project.description || 'No project brief added.'), bottom, reasonElement(project.matchReason));
  card.addEventListener('click', () => chooseItem(project));
  return card;
}

function taskRow(task) {
  const row = node('button', 'task-row');
  row.type = 'button';
  const selected = state.selected?.type === 'task' && state.selected.id === task.id;
  row.classList.toggle('is-selected', selected);
  row.setAttribute('aria-pressed', String(selected));
  row.setAttribute('aria-label', `View task: ${task.name}. ${task.matchReason}`);
  const summary = node('span', 'task-summary');
  summary.append(node('span', 'task-name', task.name), node('span', 'task-project', projectFor(task)?.name || 'Project unavailable'), reasonElement(task.matchReason));
  const owner = node('span', 'task-owner');
  const users = (task.assigneeIds || []).map((id) => state.catalog.users.find((user) => user.id === id)).filter(Boolean);
  if (users.length) {
    owner.append(avatar(users[0]), node('span', 'task-owner-name', users.length > 1 ? `${users[0].name.split(' ')[0]} +${users.length - 1}` : users[0].name.split(' ')[0]));
    owner.title = users.map((user) => user.name).join(', ');
  } else {
    owner.append(node('span', 'task-owner-name', 'Unassigned'));
    owner.title = 'Unassigned';
  }
  row.append(summary, owner, node('span', 'task-due', dateLabel(task.dueDate)), icon('chevron-right', 'row-chevron'));
  row.addEventListener('click', () => chooseItem(task));
  return row;
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
  find('#results-summary').textContent = '';
  if (state.loading) {
    const loading = node('div', 'loading-state');
    loading.setAttribute('role', 'status');
    const cards = node('div', 'skeleton-projects');
    cards.append(node('div', 'skeleton skeleton-card'), node('div', 'skeleton skeleton-card'));
    loading.append(node('span', 'sr-only', 'Loading Workfront projects and tasks'), node('div', 'skeleton skeleton-heading'), cards, node('div', 'skeleton skeleton-row'), node('div', 'skeleton skeleton-row'), node('div', 'skeleton skeleton-row'));
    results.append(loading);
    return;
  }
  if (state.error) {
    const retry = button('Retry connection', 'refresh-cw');
    retry.addEventListener('click', reload);
    const actions = [retry];
    results.append(stateMessage('error', 'Workfront could not be loaded', state.error.message, actions));
    return;
  }
  const showProjects = state.tab !== 'tasks';
  const showTasks = state.tab !== 'projects';
  const visible = [...(showProjects ? filtered.projects : []), ...(showTasks ? filtered.tasks : [])];
  if (!visible.length) {
    let title = `No ${state.tab === 'all' ? 'items' : state.tab} in this context`;
    let text = `No ${state.tab === 'all' ? 'projects or tasks' : state.tab} are associated with ${scopeNames[state.scope].toLowerCase()}.`;
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
      title = `No ${state.tab === 'all' ? 'items' : state.tab} linked to this page`;
      text = `There are no ${state.tab === 'all' ? 'projects or tasks' : state.tab} associated with ${state.context.path}.`;
    }
    if (!state.search && state.scope !== 'all') {
      const all = button('View all items', 'layers');
      all.addEventListener('click', () => { state.scope = 'all'; state.userFilter = ''; render(); });
      actions.push(all);
    }
    results.append(stateMessage('empty', title, text, actions));
  } else {
    if (!visible.some((item) => item.id === state.selected?.id && item.type === state.selected.type)) {
      const first = showTasks && filtered.tasks.length ? filtered.tasks[0] : visible[0];
      state.selected = { id: first.id, type: first.type };
    }
    if (showProjects && filtered.projects.length) {
      const section = node('section', 'projects-section');
      const grid = node('div', 'project-grid');
      grid.append(...filtered.projects.map(projectCard));
      section.append(sectionHeading('Projects', filtered.projects.length, 'folder'), grid);
      results.append(section);
    }
    if (showTasks && filtered.tasks.length) {
      const section = node('section', 'tasks-section');
      const columns = node('div', 'task-table-heading');
      columns.setAttribute('aria-hidden', 'true');
      columns.append(node('span', '', 'TASK'), node('span', '', 'ASSIGNED TO'), node('span', '', 'DUE'), node('span'));
      section.append(sectionHeading('Tasks', filtered.tasks.length, 'list-todo'), columns, ...filtered.tasks.map(taskRow));
      results.append(section);
    }
    find('#results-summary').textContent = `${visible.length} item${visible.length === 1 ? '' : 's'} / ${state.scope === 'user' ? state.catalog.users.find((user) => user.id === state.userFilter)?.name || 'Selected user' : scopeNames[state.scope]}`;
  }
  if (!visible.length) state.selected = null;
}

function metadata(label, content) {
  const element = node('div');
  const value = node('div', 'metadata-value');
  value.append(...(Array.isArray(content) ? content : [document.createTextNode(content)]));
  element.append(node('span', 'metadata-label', label), value);
  return element;
}

function renderDetail(filtered) {
  const pane = find('#detail-pane');
  pane.replaceChildren();
  pane.classList.toggle('is-open', state.mobileDetail && Boolean(state.selected) && !state.loading && !state.error);
  const item = selectedItem();
  if (!item || state.loading || state.error) {
    const placeholder = node('div', 'detail-placeholder');
    placeholder.append(icon('file-text'), node('p', '', state.loading ? 'Loading details' : 'No item selected'));
    pane.append(placeholder);
    return;
  }
  const inner = node('div', 'detail-inner');
  const back = button('Back to items', 'arrow-left', 'button button-quiet mobile-back');
  back.addEventListener('click', () => {
    state.mobileDetail = false;
    render();
    find('.task-row.is-selected, .project-card.is-selected')?.focus();
  });
  const top = node('div', 'detail-topline');
  const type = node('div', 'detail-type');
  type.append(icon(item.type === 'task' ? 'list-todo' : 'folder'), node('span', 'eyebrow', item.type.toUpperCase()), node('span', 'detail-reference', `/ ${item.reference || item.id}`));
  top.append(type, externalLink(item.url, `Open ${item.name} in Workfront`, true));
  inner.append(back, top, node('h2', 'detail-title', item.name));
  if (item.type === 'task') {
    const project = projectFor(item);
    const parent = button(project?.name || 'Project unavailable', 'folder', 'detail-project');
    parent.disabled = !project;
    parent.addEventListener('click', () => { state.tab = 'all'; chooseItem(project); });
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
    const owners = (item.assigneeIds || []).map((id) => state.catalog.users.find((user) => user.id === id)).filter(Boolean);
    const content = owners.flatMap((owner) => [avatar(owner), node('span', '', owner.name)]);
    info.append(metadata('Assigned to', content.length ? content : 'Unassigned'));
  } else {
    const total = state.catalog.tasks.filter((task) => task.projectId === item.id).length;
    info.append(metadata('Project tasks', `${total} task${total === 1 ? '' : 's'}`));
  }
  info.append(metadata('Due date', [icon('calendar-days'), node('span', '', dateLabel(item.dueDate, true))]));
  inner.append(info);
  const actions = node('div', 'detail-actions');
  const copy = button('Copy to chat', 'message-square', 'button button-dark');
  copy.addEventListener('click', () => copyBrief(item));
  actions.append(copy);
  if (item.type === 'task') {
    const linked = isLinkedToPage(item, state.context);
    const busy = state.linking.has(item.id);
    const link = button(linked ? 'Linked to this page' : busy ? 'Linking task' : 'Link to this page', busy ? 'loader-circle' : linked ? 'check' : 'link', `button button-secondary${linked ? ' is-linked' : ''}`);
    link.disabled = linked || busy || !pageKey(state.context);
    link.title = linked ? 'This page is already linked to this task' : !pageKey(state.context) ? 'A current page is required' : 'Link this task to the current page';
    if (busy) link.querySelector('.icon').classList.add('spin');
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
  const matched = [...filtered.tasks, ...filtered.projects].find((entry) => entry.id === item.id && entry.type === item.type);
  const links = node('div', 'detail-match');
  if (matched) links.append(reasonElement(matched.matchReason));
  if (item.pageUrl) links.append(externalLink(item.pageUrl, item.pageLinks?.[0]?.path || item.siteIds?.[0] || item.pageUrl));
  inner.append(links);
  pane.append(inner);
}

function render() {
  const filtered = filterCatalog(state.catalog, state.context, state.scope, state.userFilter, state.search);
  renderContext();
  renderControls(filtered);
  renderResults(filtered);
  renderDetail(filtered);
}

async function reload() {
  const version = ++loadVersion;
  state.loading = true;
  state.error = null;
  state.mobileDetail = false;
  render();
  try {
    state.host = await connectToHost();
    if (!state.host.embedded || !state.host.context) {
      throw new Error('Open Workfront from the Experience Workspace editor to load page context.');
    }
    state.context = state.host.context;
    if (!state.client) {
      state.client = createWorkfrontClient({ ...config, getToken: () => state.host.getToken() });
    }
    const catalog = await state.client.load();
    if (version !== loadVersion) return;
    state.catalog = catalog;
    state.context = { ...state.context, userId: catalog.userId };
    renderEnvironment();
  } catch (error) {
    console.error('Error while loading.', error);
    if (version !== loadVersion) return;
    state.error = error;
    find('#connection-status').replaceChildren(node('span', 'status-dot'), node('span', '', 'Not connected'));
    find('#connection-status').classList.remove('is-live');
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
  find('#submit-task').replaceChildren(icon('loader-circle', 'spin'), document.createTextNode('Creating task'));
  try {
    const task = await state.client.createTask(values, state.context);
    state.catalog.tasks.push(task);
    state.selected = { id: task.id, type: 'task' };
    state.scope = 'page';
    state.userFilter = '';
    state.tab = 'tasks';
    state.search = '';
    state.mobileDetail = true;
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
  render();
  find('#search').focus();
}

findAll('input[name="context"]').forEach((input) => input.addEventListener('change', () => {
  state.scope = input.value;
  state.userFilter = '';
  state.mobileDetail = false;
  render();
}));
find('#user-filter').addEventListener('change', (event) => {
  state.userFilter = event.target.value;
  state.scope = state.userFilter ? 'user' : 'page';
  state.mobileDetail = false;
  render();
});
find('#search').addEventListener('input', (event) => { state.search = event.target.value; render(); });
find('#search').addEventListener('keydown', (event) => { if (event.key === 'Escape') clearSearch(); });
find('#clear-search').addEventListener('click', clearSearch);
findAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => { state.tab = tab.dataset.tab; render(); }));
find('.results-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = findAll('[data-tab]');
  const current = tabs.findIndex((tab) => tab.dataset.tab === state.tab);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
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