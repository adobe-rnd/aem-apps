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
import { createClient } from '../../../../tools/plugins/request-for-publish/workflow.js';

export const context = { org: 'example', site: 'website', path: '/drafts/page' };
export const pending = {
  path: context.path,
  status: 'pending',
  requester: 'author@example.com',
  comment: 'Updated the introduction.',
  created: '2026-01-01T10:00:00Z',
};
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

// In-memory transport only: no workflow, preview, publish or email network calls.
export default function fixture(options = {}) {
  const state = { role: 'requester', rows: [], ...options };
  const calls = [];
  const wait = async (phase) => {
    if (state.hold === phase) await new Promise((resolve) => { state.release = resolve; });
  };
  const client = createClient({
    base: 'https://workflow.example',
    request: async (href, opts = {}) => {
      const url = new URL(href);
      const route = url.pathname;
      const body = opts.body ? JSON.parse(opts.body) : null;
      calls.push({ route, body, role: url.searchParams.get('role') });
      if (!body) {
        await wait('load');
        if (state.loadError) return response({ error: 'Request lookup failed.' }, state.loadError);
        if (route === '/api/config') {
          return response({
            config: {
              'publish-workflow-settings': {
                data: [
                  { key: 'request.comments.required', value: String(!!state.required) },
                  { key: 'request.comments.length', value: '10' },
                ],
              },
            },
          });
        }
        if (route === '/api/approvers') return response({ approvers: state.noApprovers ? [] : ['reviewer@example.com'], cc: [] });
        if (route === '/api/requests') {
          const own = url.searchParams.get('role') === 'requester';
          const allowed = state.role === 'both' || state.role === (own ? 'requester' : 'approver');
          return response({ requests: allowed ? structuredClone(state.rows) : [] });
        }
      }
      if (route === '/api/requests') {
        await wait('request');
        if (state.failRequest) return response({ error: 'Request notification failed.' }, 503);
        if (!body.resend) state.rows = [{ ...pending, comment: body.comment }];
        return response({ success: true });
      }
      if (route === '/api/requests/approve') {
        await wait('record');
        if (state.failRecord) {
          if (state.removeOnFailure) state.rows = [];
          if (state.breakLoadOnFailure) state.loadError = 503;
          return response({ error: 'Approval notification could not be confirmed.' }, 503);
        }
        state.rows = [];
        return response({ approved: [context.path], notFound: [], unauthorized: [] });
      }
      if (['/api/requests/reject', '/api/requests/withdraw'].includes(route)) {
        if (state.failDecision) return response({ error: 'Request update failed.' }, 503);
        state.rows = [];
        return response({ success: true });
      }
      throw new Error(`Unexpected fixture route: ${route}`);
    },
    preview: async () => {
      calls.push({ route: 'preview' });
      await wait('preview');
      return response({}, state.failPreview || 200);
    },
    publish: async () => {
      calls.push({ route: 'publish' });
      await wait('publish');
      if (state.unknownPublish) throw new Error('Response lost');
      return response({}, state.failPublish || 200);
    },
  });
  return { client, calls, state };
}
