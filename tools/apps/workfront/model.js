const AEM_HOST = /^[a-z0-9-]+--([a-z0-9-]+)--([a-z0-9-]+)\.aem\.(?:page|live)$/i;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// "/", "/index" and "/index.html" all identify the same document.
export function normalizePath(path) {
  const value = `/${String(path).replace(/^\/+/, '')}`.replace(/\.html$/i, '');
  return (value.endsWith('/') ? `${value}index` : value).toLowerCase();
}

// Reads a Workfront URL field value, e.g. https://da.live/canvas#/org/repo/path,
// https://da.live/#/org/repo (site only) or https://main--repo--org.aem.page/path.
export function parsePageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  let org;
  let repo;
  let path = null;
  if (url.hostname === 'da.live') {
    const match = /^\/?([^/]+)\/([^/]+)(\/.*)?$/.exec(url.hash.replace(/^#/, ''));
    if (!match) return null;
    [org, repo] = [decode(match[1]), decode(match[2])];
    // No trailing segment means the whole site; a trailing slash means the folder's index.
    if (match[3]) path = match[3].split('/').map(decode).join('/');
  } else {
    const match = AEM_HOST.exec(url.hostname);
    if (!match) return null;
    [, repo, org] = match;
    path = decode(url.pathname);
  }
  if (!org || !repo) return null;
  return { siteId: `${org}/${repo}`.toLowerCase(), path: path && normalizePath(path), url: url.href };
}

export function pageKey(page) {
  if (!page?.siteId || !page?.path) return null;
  return `${page.siteId.toLowerCase()}:${normalizePath(page.path)}`;
}

export function isLinkedToPage(item, page) {
  const key = pageKey(page);
  return Boolean(key && item.pageLinks?.some((link) => pageKey(link) === key));
}

function isLinkedToSite(item, siteId) {
  const site = siteId?.toLowerCase();
  return Boolean(site && (
    item.siteIds?.some((entry) => entry.toLowerCase() === site)
    || item.pageLinks?.some((link) => link.siteId.toLowerCase() === site)
  ));
}

function isAssignedTo(item, userId, catalog) {
  if (item.assigneeIds?.includes(userId)) return true;
  const roleIds = catalog.users?.find((user) => user.id === userId)?.roleIds || [];
  return Boolean(item.roleIds?.some((roleId) => roleIds.includes(roleId)));
}

function assignmentReason(item, userId, catalog, person) {
  if (item.assigneeIds?.includes(userId)) return `Assigned to ${person}`;
  if (isAssignedTo(item, userId, catalog)) return `Assigned to ${person === 'you' ? 'your' : `${person}'s`} job role`;
  return null;
}

export function matchReason(item, scope, context, catalog, selectedUserId) {
  const children = item.type === 'project'
    ? catalog.tasks.filter((task) => task.projectId === item.id)
    : [];

  if (scope === 'all') {
    const userId = context?.userId;
    if (!userId) return null;
    if (item.type === 'project') {
      if (item.ownerId === userId) return 'You own this project';
      return item.memberIds?.includes(userId) ? 'You are on the project team' : null;
    }
    const assigned = assignmentReason(item, userId, catalog, 'you');
    if (assigned) return assigned;
    const project = catalog.projects.find((entry) => entry.id === item.projectId);
    return project && (project.ownerId === userId || project.memberIds?.includes(userId)) ? 'In your project' : null;
  }

  if (scope === 'page') {
    if (isLinkedToPage(item, context)) return 'Linked to this page';
    const related = children.filter((task) => isLinkedToPage(task, context));
    if (related.length) {
      return `${related.length} task${related.length === 1 ? '' : 's'} linked to this page`;
    }
  }

  if (scope === 'site') {
    if (isLinkedToSite(item, context.siteId)) return 'Linked to this site';
    if (children.some((task) => isLinkedToSite(task, context.siteId))) {
      return 'Contains tasks linked to this site';
    }
    const project = catalog.projects.find((entry) => entry.id === item.projectId);
    if (project && isLinkedToSite(project, context.siteId)) return 'Project linked to this site';
  }

  if (scope === 'me' || scope === 'user') {
    const userId = scope === 'me' ? context.userId : selectedUserId;
    if (!userId) return null;
    const person = scope === 'me'
      ? 'you'
      : catalog.users.find((user) => user.id === userId)?.name || 'selected user';
    const assigned = assignmentReason(item, userId, catalog, person);
    if (assigned) return assigned;
    const related = children.filter((task) => isAssignedTo(task, userId, catalog));
    if (related.length) {
      return `${related.length} task${related.length === 1 ? '' : 's'} assigned to ${person}`;
    }
    if (item.memberIds?.includes(userId)) return `Project team includes ${person}`;
  }

  return null;
}

export function filterCatalog(catalog, context, scope = 'page', selectedUserId = '', search = '') {
  const query = search.trim().toLowerCase();
  const filter = (items) => items.flatMap((item) => {
    const reason = matchReason(item, scope, context, catalog, selectedUserId);
    if (!reason || (query && !item.name.toLowerCase().includes(query))) return [];
    return [{ ...item, matchReason: reason }];
  });
  return { projects: filter(catalog.projects), tasks: filter(catalog.tasks) };
}

export function addPageLink(item, page) {
  if (!pageKey(page) || !page.url) throw new Error('A current page is required to link a task.');
  if (isLinkedToPage(item, page)) return { item, added: false };
  if (item.pageUrl) {
    throw new Error(`"${item.name}" already links to ${item.pageUrl}. Clear its URL in Workfront to link this page instead.`);
  }
  const link = { siteId: page.siteId.toLowerCase(), path: normalizePath(page.path), url: page.url };
  return { item: { ...item, pageUrl: page.url, siteIds: [link.siteId], pageLinks: [link] }, added: true };
}

export function taskDraft({ name, projectId, description = '' }, page) {
  if (!name?.trim()) throw new Error('Enter a task name.');
  if (!projectId) throw new Error('Select a project.');
  if (!pageKey(page) || !page.url) throw new Error('A current page is required to create a task.');
  const task = {
    type: 'task',
    name: name.trim(),
    projectId,
    description: description.trim(),
    assigneeIds: [],
    notes: [],
    pageUrl: '',
    siteIds: [],
    pageLinks: [],
  };
  return addPageLink(task, page).item;
}

export function formatBrief(item, project) {
  const parts = [item.name, item.url];
  if (project && item.type === 'task') parts.push(`Project: ${project.name}`);
  if (item.description?.trim()) parts.push(item.description.trim());
  const notes = (item.notes || []).filter((note) => note.text?.trim());
  if (notes.length) {
    parts.push('Notes');
    notes.forEach((note) => parts.push(`${note.author ? `${note.author}: ` : ''}${note.text.trim()}`));
  }
  return parts.filter(Boolean).join('\n\n');
}