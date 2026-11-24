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
/* eslint-disable no-underscore-dangle */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { aemApiUrl } from '../../../../tools/shared/hlx6.js';

const SETUP = 'https://da.live/app/adobe-rnd/aem-apps/tools/apps/publish-requests-setup/publish-requests-setup';
const read = (path) => readFileSync(new URL(`../../../../tools/apps/publish-requests-inbox/${path}`, import.meta.url), 'utf8');
const between = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to));

// The app and api.js import from da.live at load time, so the tests run their source in a VM.
const appSource = between(read('publish-requests-inbox.js'), 'class PublishRequestsApp', "customElements.define('publish-requests-app'");
const onboardingSource = between(read('api.js'), 'async function getDaJson(', '// ===========================================================================\n// Helix publish')
  .replace(/^export /gm, '');

const html = (strings, ...values) => strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '');

function app(overrides = {}) {
  const App = vm.runInNewContext(`${appSource}; PublishRequestsApp`, {
    LitElement: class { requestUpdate() { return this; } },
    URL,
    URLSearchParams,
    window: { location: { search: '', pathname: '/inbox' } },
    console,
    html,
    nothing: '',
    INFO_ICON: '',
    ...overrides,
  });
  return Object.assign(new App(), { _org: 'example', _site: 'website', token: 'token' });
}

// hlx6: what the admin ping says (null: it failed); sourceBus: whether the
// primary content is in the source bus (null: unknown).
function onboarding({
  daFetch, fetch, hlx6 = false, sourceBus = hlx6,
} = {}) {
  return vm.runInNewContext(`${onboardingSource}; ({ fetchDaConfigs, checkSiteExists, checkSiteRegistration })`, {
    DA_ADMIN: 'https://admin.da.live',
    isHlx6: async () => {
      if (hlx6 === null) throw new Error('Could not check the setup. Try again.');
      return hlx6;
    },
    usesSourceBus: async () => sourceBus,
    fetchSiteConfig: async () => null,
    aemApiUrl,
    daFetch,
    fetch,
    Object,
    getWorkerUrl: () => 'https://publish-requests-ci.aem-poc-lab.workers.dev',
    getOpts: () => ({}),
    encodeURIComponent,
    Promise,
    Array,
  });
}

describe('v1 inbox setup link', () => {
  it('is the plain setup app URL with only org and site, whatever the page carries', () => {
    const inbox = app({ window: { location: { search: '?org=x&site=y&env=ci&ref=local', pathname: '/inbox' } } });
    inbox.context = { org: 'someone', repo: 'a-fork' };
    assert.equal(inbox.setupUrl, `${SETUP}?org=example&site=website`);
    Object.assign(inbox, { _org: 'my org', _site: 'a&b' });
    assert.equal(inbox.setupUrl, `${SETUP}?org=my%20org&site=a%26b`);
  });

  it('renders the link in the not-set-up state', () => {
    const inbox = app();
    inbox._setupReason = "isn't registered for publish requests";
    const rendered = inbox.renderNotSetUp();
    assert.ok(rendered.includes(`href=${SETUP}?org=example&site=website target="_blank" rel="noopener"`));
    assert.match(rendered, /example\/website<\/strong> isn't registered for publish requests\./);
  });
});

describe('v1 inbox setup detection', () => {
  const rules = { 'publish-workflow-config': { data: [{ pattern: '/*', approvers: 'a@example.com' }] } };
  const check = async ({
    registration = 'registered', siteConfig = {}, orgConfig = {}, exists = true,
  }) => {
    const inbox = app({
      checkSiteExists: async () => exists,
      checkSiteRegistration: async () => ({ status: registration }),
      fetchDaConfigs: async () => ({ siteConfig, orgConfig }),
    });
    const ready = await inbox.checkOnboarding();
    return { ready, state: inbox._state, reason: inbox._setupReason };
  };

  it('flags an unregistered site', async () => {
    const result = await check({ registration: 'unregistered' });
    assert.deepEqual(result, { ready: false, state: 'not-set-up', reason: "isn't registered for publish requests" });
  });

  it('flags a registered site without rules in the site or org config', async () => {
    const result = await check({ siteConfig: { data: { data: [] } }, orgConfig: { 'publish-workflow-config-1': { data: [{}] } } });
    assert.deepEqual(result, { ready: false, state: 'not-set-up', reason: 'has no approval rules' });
  });

  it('flags a site whose site and org config do not exist', async () => {
    const result = await check({ siteConfig: {}, orgConfig: {} });
    assert.equal(result.reason, 'has no approval rules');
  });

  it('accepts rules from the site or the org', async () => {
    assert.equal((await check({ siteConfig: rules })).ready, true);
    assert.equal((await check({ orgConfig: rules })).ready, true);
    assert.equal((await check({ registration: 'unknown', orgConfig: rules })).ready, true);
  });

  it('carries on when a config without rules sits beside one it cannot read', async () => {
    assert.equal((await check({ siteConfig: {}, orgConfig: null })).ready, true);
    assert.equal((await check({ siteConfig: null, orgConfig: {} })).ready, true);
    assert.equal((await check({ siteConfig: null, orgConfig: null })).ready, true);
  });
});

describe('v1 inbox onboarding reads', () => {
  const daAnswers = (answers) => async (url) => {
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    return Response.json(answer.body ?? {}, { status: answer.status });
  };

  it('reads a missing DA config as empty and an unreadable one as null', async () => {
    const { fetchDaConfigs } = onboarding({
      daFetch: daAnswers({
        'https://admin.da.live/config/example/website/': { status: 404, body: { error: 'not found' } },
        'https://admin.da.live/config/example/': { status: 403 },
      }),
    });
    const { siteConfig, orgConfig } = await fetchDaConfigs('example', 'website');
    assert.equal(JSON.stringify(siteConfig), '{}');
    assert.equal(orgConfig, null);
  });

  it('returns readable DA configs and treats failures as unreadable', async () => {
    const { fetchDaConfigs } = onboarding({
      daFetch: daAnswers({
        'https://admin.da.live/config/example/website/': { status: 200, body: { library: { data: [] } } },
        'https://admin.da.live/config/example/': new TypeError('Failed to fetch'),
      }),
    });
    const { siteConfig, orgConfig } = await fetchDaConfigs('example', 'website');
    assert.deepEqual(Object.keys(siteConfig), ['library']);
    assert.equal(orgConfig, null);
  });

  it('reads a Helix 6 site config from config/editor/da.json in the DA sheet shape', async () => {
    const calls = [];
    const answers = daAnswers({
      'https://api.aem.live/example/sites/website/config/editor/da.json': {
        status: 200,
        body: {
          data: [{ key: 'editor.path', value: '/x' }],
          'publish-workflow-config': [{ pattern: '/*', approvers: 'a@example.com' }],
        },
      },
      'https://admin.da.live/config/example/': { status: 404 },
    });
    const { fetchDaConfigs } = onboarding({
      hlx6: true,
      daFetch: (url) => { calls.push(url); return answers(url); },
    });
    const { siteConfig, orgConfig } = await fetchDaConfigs('example', 'website');
    assert.deepEqual(siteConfig['publish-workflow-config'].data, [{ pattern: '/*', approvers: 'a@example.com' }]);
    assert.equal(JSON.stringify(orgConfig), '{}');
    // The org config stays on DA, as in the worker.
    assert.deepEqual(calls.sort(), [
      'https://api.aem.live/example/sites/website/config/editor/da.json',
      'https://admin.da.live/config/example/',
    ].sort());
  });

  it('finds a Helix 6 site, which the DA org listing does not show', async () => {
    const calls = [];
    const { checkSiteExists } = onboarding({
      hlx6: true,
      daFetch: async (url) => { calls.push(url); return Response.json([{ name: 'other' }]); },
    });
    assert.equal(await checkSiteExists('example', 'website'), true);
    assert.deepEqual(calls, []);
  });

  it('reads a legacy site with a source-bus overlay from DA', async () => {
    // The admin ping flags overlays too; the primary content is still on DA.
    const calls = [];
    const answers = daAnswers({
      'https://admin.da.live/config/example/website/': {
        status: 200,
        body: { 'publish-workflow-config': { data: [{ pattern: '/*', approvers: 'a@example.com' }] } },
      },
      'https://admin.da.live/config/example/': { status: 404 },
      'https://admin.da.live/list/example': { status: 200, body: [{ name: 'other' }] },
    });
    const { fetchDaConfigs, checkSiteExists } = onboarding({
      hlx6: true,
      sourceBus: false,
      daFetch: (url) => { calls.push(url); return answers(url); },
    });
    const { siteConfig } = await fetchDaConfigs('example', 'website');
    assert.equal(siteConfig['publish-workflow-config'].data.length, 1);
    assert.equal(await checkSiteExists('example', 'website'), false);
    assert.ok(calls.every((url) => !url.startsWith('https://api.aem.live')));
  });

  it('does not block or guess when the content source is unknown', async () => {
    const calls = [];
    const { fetchDaConfigs, checkSiteExists } = onboarding({
      hlx6: null,
      sourceBus: null,
      daFetch: async (url) => { calls.push(url); return Response.json({}); },
    });
    const { siteConfig } = await fetchDaConfigs('example', 'website');
    // Unreadable (null), so the inbox can't rule out rules and carries on.
    assert.equal(siteConfig, null);
    assert.equal(await checkSiteExists('example', 'website'), true);
    assert.deepEqual(calls, ['https://admin.da.live/config/example/']);
  });

  it('keeps a missing org listing from blocking the site', async () => {
    const { checkSiteExists } = onboarding({
      daFetch: daAnswers({ 'https://admin.da.live/list/example': { status: 404 } }),
    });
    assert.equal(await checkSiteExists('example', 'website'), true);
  });

  it('reads registration from the worker\'s site-config answer', async () => {
    const answer = (status, body) => onboarding({
      fetch: async () => Response.json(body, { status }),
    });
    const unregistered = answer(404, { error: 'Site is not registered', availableProviders: ['default'] });
    assert.equal((await unregistered.checkSiteRegistration('example', 'website', 'token')).status, 'unregistered');
    assert.equal((await answer(200, {}).checkSiteRegistration('example', 'website', 'token')).status, 'registered');
    const denied = answer(403, { error: 'denied', code: 'preview-write-required' });
    assert.equal((await denied.checkSiteRegistration('example', 'website', 'token')).status, 'unknown');
    const offline = onboarding({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    assert.equal((await offline.checkSiteRegistration('example', 'website', 'token')).status, 'unknown');
  });
});
