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
const WORKERS = {
  prod: 'https://publish-requests.aem-poc-lab.workers.dev',
  ci: 'https://publish-requests-ci.aem-poc-lab.workers.dev',
  local: 'http://localhost:8787',
};
const INBOX = 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox-v2/publish-requests-inbox-v2';
// Multi-step approvals are served by the worker's v2 API only.
const API = '/api/v2';

export function workerOrigin(location) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const env = new URLSearchParams(location.search).get('env') || (local ? 'local' : 'prod');
  if (!Object.hasOwn(WORKERS, env) || (env === 'local' && !local)) throw new Error('Unknown workflow environment.');
  return WORKERS[env];
}

export function normalizeContext(context = {}) {
  const {
    org, path, ref = 'main', view,
  } = context;
  const site = context.site || context.repo;
  if (typeof ref !== 'string' || !ref || /[^a-z0-9-]/i.test(ref)) return null;
  if (![org, site].every((part) => typeof part === 'string' && /^[a-z0-9][a-z0-9.-]*$/i.test(part))) return null;
  if (typeof path !== 'string' || !path.startsWith('/') || /[?#\\]/.test(path)) return null;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (decoded.split('/').some((part) => part === '.' || part === '..')) return null;
  // Files opened in /media (PDFs, images) have no editor document to save or compare.
  const file = /\.[^/]+$/.test(path) && !path.endsWith('.html');
  if (file && view !== 'media') return null;
  return {
    org, site, path: path.replace(/\.html$/, ''), ref, ...(file ? { file } : {}),
  };
}

const forPage = (rows, path) => rows.filter((row) => row.path === path && row.status === 'pending');
export const sameRequest = (a, b) => !!a && !!b && ['path', 'requester', 'created', 'comment', 'step'].every((key) => (a[key] || '') === (b[key] || ''));

/** Parses the request row's `step` log: `email:step:ISO-date, ...`. */
export function parseStepLog(value) {
  if (!value) return [];
  return String(value).split(',').map((part) => part.trim()).filter(Boolean)
    .reduce((acc, entry) => {
      const parts = entry.split(':');
      const email = (parts[0] || '').trim();
      const step = Number.parseInt((parts[1] || '').trim(), 10);
      if (!email || !Number.isInteger(step) || step < 1) return acc;
      // ISO dates contain colons, so rejoin the remainder.
      acc.push({ email, step, date: parts.slice(2).join(':').trim() });
      return acc;
    }, []);
}

/**
 * Merges the worker's step definitions with a request's approval log into the
 * render model. `state` is approved | skipped | current | upcoming; a step with
 * no approvers is skipped, and `complete` means every step is done. A pending
 * request's position comes from the worker's `stepInfo`; it is only derived
 * here when there is none (before submission).
 */
export function buildStepModel(definitions = [], logValue = '', stepInfo = null) {
  const log = parseStepLog(logValue);
  const steps = definitions.map((definition, position) => {
    const index = definition.index || position + 1;
    const record = log.find((entry) => entry.step === index);
    return {
      index,
      title: definition.title || `Step ${index}`,
      description: definition.description || '',
      approvers: definition.approvers || [],
      cc: definition.cc || [],
      approvedBy: record?.email || null,
      approvedAt: record?.date || null,
      state: 'upcoming',
    };
  });

  let current = Number.isInteger(stepInfo?.current) && stepInfo.current > 0 ? stepInfo.current : 0;
  if (!current) {
    // Highest approved step + 1, skipping approver-less and already-logged steps.
    current = log.reduce((max, entry) => Math.max(max, entry.step), 0) + 1;
    while (current <= steps.length) {
      const step = steps[current - 1];
      if (step.approvers.length > 0 && !step.approvedBy) break;
      current += 1;
    }
  }

  steps.forEach((step) => {
    if (step.approvedBy) step.state = 'approved';
    else if (step.approvers.length === 0) step.state = 'skipped';
    else if (step.index === current) step.state = 'current';
  });

  const staffed = steps.filter((step) => step.approvers.length > 0);
  return {
    steps,
    current,
    count: steps.length,
    complete: current > steps.length,
    // The last step that can actually be approved; later empty steps are skipped.
    lastStaffed: staffed.length ? staffed[staffed.length - 1].index : 0,
    // A lone unlabelled step is an ordinary single approval: no stepper needed.
    bare: steps.length <= 1 && !definitions[0]?.title,
  };
}

export function deriveView(context, data) {
  const blocked = {
    view: 'blocked', canApprove: false, canWithdraw: false, steps: [], current: 1, count: 0,
  };
  if (!context) return { ...blocked, message: 'Open a page in the editor to manage its publish request.' };
  if (!data) return { view: 'loading' };
  const own = forPage(data.own, context.path);
  const approvable = forPage(data.approvable, context.path);
  // Everything pending for this page, whatever the caller's role.
  const onPage = forPage(data.page || [], context.path);
  if (own.length > 1 || approvable.length > 1 || onPage.length > 1
    || (own[0] && approvable[0] && !sameRequest(own[0], approvable[0]))) {
    return { ...blocked, message: 'Multiple pending records were returned for this page. Contact your site administrator before taking action.' };
  }
  const request = approvable[0] || own[0] || onPage[0];
  if (!request && !data.approvers.length) return { ...blocked, message: 'No approver is configured for this page. Contact your site administrator.' };
  let view = 'request';
  if (approvable.length) view = 'approver';
  else if (own.length) view = 'requester';
  else if (onPage.length) view = 'observer';
  const canApprove = !!approvable.length && request.canApproveNow === true
    && typeof request.isFinal === 'boolean'
    && Number.isInteger(request.stepInfo?.current) && request.stepInfo.current > 0;
  return {
    ...(view === 'observer'
      ? {
        steps: [], current: null, count: 0, bare: true,
      }
      : buildStepModel(data.steps, request?.step, request?.stepInfo)),
    view,
    request,
    canApprove,
    canWithdraw: !!own.length,
  };
}

export function pageLinks(context, env, moduleUrl = import.meta.url) {
  const {
    org, site, path, ref: contentRef = 'main',
  } = context;
  const delivered = path.replace(/\.html$/, '').replace(/\/index$/, '/');
  const query = new URLSearchParams({ org, site });
  if (env === 'ci') query.set('env', env);
  const codeHost = new URL(moduleUrl).hostname;
  const ref = codeHost.match(/^([a-z0-9-]+)--aem-apps--adobe-rnd\.aem\.(?:page|live)$/)?.[1];
  if (ref && ref !== 'main') query.set('ref', ref);
  return {
    preview: `https://${contentRef}--${site}--${org}.aem.page${delivered}`,
    live: `https://${contentRef}--${site}--${org}.aem.live${delivered}`,
    inbox: `${INBOX}?${query}`,
    myRequests: `${INBOX}?${query}&requester=true`,
  };
}

export function createWorkspaceActions({ actions = {} } = {}) {
  const available = (action) => typeof actions[action] === 'function';
  const requireAction = (action) => {
    if (!available(action)) throw new Error('The editor could not complete this action.');
  };
  return {
    canCompare: available('openComparison'),
    async review(view) {
      requireAction('openComparison');
      actions.openComparison({
        candidate: view === 'approver' ? 'preview' : 'document', baseline: 'live',
      });
    },
    async save() {
      requireAction('saveDocument');
      const result = await actions.saveDocument();
      if (result?.ok !== true) throw new Error(`Workspace action could not complete (${result?.error || 'unavailable'}).`);
      return result;
    },
    async close() {
      if (available('closeComparison')) actions.closeComparison();
    },
  };
}

function failure(message, details = {}) {
  return Object.assign(new Error(message), details);
}

function settingsFrom(config) {
  const rows = config?.['publish-workflow-settings']?.data || [];
  const value = (key) => {
    const row = rows.find((item) => (item.key || item.Key) === key);
    return String(row?.value ?? row?.Value ?? '');
  };
  // Optional checklist shown before a request, e.g. request.guidance.item.1 (+ .marker).
  const items = rows
    .map((row) => /^request\.guidance\.item\.(\d+)$/.exec(row.key || row.Key || '')?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => ({
      marker: value(`request.guidance.item.${index}.marker`).trim(),
      text: value(`request.guidance.item.${index}`).trim(),
    }))
    .filter((item) => item.text);
  const guidance = {
    title: value('request.guidance.title').trim(),
    text: value('request.guidance.text').trim(),
    items,
  };
  return {
    commentsRequired: value('request.comments.required').toLowerCase() === 'true',
    commentsMinLength: Math.max(1, parseInt(value('request.comments.length'), 10) || 1),
    supportContact: value('request.support.contact'),
    accentColor: value('theme.accent-color'),
    accentColorHover: value('theme.accent-color-hover'),
    guidance: guidance.title || guidance.text || items.length ? guidance : null,
  };
}

export function createClient({
  base, request, preview, publish, beforePreview,
}) {
  async function json(route, context, body, extra = {}) {
    const { org, site } = context;
    const url = new URL(route, base);
    let opts;
    if (body) {
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org, site, ...body }) };
    } else {
      url.search = new URLSearchParams({ org, site, ...extra }).toString();
    }
    let resp;
    try { resp = await request(url.href, opts); } catch {
      throw failure('The workflow service could not be reached. Refresh to check the request before trying again.');
    }
    let result;
    try { result = await resp.json(); } catch {
      throw failure(`The workflow service returned an unreadable response (${resp.status}).`, { status: resp.status });
    }
    if (!resp.ok) throw failure(result.error || `The workflow service returned ${resp.status}.`, { status: resp.status });
    return result;
  }

  async function list(context, extra = {}) {
    const result = await json(`${API}/requests`, context, null, extra);
    if (!Array.isArray(result.requests)) throw failure('The workflow service returned an invalid request list.');
    return result.requests;
  }

  async function revalidate(context, expected, role) {
    const rows = forPage(await list(context, { role, path: context.path }), context.path);
    if (rows.length !== 1 || !sameRequest(rows[0], expected)) {
      throw failure('This request changed or is no longer pending. Refresh before taking action.', { stale: true });
    }
    return rows[0];
  }

  async function contentAction(action, context, label) {
    let resp;
    try { resp = await action(context); } catch {
      throw failure(`${label} could not be confirmed. Check the live page before taking another action.`, { publishUnknown: label === 'Publish' });
    }
    if (!resp?.ok) {
      const unknown = label === 'Publish' && (!resp || resp.status >= 500 || resp.status === 408);
      const message = unknown ? 'Publish could not be confirmed. Check the live page before taking another action.'
        : `${label} failed (${resp?.status || 'unavailable'}). The request was not completed.`;
      throw failure(message, { publishUnknown: unknown });
    }
  }

  async function reconcilePublished(context) {
    const rows = await list(context, { role: 'page', path: context.path });
    if (!forPage(rows, context.path).length) {
      return { approved: [context.path], completed: [context.path], alreadyCompleted: true };
    }
    throw failure('The page was published, but this request was advanced or changed. Refresh and review its current status.', { clearReceipt: true });
  }

  async function record(context, step, final) {
    let result;
    try {
      result = await json(`${API}/requests/approve`, context, {
        paths: [context.path], step, ...(final ? { final: true } : {}),
      });
    } catch (error) {
      if (error.status === 409) {
        await list(context, { role: 'approver', path: context.path }).catch(() => {});
        throw failure('Approval conflict. The request changed; refresh and review its current status.', { status: 409, clearReceipt: final });
      }
      throw error;
    }
    if (final && !result.unauthorized?.includes(context.path)
      && (result.stale?.includes(context.path) || result.notFound?.includes(context.path))) {
      return reconcilePublished(context);
    }
    if (result.stale?.includes(context.path)) {
      throw failure('This request was advanced by someone else. Refresh before taking action.');
    }
    if (!result.approved?.includes(context.path) || result.unauthorized?.includes(context.path)
      || result.notFound?.includes(context.path)) {
      throw failure(final
        ? 'The page was published, but approval was not recorded. Refresh to check access and request status.'
        : 'Approval was not recorded. Refresh to check access and request status.');
    }
    if (final ? !result.completed?.includes(context.path)
      : !result.advanced?.includes(context.path)) {
      throw failure(final
        ? 'Published, but workflow was not completed. Refresh to check the request.'
        : 'Approval did not advance the workflow. Refresh; if it completed, publish the page manually.');
    }
    return result;
  }

  return {
    async load(context) {
      const [configResult, people, own, approvable, page] = await Promise.all([
        json(`${API}/config`, context),
        json(`${API}/approvers`, context, null, { path: context.path }),
        list(context, { role: 'requester', path: context.path }),
        list(context, { role: 'approver', path: context.path }),
        list(context, { role: 'page', path: context.path }),
      ]);
      if (!configResult.config) throw failure('The publish workflow is not configured for this site.');
      if (!Array.isArray(people.approvers) || !Array.isArray(people.cc)) {
        throw failure('The workflow service returned invalid reviewers.');
      }
      // An older worker returns no step definitions; treat that as a single step.
      const steps = Array.isArray(people.steps) && people.steps.length
        ? people.steps
        : [{
          index: 1, title: '', description: '', approvers: people.approvers, cc: people.cc,
        }];
      return {
        own,
        approvable,
        page,
        approvers: people.approvers,
        cc: people.cc,
        steps,
        settings: settingsFrom(configResult.config),
      };
    },
    async submit(context, comment, onPhase = () => {}) {
      if (!context.file) {
        if (typeof beforePreview !== 'function') throw failure('The editor could not confirm current edits were saved.');
        onPhase('Saving current edits…');
        const saved = await beforePreview(context);
        if (saved?.ok !== true) throw failure('The editor could not confirm current edits were saved.');
      }
      onPhase('Updating preview…');
      await contentAction(preview, context, 'Preview');
      onPhase('Sending request…');
      return json(`${API}/requests`, context, { path: context.path, comment });
    },
    async resend(context, expected) {
      await revalidate(context, expected, 'requester');
      return json(`${API}/requests`, context, { path: context.path, comment: expected.comment || '', resend: true });
    },
    async withdraw(context, expected) {
      await revalidate(context, expected, 'requester');
      const result = await json(`${API}/requests/withdraw`, context, { path: context.path });
      if (result.success !== true) throw failure('This request is no longer pending. Refresh to check its status.');
      return result;
    },
    async reject(context, expected, reason) {
      if (!reason.trim()) throw failure('Enter a reason for rejection.');
      await revalidate(context, expected, 'approver');
      const result = await json(`${API}/requests/reject`, context, { path: context.path, reason: reason.trim() });
      if (result.success !== true) throw failure('This request is no longer pending. Refresh to check its status.');
      return result;
    },
    async approve(context, expected, { step, final } = {}, onPhase = () => {}) {
      const fresh = await revalidate(context, expected, 'approver');
      if (fresh.canApproveNow !== true || typeof fresh.isFinal !== 'boolean'
        || fresh.isFinal !== final || fresh.stepInfo?.current !== step) {
        throw failure('This request changed. Refresh and review its current step before approving.');
      }
      if (final) {
        onPhase('Publishing page…');
        await contentAction(publish, context, 'Publish');
      }
      onPhase('Updating request…');
      try { return await record(context, step, fresh.isFinal); } catch (error) {
        const message = final && error.clearReceipt
          ? `The page is live. ${error.message}` : error.message;
        throw failure(message, {
          status: error.status, published: !!final, clearReceipt: error.clearReceipt,
        });
      }
    },
    async complete(context, expected, { step } = {}) {
      try {
        await revalidate(context, expected, 'approver');
        return await record(context, step, true);
      } catch (error) {
        if (error.stale) return reconcilePublished(context);
        throw failure(error.message, {
          status: error.status, published: true, clearReceipt: error.clearReceipt,
        });
      }
    },
  };
}
