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
const AEM_HOST = /^[a-z0-9-]+--([a-z0-9-]+)--([a-z0-9-]+)\.aem\.(?:page|live)$/i;

export const TASK_STATUSES = { NEW: 'Not started', INP: 'In progress', CPL: 'Complete' };
export const PRIORITIES = ['None', 'Low', 'Normal', 'High', 'Urgent'];

export function parseWorkfrontDate(value) {
  if (!value) return null;
  const date = new Date(String(value)
    .replace(/T(\d{2}:\d{2}:\d{2}):(\d{3})/, 'T$1.$2')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateInputValue(value) {
  const date = parseWorkfrontDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

export function isOverdue(task, now = new Date()) {
  const due = parseWorkfrontDate(task.dueDate);
  return task.statusCode !== 'CPL' && Boolean(due && due < now);
}

export function taskCapabilities(user) {
  const license = String(user.licenseType || '').toUpperCase();
  const limited = ['REVIEW', 'REQUESTOR', 'CONTRIBUTOR', 'LIMITED', 'EXTERNAL'].includes(license);
  const permission = user.accessLevel?.accessLevelPermissions?.find((entry) => entry.objObjCode === 'TASK');
  const core = permission?.coreAction?.toUpperCase();
  const canEdit = !limited && (!permission || ['EDIT', 'MANAGE', 'DELETE'].includes(core));
  return {
    canEdit,
    canCreate: canEdit && !(permission?.forbiddenActions || []).includes('ADD'),
    canComment: !permission || ['VIEW', 'EDIT', 'MANAGE', 'DELETE'].includes(core),
  };
}

function validateDate(value) {
  if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || dateInputValue(value) !== value)) {
    throw new Error('Enter a valid due date.');
  }
}

function validatePriority(value) {
  if (!Number.isInteger(value) || !PRIORITIES[value]) throw new Error('Select a valid priority.');
}

export function taskUpdates(task, values) {
  const updates = {};
  if (values.name !== undefined && values.name.trim() !== task.name) {
    if (!values.name.trim() || values.name.trim().length > 255) throw new Error('Enter a task name of at most 255 characters.');
    updates.name = values.name.trim();
  }
  if (values.description !== undefined && values.description !== task.description) {
    updates.description = values.description;
  }
  if (values.statusCode !== undefined && values.statusCode !== task.statusCode) {
    if (!TASK_STATUSES[values.statusCode]) throw new Error('Select a supported task status.');
    updates.status = values.statusCode;
  }
  if (values.priority !== undefined && values.priority !== task.priority) {
    validatePriority(values.priority);
    updates.priority = values.priority;
  }
  if (values.percentComplete !== undefined && values.percentComplete !== task.percentComplete) {
    if (!Number.isInteger(values.percentComplete)
      || values.percentComplete < 0 || values.percentComplete > 100) {
      throw new Error('Progress must be a whole number between 0 and 100.');
    }
    updates.percentComplete = values.percentComplete;
  }
  if (values.dueDate !== undefined && values.dueDate !== dateInputValue(task.dueDate)) {
    validateDate(values.dueDate);
    updates.plannedCompletionDate = values.dueDate;
  }
  return updates;
}

const UPDATE_FIELDS = {
  name: ['name', 'name'],
  description: ['description', 'brief'],
  status: ['statusCode', 'status'],
  priority: ['priority', 'priority'],
  percentComplete: ['percentComplete', 'progress'],
  plannedCompletionDate: ['dueDate', 'due date'],
};

/** Lists the fields about to be written that someone else changed since the task was loaded. */
export function conflictingFields(loaded, latest, updates) {
  return Object.keys(updates).filter((key) => {
    const [field] = UPDATE_FIELDS[key];
    if (field === 'dueDate') return dateInputValue(loaded.dueDate) !== dateInputValue(latest.dueDate);
    return loaded[field] !== latest[field];
  }).map((key) => UPDATE_FIELDS[key][1]);
}

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

  if (scope === 'title') {
    return item.id === context.titleTarget?.id && item.type === context.titleTarget.type
      ? 'Selected from title search' : null;
  }

  if (scope === 'project') {
    return (item.type === 'project' ? item.id : item.projectId) === context.projectId
      ? 'In selected project' : null;
  }

  if (scope === 'requested' || scope === 'completed') {
    if (!context?.userId) return null;
    const matches = (task) => {
      if (scope === 'requested') return task.requesterId === context.userId;
      const updated = parseWorkfrontDate(task.lastUpdateDate);
      const now = context.now ? new Date(context.now) : new Date();
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() - 14);
      cutoff.setUTCHours(0, 0, 0, 0);
      return task.statusCode === 'CPL' && isAssignedTo(task, context.userId, catalog)
        && updated && updated >= cutoff && updated <= now;
    };
    if (item.type === 'task' ? matches(item) : children.some(matches)) {
      return scope === 'requested' ? 'Requested by you' : 'Completed task updated in the last 14 days';
    }
    return null;
  }

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

export function searchUsers(users, search) {
  const query = search.trim().toLowerCase();
  return query ? users.filter((user) => user.name.toLowerCase().includes(query)).slice(0, 8) : [];
}

export function searchTitles(catalog, search) {
  const query = search.trim().toLowerCase();
  return query ? [...catalog.projects, ...catalog.tasks]
    .filter((item) => item.name.toLowerCase().includes(query)).slice(0, 8) : [];
}

export function removeProjectFilter(filters) {
  const restore = (scope) => (scope === 'project' ? filters.previousProjectScope : scope);
  return {
    projectFilter: '',
    scope: restore(filters.scope),
    previousScope: restore(filters.previousScope),
  };
}

export function filterCatalog(catalog, context, scope = 'page', selectedUserId = '', search = '', projectId = '') {
  const query = search.trim().toLowerCase();
  const filter = (items) => items.flatMap((item) => {
    const reason = matchReason(item, scope, context, catalog, selectedUserId);
    if (!reason || (query && !item.name.toLowerCase().includes(query))) return [];
    if (item.type === 'task' && projectId && item.projectId !== projectId) return [];
    return [{ ...item, matchReason: reason }];
  });
  return { projects: filter(catalog.projects), tasks: filter(catalog.tasks) };
}

export function defaultScope(catalog, context) {
  const pageItems = filterCatalog(catalog, context, 'page');
  if (pageItems.tasks.length || pageItems.projects.length) return 'page';
  return filterCatalog(catalog, context, 'site').tasks.length ? 'site' : 'all';
}

export function addPageLink(item, page) {
  if (!pageKey(page) || !page.url) throw new Error('A current page is required to link a task.');
  if (isLinkedToPage(item, page)) return { item, added: false };
  if (item.pageUrl) {
    throw new Error(`"${item.name}" already links to ${item.pageUrl}. Clear its URL in Workfront to link this page instead.`);
  }
  const link = { siteId: page.siteId.toLowerCase(), path: normalizePath(page.path), url: page.url };
  return {
    item: {
      ...item, pageUrl: page.url, siteIds: [link.siteId], pageLinks: [link],
    },
    added: true,
  };
}

export function taskDraft({
  name, projectId, description = '', dueDate = '', priority = 2, assignMe = false,
}, page) {
  if (!name?.trim()) throw new Error('Enter a task name.');
  if (!projectId) throw new Error('Select a project.');
  if (!pageKey(page) || !page.url) throw new Error('A current page is required to create a task.');
  validateDate(dueDate);
  validatePriority(priority);
  if (assignMe && !page.userId) throw new Error('The current Workfront user is required for self-assignment.');
  const task = {
    type: 'task',
    name: name.trim(),
    projectId,
    description: description.trim(),
    dueDate,
    priority,
    assigneeIds: assignMe ? [page.userId] : [],
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
