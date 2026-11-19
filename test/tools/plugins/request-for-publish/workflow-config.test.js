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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// utils.js imports from da.live at load time, so the tests run the config resolution in a VM.
const utils = readFileSync(new URL('../../../../tools/plugins/request-for-publish/utils.js', import.meta.url), 'utf8');
const source = utils.slice(utils.indexOf('function extractSetting('), utils.indexOf('/**\n * Preview content'))
  .replace(/^export /gm, '');

const WORKER = 'https://publish-requests-ci.aem-poc-lab.workers.dev';

// Worker answers keyed by route; a missing route is a network failure.
function resolve(answers) {
  const calls = [];
  const { resolveWorkflowConfig } = vm.runInNewContext(`${source}; ({ resolveWorkflowConfig })`, {
    WORKER_URL: 'https://prod.example',
    CI_WORKER_URL: WORKER,
    LOCAL_WORKER_URL: 'http://localhost:8787',
    window: { location: { hostname: 'main--aem-apps--adobe-rnd.aem.page', search: '?env=ci' } },
    URLSearchParams,
    encodeURIComponent,
    parseInt,
    JSON,
    Array,
    fetch: async (href) => {
      const url = new URL(href);
      calls.push(url.pathname);
      const answer = answers[url.pathname];
      if (!answer) throw new TypeError('Failed to fetch');
      return Response.json(answer.body, { status: answer.status });
    },
  });
  return { result: resolveWorkflowConfig('/index', 'example', 'website', 'token'), calls };
}

// The CI worker's answers for an unregistered site.
const unregistered = {
  '/api/config': { status: 403, body: { error: 'example/website is not registered for publish workflow' } },
  '/api/site-config': { status: 404, body: { error: 'Site is not registered', availableProviders: ['default', 'custom-api'], canEdit: true } },
};

describe('v1 plugin setup detection', () => {
  it('reports an unregistered site from the worker\'s site-config answer', async () => {
    const { result, calls } = resolve(unregistered);
    assert.equal((await result).source, 'unregistered');
    assert.deepEqual(calls, ['/api/config', '/api/site-config']);
  });

  it('reports a registered site without rules', async () => {
    const { result, calls } = resolve({ '/api/config': { status: 200, body: { config: null } } });
    assert.equal((await result).source, 'no-config');
    assert.deepEqual(calls, ['/api/config']);
  });

  it('resolves approvers for a set-up site', async () => {
    const { result } = resolve({
      '/api/config': { status: 200, body: { config: { 'publish-workflow-config': { data: [] } } } },
      '/api/approvers': { status: 200, body: { approvers: ['a@example.com'], cc: [] } },
    });
    assert.equal((await result).source, 'config');
  });

  [
    ['no preview write', { status: 403, body: { error: 'denied', code: 'preview-write-required' } }],
    ['an unknown site', { status: 404, body: { error: 'missing', code: 'site-not-found' } }],
    ['an outage', { status: 503, body: { error: 'later', code: 'permission-check-unavailable' } }],
    ['a network failure', undefined],
  ].forEach(([label, siteConfig]) => {
    it(`does not report setup when the worker can't say (${label})`, async () => {
      const { result } = resolve({
        '/api/config': { status: 403, body: { error: 'User does not have minimum permissions to use this service' } },
        ...(siteConfig && { '/api/site-config': siteConfig }),
      });
      assert.equal((await result).source, 'error');
    });
  });

  it('does not ask about registration when the config read fails for another reason', async () => {
    const { result, calls } = resolve({ '/api/config': { status: 503, body: { error: 'later' } } });
    assert.equal((await result).source, 'error');
    assert.deepEqual(calls, ['/api/config']);
  });
});
