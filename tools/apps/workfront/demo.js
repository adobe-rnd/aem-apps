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
import { WorkfrontError } from './api.js';
import {
  addPageLink, TASK_STATUSES, taskDraft, taskUpdates,
} from './model.js';

export const DEMO_CONTEXT = {
  siteId: 'demo/website',
  siteName: 'website',
  path: '/campaign',
  url: 'https://da.live/canvas#/demo/website/campaign',
  title: 'Campaign',
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createDemoClient(context = DEMO_CONTEXT) {
  const date = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const users = [
    { id: 'demo-author', name: 'Demo Author', roleIds: [] },
    { id: 'demo-designer', name: 'Jamie Rivera', roleIds: [] },
  ];
  const [me, peer] = users;
  const baseItem = (id, name, type, extra = {}) => ({
    id,
    type,
    reference: `${type === 'project' ? 'PRJ' : 'TSK'}-${id.replace('demo-', '')}`,
    name,
    description: '',
    url: '',
    status: 'In progress',
    statusCode: type === 'project' ? 'CUR' : 'INP',
    dueDate: null,
    priority: 2,
    percentComplete: 0,
    requesterId: me.id,
    requesterName: me.name,
    lastUpdateDate: date(-1),
    assigneeIds: [],
    roleIds: [],
    pageUrl: '',
    siteIds: [],
    pageLinks: [],
    notes: [],
    ...extra,
  });
  const projects = [
    baseItem('demo-campaign', 'Spring Campaign 2027', 'project', {
      ownerId: me.id,
      memberIds: users.map((user) => user.id),
      siteIds: [context.siteId],
    }),
    baseItem('demo-refresh', 'Website Refresh', 'project', {
      ownerId: peer.id,
      memberIds: [me.id, peer.id],
    }),
    baseItem('demo-launch', 'Product Launch — Atelier Nova', 'project', {
      ownerId: peer.id,
      memberIds: [me.id, peer.id],
    }),
  ];
  const task = (id, name, projectId, extra = {}) => baseItem(id, name, 'task', {
    projectId,
    assigneeIds: [me.id],
    status: 'Not started',
    statusCode: 'NEW',
    dueDate: date(5),
    requesterId: peer.id,
    requesterName: peer.name,
    ...extra,
  });
  const hero = task('demo-hero', 'Write hero copy for spring landing page', projects[0].id, {
    description: 'Headline + 2 lines of supporting copy. Follow the Frescopa voice guide.',
    status: 'In progress',
    statusCode: 'INP',
    percentComplete: 40,
    dueDate: date(-1),
    priority: 3,
    notes: [{ text: 'First draft is in the doc, needs a punchier CTA.', author: peer.name, date: date(-1) }],
  });
  const tasks = [
    context.path && context.url ? addPageLink(hero, context).item : hero,
    task('demo-imagery', 'Select imagery for product detail pages', projects[2].id, {
      description: 'Pick 6 lifestyle shots from the DAM; check usage rights.',
      dueDate: date(2),
    }),
    task('demo-seo', 'Review SEO metadata on /coffee pages', projects[1].id, {
      status: 'In progress',
      statusCode: 'INP',
      percentComplete: 75,
      dueDate: date(7),
      priority: 1,
    }),
    task('demo-blog', 'Draft blog post: cold brew at home', projects[0].id, {
      description: '~400 words, casual tone, aimed at home baristas.',
      dueDate: date(10),
    }),
    task('demo-legal', 'Legal sign-off on sustainability claims', projects[2].id, {
      description: 'Shared with you as view-only.',
      assigneeIds: [peer.id, me.id],
      priority: 4,
      dueDate: date(1),
    }),
    task('demo-faq', 'Publish FAQ page', projects[1].id, {
      status: 'Complete',
      statusCode: 'CPL',
      percentComplete: 100,
      lastUpdateDate: date(-2),
    }),
  ];
  let sequence = 0;
  const findTask = (id) => {
    const item = tasks.find((entry) => entry.id === id);
    if (!item) throw new WorkfrontError('Demo task not found.', { status: 404 });
    return item;
  };
  const guard = (id) => {
    if (id === 'demo-legal') {
      throw new WorkfrontError('You do not have permission to edit this task.', { status: 403 });
    }
  };
  const save = (item) => {
    const index = tasks.findIndex((entry) => entry.id === item.id);
    tasks[index] = { ...item, lastUpdateDate: date(0) };
    return clone(tasks[index]);
  };

  return {
    mode: 'demo',
    async load() {
      return clone({
        userId: me.id,
        capabilities: { canEdit: true, canCreate: true, canComment: true },
        projects,
        tasks,
        users,
      });
    },
    async linkPage(taskId, page) {
      guard(taskId);
      const result = addPageLink(findTask(taskId), page);
      return { item: result.added ? save(result.item) : clone(result.item), added: result.added };
    },
    async updateTask(item, values) {
      guard(item.id);
      const latest = findTask(item.id);
      const updates = taskUpdates(latest, values);
      const { status, plannedCompletionDate, ...rest } = updates;
      return save({
        ...latest,
        ...rest,
        ...(status !== undefined ? { statusCode: status, status: TASK_STATUSES[status] } : {}),
        ...(plannedCompletionDate !== undefined ? { dueDate: plannedCompletionDate || null } : {}),
      });
    },
    async completeTask(taskId) {
      guard(taskId);
      return save({
        ...findTask(taskId), statusCode: 'CPL', status: TASK_STATUSES.CPL, percentComplete: 100,
      });
    },
    async addNote(taskId, text) {
      const item = findTask(taskId);
      if (!text.trim()) throw new WorkfrontError('Enter an update before posting.');
      const note = { text: text.trim(), author: me.name, date: date(0) };
      save({ ...item, notes: [note, ...item.notes] });
      return clone(note);
    },
    async createTask(values, page) {
      const draft = taskDraft(values, page);
      if (!projects.some((project) => project.id === draft.projectId)) {
        throw new WorkfrontError('Select a demo project.', { status: 422 });
      }
      sequence += 1;
      const item = task(`demo-created-${sequence}`, draft.name, draft.projectId, {
        ...draft,
        dueDate: draft.dueDate || null,
        requesterId: me.id,
        requesterName: me.name,
        lastUpdateDate: date(0),
      });
      tasks.push(item);
      return clone(item);
    },
  };
}
