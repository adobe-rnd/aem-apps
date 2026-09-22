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
const INBOX = 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-inbox/publish-requests-inbox';

export function workerOrigin(location) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const env = new URLSearchParams(location.search).get('env') || (local ? 'local' : 'prod');
  if (!Object.hasOwn(WORKERS, env) || (env === 'local' && !local)) throw new Error('Unknown workflow environment.');
  return WORKERS[env];
}

export function normalizeContext(context = {}) {
  const { org, path, ref = 'main' } = context;
  const site = context.site || context.repo;
  if (![org, site].every((part) => typeof part === 'string' && /^[a-z0-9][a-z0-9.-]*$/i.test(part))) return null;
  if (typeof path !== 'string' || !path.startsWith('/') || /[?#\\]/.test(path)) return null;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (decoded.split('/').some((part) => part === '.' || part === '..')) return null;
  if (/\.[^/]+$/.test(path) && !path.endsWith('.html')) return null;
  return {
    org, site, path, ref,
  };
}

const forPage = (rows, path) => rows.filter((row) => row.path === path && row.status === 'pending');
export const sameRequest = (a, b) => !!a && !!b && ['path', 'requester', 'created', 'comment'].every((key) => a[key] === b[key]);

export function deriveView(context, data) {
  const blocked = { view: 'blocked', canApprove: false, canWithdraw: false };
  if (!context) return { ...blocked, message: 'Open a page in the editor to manage its publish request.' };
  if (!data) return { view: 'loading' };
  const own = forPage(data.own, context.path);
  const approvable = forPage(data.approvable, context.path);
  if (own.length > 1 || approvable.length > 1
    || (own[0] && approvable[0] && !sameRequest(own[0], approvable[0]))) {
    return { ...blocked, message: 'Multiple pending records were returned for this page. Contact your site administrator before taking action.' };
  }
  const request = approvable[0] || own[0];
  if (!request && !data.approvers.length) return { ...blocked, message: 'No approver is configured for this page. Contact your site administrator.' };
  const waitingView = own.length ? 'requester' : 'request';
  return {
    view: approvable.length ? 'approver' : waitingView,
    request,
    canApprove: !!approvable.length,
    canWithdraw: !!own.length,
  };
}

export function pageLinks(context, env) {
  const { org, site, path } = context;
  const delivered = path.replace(/\.html$/, '').replace(/\/index$/, '/');
  const query = new URLSearchParams({ org, site });
  if (env === 'ci') query.set('env', env);
  const diff = new URL('https://tools.aem.live/tools/page-status/diff.html');
  diff.search = new URLSearchParams({ org, site, path }).toString();
  return {
    preview: `https://main--${site}--${org}.aem.page${delivered}`,
    live: `https://main--${site}--${org}.aem.live${delivered}`,
    diff: diff.href,
    inbox: `${INBOX}?${query}`,
    myRequests: `${INBOX}?${query}&requester=true`,
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
  return {
    commentsRequired: value('request.comments.required').toLowerCase() === 'true',
    commentsMinLength: Math.max(1, parseInt(value('request.comments.length'), 10) || 1),
    supportContact: value('request.support.contact'),
  };
}

export function createClient({
  base, request, preview, publish,
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

  async function list(context, role) {
    const result = await json('/api/requests', context, null, role ? { role } : {});
    if (!Array.isArray(result.requests)) throw failure('The workflow service returned an invalid request list.');
    return result.requests;
  }

  async function revalidate(context, expected, role) {
    const rows = forPage(await list(context, role), context.path);
    if (rows.length !== 1 || !sameRequest(rows[0], expected)) {
      throw failure('This request changed or is no longer pending. Refresh before taking action.', { stale: true });
    }
  }

  async function contentAction(action, context, label) {
    let resp;
    try { resp = await action(context); } catch {
      throw failure(`${label} could not be confirmed. Check the page before trying again.`);
    }
    if (!resp?.ok) throw failure(`${label} failed (${resp?.status || 'unavailable'}). The request was not completed.`);
  }

  async function record(context) {
    const result = await json('/api/requests/approve', context, { paths: [context.path] });
    if (!result.approved?.includes(context.path) || result.unauthorized?.includes(context.path)
      || result.notFound?.includes(context.path)) {
      throw failure('The page was published, but approval was not recorded. Refresh to check access and request status.');
    }
    return result;
  }

  return {
    async load(context) {
      const [configResult, people, own, approvable] = await Promise.all([
        json('/api/config', context),
        json('/api/approvers', context, null, { path: context.path }),
        list(context, 'requester'),
        list(context),
      ]);
      if (!configResult.config) throw failure('The publish workflow is not configured for this site.');
      if (!Array.isArray(people.approvers) || !Array.isArray(people.cc)) {
        throw failure('The workflow service returned invalid reviewers.');
      }
      return {
        own,
        approvable,
        approvers: people.approvers,
        cc: people.cc,
        settings: settingsFrom(configResult.config),
      };
    },
    async submit(context, comment, onPhase = () => {}) {
      onPhase('Updating preview…');
      await contentAction(preview, context, 'Preview');
      onPhase('Sending request…');
      return json('/api/requests', context, { path: context.path, comment });
    },
    async resend(context, expected) {
      await revalidate(context, expected, 'requester');
      return json('/api/requests', context, { path: context.path, comment: expected.comment || '', resend: true });
    },
    async withdraw(context, expected) {
      await revalidate(context, expected, 'requester');
      const result = await json('/api/requests/withdraw', context, { path: context.path });
      if (result.success !== true) throw failure('This request is no longer pending. Refresh to check its status.');
      return result;
    },
    async reject(context, expected, reason) {
      if (!reason.trim()) throw failure('Enter a reason for rejection.');
      await revalidate(context, expected);
      const result = await json('/api/requests/reject', context, { path: context.path, reason: reason.trim() });
      if (result.success !== true) throw failure('This request is no longer pending. Refresh to check its status.');
      return result;
    },
    async approve(context, expected, onPhase = () => {}) {
      await revalidate(context, expected);
      onPhase('Publishing page…');
      await contentAction(publish, context, 'Publish');
      onPhase('Updating request…');
      try { return await record(context); } catch (error) {
        throw failure(error.message, { status: error.status, published: true });
      }
    },
    async complete(context, expected) {
      try {
        await revalidate(context, expected);
        return await record(context);
      } catch (error) {
        throw failure(error.message, { status: error.status, published: true });
      }
    },
  };
}
