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
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as jobs from '../../../../tools/apps/block-library-generator/jobs.js';
import * as discovery from '../../../../tools/apps/block-library-generator/discovery.js';
import * as discoveryCache from '../../../../tools/apps/block-library-generator/discovery-cache.js';
import * as cards from '../../../../tools/apps/block-library-generator/cards-analysis.js';
import * as blockAnalysis from '../../../../tools/apps/block-library-generator/block-analysis.js';
import * as library from '../../../../tools/apps/block-library-generator/library-dry-run.js';
import * as creation from '../../../../tools/apps/block-library-generator/library-creation.js';
import * as overview from '../../../../tools/apps/block-library-generator/library-inventory.js';
import * as presentation from '../../../../tools/apps/block-library-generator/library-presentation.js';
import * as lifecycle from '../../../../tools/apps/block-library-generator/library-lifecycle.js';
import * as librarySetupAPI from '../../../../tools/apps/block-library-generator/library-setup.js';
import * as placeholderImages from '../../../../tools/apps/block-library-generator/placeholder-images.js';
import * as libraryPreviewAPI from '../../../../tools/apps/block-library-generator/library-preview.js';

const source = await readFile(new URL(
  '../../../../tools/apps/block-library-generator/block-library-generator.js',
  import.meta.url,
), 'utf8');
const settle = () => new Promise((resolve) => { setImmediate(resolve); });

function fixtures() {
  const pointers = new Map();
  const files = new Map();
  const calls = [];
  const prompts = [];
  const closed = [];
  const publicCalls = [];
  return {
    files,
    calls,
    prompts,
    closed,
    publicCalls,
    async fetchPublic(url, options) {
      publicCalls.push({ url, options });
      return new Response(null, { status: 404 });
    },
    storage: {
      getItem: (key) => pointers.get(key) ?? null,
      setItem: (key, value) => pointers.set(key, value),
      removeItem: (key) => pointers.delete(key),
    },
    actions: {
      async daFetch(url, options) {
        calls.push({ url, method: options.method });
        if (url.startsWith('https://admin.hlx.page/preview/')
          || url.startsWith('https://admin.hlx.page/status/')) {
          return Response.json({ preview: { status: 200 } });
        }
        if (options.method === 'PUT') {
          const blob = options.body.get('data');
          files.set(url, blob.type === 'image/png'
            ? new Uint8Array(await blob.arrayBuffer()) : JSON.parse(await blob.text()));
          return new Response(null, { status: 201 });
        }
        if (options.method === 'POST' && url.includes('/config/')) {
          files.set(url, JSON.parse(options.body.get('config')));
          return new Response(null, { status: 201 });
        }
        if (options.method === 'DELETE') {
          files.delete(url);
          return new Response(null, { status: 204 });
        }
        if (files.get(url) instanceof Uint8Array) {
          return new Response(files.get(url), { headers: { 'Content-Type': 'image/png' } });
        }
        if (files.get(url) instanceof Response) return files.get(url).clone();
        return files.has(url)
          ? new Response(JSON.stringify(files.get(url)), {
            headers: {
              'Content-Type': 'application/json',
              ...(url.includes('/.da/block-library-generator/cache/') ? { ETag: '"cache-v1"' } : {}),
            },
          })
          : new Response(null, { status: 404 });
      },
      setPrompt: (text, options) => prompts.push({ text, options }),
      closeLibrary: () => closed.push(true),
    },
  };
}

async function harness(data, {
  embedded = true, sdkFails = false, wide = true, hash = '',
} = {}) {
  let App;
  let resolveSdk;
  const sdkPromise = new Promise((resolve) => { resolveSdk = resolve; });
  const timers = new Map();
  const window = {
    localStorage: data.storage,
    location: { hash },
    matchMedia: () => ({ matches: wide }),
    fetch: async (url, options) => {
      if (url instanceof URL && url.protocol === 'file:'
        && placeholderImages.PLACEHOLDER_IMAGES.some((asset) => url.pathname.endsWith(`/assets/${asset.file}`))) {
        return new Response(await readFile(url), { headers: { 'Content-Type': 'image/png' } });
      }
      return data.fetchPublic(url, options);
    },
    setTimeout: (callback, delay) => {
      const id = timers.size + 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  window.parent = embedded ? {} : window;
  class Element {
    isConnected = true;

    connectedCallback() { this.isConnected = true; }

    disconnectedCallback() { this.isConnected = false; }

    replaceChildren() { this.children = []; }
  }
  const context = vm.createContext({
    window,
    AbortController,
    TextEncoder,
    customElements: {
      define(name, component) {
        assert.equal(name, 'block-library-generator-app');
        App = component;
      },
    },
  });
  const lit = new vm.SyntheticModule(['LitElement', 'html'], function exports() {
    this.setExport('LitElement', Element);
    this.setExport('html', (strings, ...values) => ({ strings: [...strings], values }));
  }, { context });
  const protocol = new vm.SyntheticModule(Object.keys(jobs), function exports() {
    Object.entries(jobs).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const inventory = new vm.SyntheticModule(Object.keys(discovery), function exports() {
    Object.entries(discovery).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const cacheModule = new vm.SyntheticModule(Object.keys(discoveryCache), function exports() {
    Object.entries(discoveryCache).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const analysis = new vm.SyntheticModule(Object.keys(cards), function exports() {
    Object.entries(cards).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const genericAnalysis = new vm.SyntheticModule(Object.keys(blockAnalysis), function exports() {
    Object.entries(blockAnalysis).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const dryRun = new vm.SyntheticModule(Object.keys(library), function exports() {
    Object.entries(library).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const mutation = new vm.SyntheticModule(Object.keys(creation), function exports() {
    Object.entries(creation).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const existingLibrary = new vm.SyntheticModule(Object.keys(overview), function exports() {
    Object.entries(overview).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const libraryCopy = new vm.SyntheticModule(Object.keys(presentation), function exports() {
    Object.entries(presentation).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const pageActions = new vm.SyntheticModule(Object.keys(lifecycle), function exports() {
    Object.entries(lifecycle).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const librarySetup = new vm.SyntheticModule(Object.keys(librarySetupAPI), function exports() {
    Object.entries(librarySetupAPI).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const placeholders = new vm.SyntheticModule(Object.keys(placeholderImages), function exports() {
    Object.entries(placeholderImages).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const previewModule = new vm.SyntheticModule(Object.keys(libraryPreviewAPI), function exports() {
    Object.entries(libraryPreviewAPI).forEach(([name, value]) => this.setExport(name, value));
  }, { context });
  const sdk = new vm.SyntheticModule(['default'], function exports() {
    this.setExport('default', sdkPromise);
  }, { context });
  await sdk.link(() => {});
  await sdk.evaluate();
  const module = new vm.SourceTextModule(source, {
    context,
    importModuleDynamically: async () => {
      if (sdkFails) throw new Error('SDK unavailable');
      return sdk;
    },
  });
  await module.link((specifier) => {
    if (specifier === './jobs.js') return protocol;
    if (specifier === './discovery.js') return inventory;
    if (specifier === './discovery-cache.js') return cacheModule;
    if (specifier === './cards-analysis.js') return analysis;
    if (specifier === './block-analysis.js') return genericAnalysis;
    if (specifier === './library-dry-run.js') return dryRun;
    if (specifier === './library-creation.js') return mutation;
    if (specifier === './library-inventory.js') return existingLibrary;
    if (specifier === './library-presentation.js') return libraryCopy;
    if (specifier === './library-lifecycle.js') return pageActions;
    if (specifier === './library-setup.js') return librarySetup;
    if (specifier === './placeholder-images.js') return placeholders;
    if (specifier === './library-preview.js') return previewModule;
    assert.equal(specifier, '../../deps/lit/dist/index.js');
    return lit;
  });
  await module.evaluate();
  const app = new App();
  app.connectedCallback();
  await settle();
  return {
    app,
    timers,
    async connect(overrides = {}) {
      resolveSdk({
        context: {
          org: 'msagolj', site: 'ew', path: '/index', view: 'edit', ref: 'blocklibgen',
        },
        token: 'test-token-do-not-persist',
        actions: data.actions,
        ...overrides,
      });
      await settle();
    },
    disconnect() {
      app.isConnected = false;
      app.disconnectedCallback();
    },
  };
}

describe('Cache-first opening with unchanged library-page checks', () => {
  const codeRoot = 'https://api.aem.live/msagolj/repos/ew/code/main/blocks/';
  const prefix = '/msagolj/repos/ew/code/main/blocks/';
  const sourceRoot = 'https://admin.da.live/source/msagolj/ew';
  const configURL = 'https://admin.hlx.page/config/msagolj/aggregated/ew.json';
  const cacheURL = `${sourceRoot}/.da/block-library-generator/cache/blocks-main.json`;

  function setCode(data, names) {
    data.files.set(configURL, { code: { owner: 'msagolj', repo: 'ew' } });
    data.files.set(codeRoot, {
      children: names.map((name) => ({ type: 'folder', path: `${prefix}${name}/` })),
    });
    names.forEach((name) => data.files.set(`${codeRoot}${name}/`, {
      children: ['css', 'js'].map((extension) => ({
        type: 'file', path: `${prefix}${name}/${name}.${extension}`, size: 0,
      })),
    }));
  }

  async function initial() {
    const data = fixtures();
    setCode(data, ['cards', 'columns']);
    data.files.set('https://admin.da.live/config/msagolj/ew', {
      library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] },
    });
    data.files.set(`${sourceRoot}/docs/library/blocks.json`, {
      ':type': 'sheet',
      total: 1,
      limit: 1,
      offset: 0,
      data: [{ name: 'Cards', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/cards' }],
    });
    data.files.set(`${sourceRoot}/docs/library/blocks/cards.html`, new Response(null, {
      headers: { 'Content-Type': 'text/html' },
    }));
    const h = await harness(data);
    await h.connect();
    await h.app.refreshWorkspace();
    return { data, h };
  }

  it('reopens from cache without code requests, but still verifies every page and keeps both labels', async () => {
    const { data, h } = await initial();
    assert.ok(data.files.has(cacheURL));
    h.disconnect();
    data.calls.length = 0;
    const reopened = await harness(data);
    await reopened.connect();
    await reopened.app.refreshWorkspace();
    assert.equal(reopened.app.discoveryResult.cache.fromCache, true);
    assert.equal(data.calls.filter(({ url }) => url === cacheURL).length, 1);
    assert.ok(data.calls.every(({ url }) => !url.startsWith('https://api.aem.live') && url !== configURL));
    assert.ok(data.calls.some(({ url }) => url.endsWith('/cards.html')));
    assert.ok(data.calls.some(({ url }) => url.endsWith('/columns.html')));
    assert.equal(reopened.app.blockStatus('cards'), 'In library');
    assert.equal(reopened.app.blockStatus('columns'), 'No library page');
    assert.ok(data.calls.every(({ method }) => method === 'GET'));
  });

  it('rebuilds the shared code list only through an explicit Refresh blocks action', async () => {
    const { data, h } = await initial();
    setCode(data, ['cards', 'columns', 'hero']);
    await h.app.refreshWorkspace();
    assert.equal(h.app.blockItems.length, 2);
    await h.app.refreshBlocks();
    assert.equal(h.app.blockItems.length, 3);
    assert.equal(data.files.get(cacheURL).blocks.length, 3);
    assert.equal(h.app.blockStatus('hero'), 'No library page');
  });

  it('retains cached code on failed refresh while still detecting a newly missing library page', async () => {
    const { data, h } = await initial();
    data.files.set(configURL, new Response(null, { status: 503 }));
    data.files.delete(`${sourceRoot}/docs/library/blocks/cards.html`);
    await h.app.refreshBlocks();
    assert.match(h.app.discoveryCacheWarning, /refresh failed/i);
    assert.equal(h.app.discoveryError, '');
    assert.equal(h.app.blockItems.length, 2);
    assert.equal(h.app.blockStatus('cards'), 'Registered page missing');
    assert.equal(h.app.blockStatus('columns'), 'No library page');
  });
});

describe('General site UI and lifecycle', () => {
  const text = (value) => {
    if (Array.isArray(value)) return value.map(text).join(' ');
    if (value?.strings) return value.strings.join(' ') + value.values.map(text).join(' ');
    return typeof value === 'string' ? value : '';
  };

  it('shows only startup loading until editor context arrives, without flashing the site chooser', async () => {
    const data = fixtures();
    const h = await harness(data);
    let refreshed = 0;
    h.app.updateComplete = Promise.resolve();
    h.app.refreshWorkspace = async () => { refreshed += 1; };
    const loading = text(h.app.render());
    assert.match(loading, /Connecting to DA/);
    assert.match(loading, /startup-spinner/);
    assert.match(loading, /aria-busy="true"/);
    assert.match(loading, /role="status"/);
    assert.doesNotMatch(loading, /Choose a site|Use site|No site selected|Refresh blocks|Diagnostics/);
    assert.equal(h.app.renderSiteChooser(), '');
    assert.equal(h.app.renderSiteTarget(), '');
    assert.equal(data.calls.length, 0);
    await h.connect();
    assert.doesNotMatch(text(h.app.render()), /Connecting to DA|startup-spinner|Choose a site/);
    assert.match(text(h.app.renderSiteTarget()), /msagolj\/ew/);
    assert.equal(refreshed, 1);
    assert.equal(data.prompts.length, 0);
  });

  it('reveals the Apps site chooser only after the SDK confirms missing site context', async () => {
    const h = await harness(fixtures());
    assert.match(text(h.app.render()), /Connecting to DA/);
    assert.doesNotMatch(text(h.app.render()), /Choose a site/);
    await h.connect({ context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' } });
    assert.match(text(h.app.render()), /Choose a site/);
    assert.doesNotMatch(text(h.app.render()), /Connecting to DA|startup-spinner/);
  });

  it('ends startup loading on timeout or SDK failure without showing an unusable chooser', async () => {
    const h = await harness(fixtures());
    const [{ callback }] = [...h.timers.values()];
    callback();
    assert.match(text(h.app.render()), /No DA context/);
    assert.doesNotMatch(text(h.app.render()), /startup-spinner|Choose a site|Use site/);
    assert.equal(h.app.renderSiteChooser(), '');
    await h.connect({ context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' } });
    assert.match(text(h.app.render()), /Choose a site/);
    const failed = await harness(fixtures(), { sdkFails: true });
    assert.match(text(failed.app.render()), /Connection error/);
    assert.doesNotMatch(text(failed.app.render()), /startup-spinner|Choose a site|Use site/);
  });

  it('uses Production without an environment picker and follows the actual editor target', async () => {
    const h = await harness(fixtures());
    let refreshed = 0;
    h.app.updateComplete = Promise.resolve();
    h.app.refreshWorkspace = async () => { refreshed += 1; };
    await h.connect({
      context: {
        org: 'example-org', site: 'demo', branch: 'release', path: '/welcome', view: 'canvas',
      },
    });
    assert.equal(h.app.probeEnvironment, 'prod');
    assert.equal(h.app.probeTarget.org, 'example-org');
    assert.equal(h.app.probeTarget.branch, 'release');
    assert.equal(h.app.cardsBlockReason, '');
    assert.equal(refreshed, 1);
    assert.doesNotMatch(text(h.app.render()), /Stage \(default\)|Environment\s/);
  });

  it('keeps connected and fixed service/branch details out of the main header', async () => {
    const h = await harness(fixtures());
    await h.connect();
    const view = h.app.render();
    const markup = h.app.renderSiteTarget().strings.join('');
    const targetBar = markup.match(/<section class="target-bar"[\s\S]*?<\/section>/)?.[0];
    assert.ok(targetBar);
    assert.doesNotMatch(text(view), /Connected|connection-status/);
    assert.doesNotMatch(targetBar, /DA service|Code branch|target-context/);
    assert.match(targetBar, /Site/);
    assert.doesNotMatch(text(view), /DA service: Production|Launch document:|<summary>Diagnostics<\/summary>/);
    h.app.hostContext = { ...h.app.hostContext, view: 'fullscreen' };
    h.app.choosingSite = true;
    assert.match(text(h.app.renderSiteChooser()), /Choose a site/);
    assert.doesNotMatch(text(h.app.renderSiteChooser()), /Production DA|Code branch/);
  });

  it('continues to show waiting, missing-context and connection-error messages', async () => {
    const h = await harness(fixtures());
    await h.connect();
    [
      ['waiting', 'Connecting to DA', 'startup-loading'],
      ['unavailable', 'No DA context', 'connection-status'],
      ['error', 'Connection error', 'connection-status'],
    ].forEach(([state, label, selector]) => {
      h.app.connectionState = state;
      assert.ok(text(h.app.render()).includes(label));
      assert.ok(text(h.app.render()).includes(selector));
    });
  });

  it('explains direct launch instead of displaying a site form that cannot authenticate', async () => {
    const data = fixtures();
    const h = await harness(data, { embedded: false });
    const view = text(h.app.render());
    assert.match(view, /Open through DA/);
    assert.match(view, /https:\/\/da\.live\//);
    assert.match(view, /Outline/);
    assert.match(view, /authenticated session/);
    assert.doesNotMatch(view, /Choose a site|Use site|target-org|Refresh blocks|connection-status/);
    assert.equal(h.app.renderSiteChooser(), '');
    assert.equal(h.timers.size, 0);
    h.app.manualOrg = 'example-org';
    h.app.manualSite = 'demo';
    await h.app.applySiteTarget();
    assert.match(h.app.targetError, /authenticated session/);
    assert.equal(h.app.context.org, undefined);
    assert.equal(data.calls.length, 0);
    assert.equal(data.prompts.length, 0);
  });

  it('rejects an explicitly Stage-bound host without reading or falling back', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect({
      context: {
        org: 'example-org', site: 'demo', path: '/index', view: 'canvas', daOrigin: 'https://stage-admin.da.live',
      },
    });
    assert.match(h.app.discoveryBlockReason, /Production DA only/);
    assert.equal(data.calls.length, 0);
  });

  it('does not mistake the Apps hosting repository for the selected content site', async () => {
    const h = await harness(fixtures());
    await h.connect({
      context: {
        org: 'adobe-rnd', repo: 'aem-apps', view: 'fullscreen', path: 'tools/apps/block-library-generator/block-library-generator', daOrigin: 'https://admin.da.live',
      },
    });
    assert.equal(h.app.context.org, '');
    assert.match(text(h.app.render()), /Choose a site/);
    assert.match(text(h.app.renderSiteChooser()), /Use site/);
    assert.doesNotMatch(text(h.app.renderSiteChooser()), /Generation|editor document/);
    let refreshed = 0;
    h.app.refreshWorkspace = async () => { refreshed += 1; };
    h.app.manualOrg = 'example-org';
    h.app.manualSite = 'demo';
    await h.app.applySiteTarget();
    assert.equal(h.app.probeTarget.site, 'demo');
    assert.equal(h.app.discoveryBlockReason, '');
    assert.match(h.app.cardsBlockReason, /editor/);
    assert.equal(refreshed, 1);
    assert.equal(h.app.context.org, 'example-org');
  });

  it('shows only the site chooser before an Apps target is selected', async () => {
    const h = await harness(fixtures());
    await h.connect({ context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' } });
    const panel = text(h.app.renderSiteTarget());
    assert.match(panel, /class="site-chooser"/);
    assert.match(panel, /Use site/);
    assert.doesNotMatch(panel, /class="target-bar"|Refresh blocks|Change site|Cancel/);
    assert.doesNotMatch(text(h.app.render()), /class="target-bar"/);
    h.app.cancelSiteSelection();
    assert.equal(h.app.choosingSite, true);
  });

  it('initializes an authenticated Apps target from its URL fragment rather than the app host or remembered site', async () => {
    const data = fixtures();
    data.storage.setItem('block-library-generator:last-site:prod', JSON.stringify(
      jobs.getProbeTarget('prod', { org: 'remembered-org', site: 'remembered-site' }),
    ));
    const h = await harness(data, { hash: '#msagolj/frescopa' });
    const targets = [];
    h.app.refreshWorkspace = async () => { targets.push(h.app.probeTarget); };
    await h.connect({
      context: {
        org: 'adobe-rnd',
        repo: 'aem-apps',
        view: 'fullscreen',
        ref: 'local',
        path: 'tools/apps/block-library-generator/block-library-generator',
        daOrigin: 'https://admin.da.live',
      },
    });
    assert.equal(h.app.context.org, 'msagolj');
    assert.equal(h.app.context.site, 'frescopa');
    assert.equal(h.app.context.path, '');
    assert.equal(h.app.discoveryRef, 'main');
    assert.equal(h.app.choosingSite, false);
    assert.equal(h.app.targetError, '');
    assert.equal(targets.length, 1);
    assert.equal(targets[0].site, 'frescopa');
    assert.equal(h.app.isEditorContext, false);
    assert.match(h.app.cardsBlockReason, /editor/);
    assert.match(text(h.app.renderSiteTarget()), /Change site/);
    assert.equal(JSON.parse(data.storage.getItem('block-library-generator:last-site:prod')).site, 'frescopa');
    assert.equal(data.calls.length, 0);
    assert.equal(data.prompts.length, 0);
  });

  it('accepts a leading slash in an Apps fragment and ignores malformed remembered state when the URL is explicit', async () => {
    const data = fixtures();
    data.storage.setItem('block-library-generator:last-site:prod', '{invalid');
    const h = await harness(data, { hash: '#/example-org/demo' });
    let refreshed = 0;
    h.app.refreshWorkspace = async () => { refreshed += 1; };
    await h.connect({ context: { view: 'apps' } });
    assert.equal(h.app.probeTarget.org, 'example-org');
    assert.equal(h.app.probeTarget.site, 'demo');
    assert.equal(h.app.choosingSite, false);
    assert.equal(h.app.targetError, '');
    assert.equal(refreshed, 1);
  });

  it('keeps invalid Apps fragments in the chooser without falling back to another site or requesting content', async () => {
    await Promise.all([
      '#only-org', '#org/site/extra', '#../site', '#org/%2e%2e', '#org/site?other=x',
      '#https://example.com/site', '#org/site/', '#org//site',
    ].map(async (hash) => {
      const data = fixtures();
      data.storage.setItem('block-library-generator:last-site:prod', JSON.stringify(jobs.getProbeTarget('prod')));
      const h = await harness(data, { hash });
      await h.connect({ context: { org: 'adobe-rnd', repo: 'aem-apps', view: 'fullscreen' } });
      assert.equal(h.app.connectionState, 'ready');
      assert.equal(h.app.context.org, '');
      assert.equal(h.app.context.site, '');
      assert.equal(h.app.choosingSite, true);
      assert.match(h.app.targetError, /link|fragment/i);
      assert.equal(data.calls.length, 0);
    }));
  });

  it('does not use a fragment to bypass Apps authentication or override an editor target', async () => {
    const data = fixtures();
    const apps = await harness(data, { hash: '#example-org/demo' });
    await apps.connect({ context: { view: 'fullscreen' }, token: '' });
    assert.equal(apps.app.context.org, '');
    assert.equal(apps.app.choosingSite, true);
    assert.match(apps.app.targetError, /authenticated|session/i);
    const editor = await harness(data, { hash: '#example-org/demo' });
    await editor.connect({
      context: {
        org: 'msagolj', site: 'ew', path: '/index', branch: 'release', view: 'canvas',
      },
    });
    assert.equal(editor.app.context.org, 'msagolj');
    assert.equal(editor.app.context.site, 'ew');
    assert.equal(editor.app.discoveryRef, 'release');
    assert.equal(editor.app.isEditorContext, true);
    assert.equal(data.calls.length, 0);
  });

  it('switches between site summary and form, and cancels without changing or reloading the site', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect({ context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' } });
    let refreshed = 0;
    h.app.refreshWorkspace = async () => { refreshed += 1; };
    h.app.manualOrg = 'example-org';
    h.app.manualSite = 'demo';
    await h.app.applySiteTarget();
    const selected = h.app.context;
    const inventory = { blocks: {} };
    h.app.libraryOverview = inventory;
    h.app.selectedBlock = 'hero';
    assert.match(text(h.app.renderSiteTarget()), /class="target-bar"/);
    assert.match(text(h.app.renderSiteTarget()), /Refresh blocks/);
    assert.match(text(h.app.renderSiteTarget()), /Change site/);
    assert.doesNotMatch(text(h.app.render()), /class="site-chooser"/);
    h.app.beginSiteSelection();
    const panel = text(h.app.renderSiteTarget());
    assert.match(panel, /class="site-chooser"/);
    assert.match(panel, /Cancel/);
    assert.doesNotMatch(panel, /class="target-bar"|Refresh blocks|Change site/);
    assert.doesNotMatch(text(h.app.render()), /class="target-bar"/);
    h.app.manualOrg = 'another-org';
    h.app.manualSite = 'another-site';
    h.app.targetError = 'An invalid draft target.';
    h.app.cancelSiteSelection();
    assert.equal(h.app.choosingSite, false);
    assert.equal(h.app.context, selected);
    assert.equal(h.app.libraryOverview, inventory);
    assert.equal(h.app.selectedBlock, 'hero');
    assert.equal(h.app.manualOrg, selected.org);
    assert.equal(h.app.manualSite, selected.site);
    assert.equal(h.app.targetError, '');
    assert.equal(refreshed, 1);
    assert.equal(data.calls.length, 0);
    assert.doesNotMatch(text(h.app.render()), /class="site-chooser"/);
  });

  it('keeps an editor-bound site in summary mode without a Change site control', async () => {
    const h = await harness(fixtures());
    await h.connect();
    h.app.beginSiteSelection();
    assert.equal(h.app.choosingSite, false);
    assert.match(text(h.app.renderSiteTarget()), /class="target-bar"/);
    assert.doesNotMatch(text(h.app.renderSiteTarget()), /Change site|class="site-chooser"/);
  });

  it('offers manual selection when an editor host omits its site, without inventing chat context', async () => {
    const h = await harness(fixtures());
    await h.connect({ context: { view: 'canvas', path: '/index', daOrigin: 'https://admin.da.live' } });
    assert.equal(h.app.connectionState, 'ready');
    assert.equal(h.app.choosingSite, true);
    h.app.manualOrg = 'example-org';
    h.app.manualSite = 'demo';
    h.app.refreshWorkspace = async () => {};
    await h.app.applySiteTarget();
    assert.equal(h.app.probeTarget.site, 'demo');
    assert.match(h.app.cardsBlockReason, /editor|document/);
  });

  it('blocks unsupported editor chat actions before preparing any scratch request', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect({ actions: { daFetch: data.actions.daFetch } });
    assert.match(h.app.cardsBlockReason, /chat handoff/);
    h.app.cardsConfirmed = true;
    await h.app.prepareCardsAnalysis();
    assert.equal(data.calls.length, 0);
    assert.match(h.app.cardsError, /chat handoff/);
  });

  it('rejects unsafe manual targets before reading or retaining them', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect({ context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' } });
    h.app.manualOrg = '../other';
    h.app.manualSite = 'demo';
    await h.app.applySiteTarget();
    assert.match(h.app.targetError, /target/i);
    assert.equal(h.app.context.org, '');
    assert.equal(data.calls.length, 0);
  });

  it('prepares analysis from the selected editor site, not the legacy test site', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect({
      context: {
        org: 'example-org', site: 'demo', path: '/index', view: 'canvas', branch: 'main',
      },
    });
    const entryPaths = ['/blocks/hero/hero.js', '/blocks/hero/hero.css'];
    [...entryPaths, '/styles/styles.css', '/styles/lazy-styles.css'].forEach((path) => {
      data.files.set(`https://main--demo--example-org.preview.da.live${path}`, new Response('', {
        headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' },
      }));
    });
    data.files.set('https://admin.da.live/source/example-org/demo/index.html', new Response('<main>Home</main>', {
      headers: { 'Content-Type': 'text/html' },
    }));
    data.fetchPublic = async () => new Response('Unchanged semantic prompt.', { headers: { 'Content-Type': 'text/plain' } });
    h.app.discoveryResult = { complete: true, blocks: [{ name: 'hero', files: entryPaths.map((path) => ({ path })) }] };
    h.app.selectedBlock = 'hero';
    h.app.cardsConfirmed = true;
    h.app.parseAnalysisHTML = () => ({ querySelectorAll: () => [] });
    await h.app.prepareCardsAnalysis();
    assert.equal(h.app.cardsError, '');
    assert.equal(h.app.cardsState, 'prepared');
    assert.equal(h.app.cardsRequest.target.org, 'example-org');
    assert.ok(data.calls.every((call) => !call.url.includes('msagolj')));
  });

  it('reports a corrupt remembered Apps site without losing the authenticated site chooser', async () => {
    const data = fixtures();
    data.storage.setItem('block-library-generator:last-site:prod', '{invalid');
    const h = await harness(data);
    await h.connect({ context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' } });
    assert.equal(h.app.connectionState, 'ready');
    assert.match(h.app.targetError, /saved site could not be read/i);
    assert.equal(h.app.choosingSite, true);
    assert.equal(h.app.context.org, '');
    assert.equal(data.calls.length, 0);
  });

  it('loads an old EW action only for its exact original target', async () => {
    const data = fixtures();
    data.storage.setItem('block-library-generator:page-flow:prod:msagolj:ew', JSON.stringify({
      name: 'cards',
      mode: 'delete',
      environment: 'prod',
      status: 'confirm',
      startedAt: new Date().toISOString(),
    }));
    const h = await harness(data);
    await h.connect();
    assert.equal(h.app.pageFlow.name, 'cards');
    assert.equal(h.app.pageFlow.target.org, 'msagolj');
    const other = await harness(data);
    await other.connect({
      context: {
        org: 'example-org', site: 'demo', view: 'canvas', path: '/index',
      },
    });
    assert.equal(other.app.pageFlow, null);
  });

  it('rejects a saved or directly supplied snapshot from another site before any request', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    const flow = {
      name: 'hero',
      mode: 'delete',
      environment: 'prod',
      status: 'confirm',
      startedAt: new Date().toISOString(),
      target: h.app.probeTarget,
      snapshot: {
        name: 'hero',
        target: jobs.getProbeTarget('prod', { org: 'example-org', site: 'demo' }),
      },
    };
    data.storage.setItem(h.app.pageFlowKey(), JSON.stringify(flow));
    h.app.restorePageFlow();
    assert.equal(h.app.pageFlow, null);
    assert.match(h.app.libraryError, /snapshot|site|target/);
    h.app.pageFlow = flow;
    h.app.selectedBlock = 'hero';
    await h.app.commitPageAction();
    assert.equal(data.calls.length, 0);
    assert.match(h.app.libraryError, /snapshot|site|target/);
  });

  it('explains missing authentication before offering an unusable Apps site selection', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect({ context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' }, token: null });
    assert.match(h.app.discoveryBlockReason, /Sign in/);
    assert.equal(data.calls.length, 0);
  });

  it('uses the same honest waiting and saving statuses for every block', async () => {
    const h = await harness(fixtures());
    await h.connect();
    ['cards', 'columns', 'hero', 'footer', 'widget'].forEach((name) => {
      h.app.selectedBlock = name;
      h.app.pageFlow = { name, mode: 'create', status: 'waiting' };
      assert.equal(h.app.blockStatus(name), 'Waiting for chat');
      assert.match(text(h.app.renderPageAction()), /Review and send|handoff requested/);
      assert.doesNotMatch(text(h.app.renderPageAction()), /agent is running|Generating\.\.\./);
      h.app.pageFlow.status = 'ready';
      h.app.libraryCreating = true;
      h.app.libraryBusy = true;
      assert.equal(h.app.blockStatus(name), 'Saving changes');
      assert.match(text(h.app.renderBlockDetail()), /Saving changes/);
      assert.doesNotMatch(text(h.app.renderPageAction()), /not yet saved/);
      h.app.libraryCreating = false;
      h.app.libraryBusy = false;
    });
  });

  it('scopes saved page actions by site and branch rather than environment alone', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.savePageFlow({
      name: 'hero',
      mode: 'create',
      environment: 'prod',
      status: 'waiting',
      startedAt: new Date().toISOString(),
      jobId: crypto.randomUUID(),
      jobKind: 'analysis',
    });
    const original = h.app.pageFlowKey();
    h.app.context = { ...h.app.context, site: 'another' };
    h.app.restorePageFlow();
    assert.equal(h.app.pageFlow, null);
    assert.notEqual(h.app.pageFlowKey(), original);
    h.app.context = { ...h.app.context, site: 'ew' };
    h.app.discoveryRef = 'release';
    h.app.restorePageFlow();
    assert.equal(h.app.pageFlow, null);
    h.app.discoveryRef = 'main';
    h.app.restorePageFlow();
    assert.equal(h.app.pageFlow.name, 'hero');
  });

  it('does not silently replace another pending confirmation', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.selectedBlock = 'hero';
    h.app.discoveryResult = { complete: true, blocks: [{ name: 'hero', files: [] }] };
    h.app.libraryOverview = { blocks: { hero: { status: 'absent' } } };
    h.app.savePageFlow({
      name: 'columns',
      mode: 'delete',
      environment: 'prod',
      status: 'confirm',
      startedAt: new Date().toISOString(),
    });
    await h.app.beginPageAction('create');
    assert.equal(h.app.pageFlow.name, 'columns');
    assert.match(h.app.libraryError, /pending|cancel|resume/i);
    assert.equal(data.calls.length, 0);
    assert.match(text(h.app.renderPendingAction()), /Columns|Resume/);
  });

  it('hides the pending-action banner until refresh and block selection have settled', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.savePageFlow({
      name: 'columns',
      mode: 'create',
      status: 'waiting',
      environment: 'prod',
      startedAt: new Date().toISOString(),
    });
    const flow = h.app.pageFlow;
    h.app.selectedBlock = '';
    assert.equal(h.app.renderPendingAction(), '');
    h.app.selectedBlock = 'hero';
    h.app.discoveryBusy = true;
    assert.equal(h.app.renderPendingAction(), '');
    h.app.discoveryBusy = false;
    h.app.libraryOverviewBusy = true;
    assert.equal(h.app.renderPendingAction(), '');
    h.app.libraryOverviewBusy = false;
    assert.match(text(h.app.renderPendingAction()), /Resume/);
    h.app.selectedBlock = 'columns';
    assert.equal(h.app.renderPendingAction(), '');
    assert.equal(h.app.pageFlow, flow);
    assert.equal(data.calls.length, 0);
  });

  it('clears completed progress and returns to only the normal existing-page actions', async () => {
    const h = await harness(fixtures());
    await h.connect();
    h.app.selectedBlock = 'hero';
    h.app.discoveryResult = { complete: true, blocks: [{ name: 'hero', files: [] }] };
    h.app.libraryOverview = { blocks: { hero: { status: 'existing', editorURL: 'https://da.live/canvas#/msagolj/ew/docs/library/blocks/hero' } } };
    h.app.savePageFlow({
      name: 'hero',
      mode: 'create',
      environment: 'prod',
      status: 'completed',
      startedAt: new Date().toISOString(),
    });
    h.app.finishPageAction();
    assert.equal(h.app.pageFlow, null);
    assert.match(h.app.notice, /Hero/);
    assert.doesNotMatch(text(h.app.renderBlockDetail()), /new analysis|Dismiss|Confirm create/);
    assert.match(text(h.app.renderBlockDetail()), /Open/);
    assert.match(text(h.app.renderBlockDetail()), /Delete/);
    assert.match(text(h.app.renderBlockDetail()), /Recreate/);
  });
});

describe('Confirmed library initialization UI', () => {
  const text = (value) => {
    if (Array.isArray(value)) return value.map(text).join(' ');
    if (value?.strings) return value.strings.join(' ') + value.values.map(text).join(' ');
    return typeof value === 'string' ? value : '';
  };
  const configURL = 'https://admin.da.live/config/msagolj/ew';
  const indexURL = 'https://admin.da.live/source/msagolj/ew/docs/library/blocks.json';
  async function initial({ apps = false, registered = true, indexed = false } = {}) {
    const data = fixtures();
    const h = await harness(data);
    await h.connect(apps ? { context: { view: 'fullscreen', daOrigin: 'https://admin.da.live' } } : {});
    if (apps) {
      h.app.manualOrg = 'msagolj';
      h.app.manualSite = 'ew';
      h.app.refreshWorkspace = async () => {};
      await h.app.applySiteTarget();
    }
    data.files.set(configURL, {
      ':type': 'multi-sheet',
      ':names': ['library', 'apps'],
      library: {
        data: [
          { title: 'Generator', path: 'http://localhost:3000/app.html', experience: 'fullsize-dialog' },
          ...(registered ? [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] : []),
        ],
      },
      apps: { data: [{ title: 'Existing app', path: 'https://da.live/apps' }] },
    });
    if (indexed) {
      data.files.set(indexURL, {
        ':type': 'sheet', total: 0, offset: 0, limit: 0, data: [], keep: 'metadata',
      });
    }
    h.app.discoveryResult = {
      provider: 'code-bus',
      complete: true,
      diagnostics: [],
      blocks: [{ name: 'hero', files: [] }],
    };
    h.app.selectedBlock = 'hero';
    await h.app.refreshLibraryOverview();
    return { data, h };
  }

  it('shows missing-index setup instead of an error, and confirms before creating only that index', async () => {
    const { data, h } = await initial();
    const before = JSON.stringify(data.files.get(configURL));
    assert.equal(h.app.libraryOverviewError, '');
    assert.equal(h.app.blockStatus('hero'), 'Library setup required');
    assert.match(text(h.app.renderLibrarySetup()), /Initialize library/);
    assert.doesNotMatch(text(h.app.renderBlockDetail()), />Create</);
    h.app.beginLibrarySetup();
    assert.match(text(h.app.renderLibrarySetup()), /Confirm initialize library/);
    assert.match(text(h.app.renderLibrarySetup()), /\/docs\/library\/blocks\.json/);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
    h.app.cancelLibrarySetup();
    assert.equal(h.app.librarySetupProposal, null);
    h.app.beginLibrarySetup();
    await h.app.commitLibrarySetup();
    assert.equal(h.app.librarySetupError, '');
    assert.equal(h.app.libraryOverview.setup.status, 'ready');
    assert.equal(h.app.libraryOverview.blocks.hero.status, 'absent');
    assert.equal(h.app.librarySetupReceipt.status, 'completed');
    assert.equal(h.app.librarySetupProposal, null);
    assert.equal(JSON.stringify(data.files.get(configURL)), before);
    assert.deepEqual(data.calls.filter((call) => call.method !== 'GET').map((call) => call.url), [
      indexURL,
      `https://admin.hlx.page/preview/${h.app.probeTarget.org}/${h.app.probeTarget.site}/main/docs/library/blocks.json`,
    ]);
    assert.ok(h.app.libraryPreviewReceipts.every((receipt) => receipt.status === 'completed'));
    assert.equal(data.prompts.length, 0);
    assert.match(h.app.notice, /ready/);
  });

  it('can register an existing index from Apps, with an explicit config-race warning and no index overwrite', async () => {
    const { data, h } = await initial({ apps: true, registered: false, indexed: true });
    const before = JSON.stringify(data.files.get(indexURL));
    h.app.beginLibrarySetup();
    assert.match(text(h.app.renderLibrarySetup()), /cannot be made atomic|not atomic/);
    await h.app.commitLibrarySetup();
    assert.equal(h.app.librarySetupError, '');
    assert.equal(h.app.libraryOverview.setup.status, 'ready');
    assert.equal(JSON.stringify(data.files.get(indexURL)), before);
    assert.deepEqual(data.calls.filter((call) => call.method !== 'GET').map((call) => call.method), ['POST', 'POST']);
    assert.match(h.app.cardsBlockReason, /editor/);
    assert.equal(data.prompts.length, 0);
  });

  it('keeps access failures as errors without offering initialization', async () => {
    const { data, h } = await initial();
    data.files.set(indexURL, new Response(null, { status: 403 }));
    await h.app.refreshLibraryOverview();
    assert.match(h.app.libraryOverviewError, /403/);
    assert.doesNotMatch(text(h.app.renderLibrarySetup()), /Initialize library|Confirm initialize/);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
  });

  it('keeps verified setup successful when Preview fails and restores the warning without retrying', async () => {
    const { data, h } = await initial();
    const fetcher = h.app.hostActions.daFetch;
    h.app.hostActions.daFetch = async (url, options) => {
      if (url.startsWith('https://admin.hlx.page/preview/')) {
        data.calls.push({ url, method: options.method });
        return new Response(null, { status: 403 });
      }
      return fetcher(url, options);
    };
    h.app.beginLibrarySetup();
    await h.app.commitLibrarySetup();
    assert.equal(h.app.librarySetupReceipt.status, 'completed');
    assert.equal(h.app.librarySetupError, '');
    assert.match(h.app.notice, /saved.*Preview needs attention/);
    assert.equal(h.app.libraryPreviewReceipts[0].status, 'failed');
    assert.match(text(h.app.renderLibraryPreviewWarning()), /DA changes were saved|403/);
    const writes = data.calls.filter((call) => call.method !== 'GET').length;
    h.disconnect();
    const reopened = await harness(data);
    await reopened.connect({
      context: {
        org: h.app.context.org, site: h.app.context.site, path: '/index', view: 'canvas',
      },
    });
    await reopened.app.refreshLibraryOverview();
    assert.match(text(reopened.app.renderLibraryPreviewWarning()), /403/);
    assert.equal(data.calls.filter((call) => call.method !== 'GET').length, writes);
  });

  it('rejects a pending page action and target changes before initialization', async () => {
    const { data, h } = await initial();
    h.app.pageFlow = { name: 'hero', status: 'confirm' };
    h.app.beginLibrarySetup();
    assert.equal(h.app.librarySetupProposal, null);
    assert.match(h.app.librarySetupError, /pending|cancel/);
    h.app.pageFlow = null;
    h.app.beginLibrarySetup();
    h.app.context = { ...h.app.context, site: 'other' };
    await h.app.commitLibrarySetup();
    assert.match(h.app.librarySetupError, /target|site/);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
  });

  it('retains a partial setup outcome on failure and restores it without automatically writing again', async () => {
    const { data, h } = await initial({ registered: false });
    const original = h.app.hostActions.daFetch;
    h.app.hostActions.daFetch = async (url, options) => {
      if (options.method === 'POST') {
        data.calls.push({ url, method: 'POST' });
        return new Response(null, { status: 403 });
      }
      return original(url, options);
    };
    h.app.beginLibrarySetup();
    await h.app.commitLibrarySetup();
    assert.equal(h.app.librarySetupReceipt.status, 'partial');
    assert.equal(h.app.librarySetupReceipt.index, 'verified');
    assert.match(h.app.librarySetupError, /403/);
    assert.match(text(h.app.renderLibrarySetup()), /No automatic retry|no automatic retry/);
    assert.equal(h.app.libraryBusy, false);
    const writes = data.calls.filter((call) => call.method !== 'GET').length;
    h.disconnect();
    const reopened = await harness(data);
    await reopened.connect();
    assert.equal(reopened.app.librarySetupReceipt.status, 'partial');
    assert.equal(data.calls.filter((call) => call.method !== 'GET').length, writes);
  });
});

describe('Block-list/detail workflow', () => {
  const visibleText = (value) => {
    if (Array.isArray(value)) return value.map(visibleText).join(' ');
    if (value?.strings) return value.strings.join(' ') + value.values.map(visibleText).join(' ');
    return typeof value === 'string' ? value : '';
  };
  function configure(app) {
    app.selectProbeEnvironment('prod');
    app.discoveryResult = {
      provider: 'code-bus',
      diagnostics: [],
      blocks: [{ name: 'cards', files: [] }, { name: 'hero', files: [] }],
    };
    app.libraryOverview = {
      blocks: {
        cards: { status: 'existing', pagePath: '/docs/library/blocks/cards.html', editorURL: 'https://da.live/canvas#/msagolj/ew/docs/library/blocks/cards' },
        hero: { status: 'absent', pagePath: '/docs/library/blocks/hero.html' },
      },
    };
  }

  it('uses the shared status badges under block-list names with their existing state and labels', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    configure(h.app);
    const items = [];
    function collect(value) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value?.strings) {
        if (value.strings.join('').includes('class="block-nav-item"')) items.push(value);
        value.values.forEach(collect);
      }
    }
    collect(h.app.render());
    assert.equal(items.length, 2);
    items.forEach((item, index) => {
      assert.match(item.strings.join(''), /<span class="status-badge"\s+data-state=/);
      assert.ok(item.values.includes(index === 0 ? 'existing' : 'absent'));
      assert.ok(item.values.includes(index === 0 ? 'In library' : 'No library page'));
    });
    assert.equal(data.calls.length, 0);
  });

  it('opens desktop details without scrolling the dialog or changing the selected list position', async () => {
    const h = await harness(fixtures());
    await h.connect();
    configure(h.app);
    const pane = { scrollTop: 480 };
    const list = { scrollTop: 1600 };
    const calls = [];
    h.app.updateComplete = Promise.resolve();
    h.app.querySelector = (selector) => ({
      '#block-detail-heading': { focus: (options) => calls.push(['focus', options]) },
      '.detail-pane': pane,
      '.block-workspace': { scrollIntoView: (options) => calls.push(['scroll', options]) },
      '.block-sidebar ul': list,
    }[selector]);
    await h.app.selectBlock('hero');
    assert.equal(h.app.selectedBlock, 'hero');
    assert.equal(h.app.detailOpen, true);
    assert.equal(pane.scrollTop, 0);
    assert.equal(list.scrollTop, 1600);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'focus');
    assert.equal(calls[0][1].preventScroll, true);
  });

  it('preserves narrow-screen detail focus and Back to blocks focus on the selected row', async () => {
    const h = await harness(fixtures(), { wide: false });
    await h.connect();
    configure(h.app);
    const calls = [];
    h.app.updateComplete = Promise.resolve();
    h.app.querySelector = (selector) => ({
      '#block-detail-heading': { focus: (...args) => calls.push(['detail', ...args]) },
      '.block-nav-item[aria-current="true"]': {
        focus: (...args) => calls.push(['selected', ...args]),
      },
    }[selector]);
    await h.app.selectBlock('hero');
    h.app.backToBlocks();
    await settle();
    assert.equal(h.app.detailOpen, false);
    assert.deepEqual(calls, [['detail'], ['selected']]);
  });

  it('shows the real block list and existing status without a bottom Diagnostics panel', async () => {
    const h = await harness(fixtures());
    await h.connect();
    configure(h.app);
    h.app.selectBlock('hero');
    assert.equal(h.app.selectedBlock, 'hero');
    assert.equal(h.app.detailOpen, true);
    const detail = visibleText(h.app.renderBlockDetail());
    assert.match(detail, /Generation requires verified block code/);
    assert.doesNotMatch(detail, /Prepare Cards analysis|Create Cards page/);
    assert.doesNotMatch(visibleText(h.app.render()), /class="diagnostics"|<summary>Diagnostics<\/summary>/);
    h.app.selectBlock('cards');
    assert.match(visibleText(h.app.renderBlockDetail()), /In library/);
    assert.equal(h.app.blockStatus('cards'), 'In library');
    assert.equal(h.app.blockStatus('hero'), 'No library page');
  });

  it('retains discovery failure details and workflow errors without referring to removed Diagnostics', async () => {
    const h = await harness(fixtures());
    await h.connect();
    configure(h.app);
    h.app.discoveryResult = {
      provider: null,
      complete: false,
      blocks: [],
      diagnostics: [{ provider: 'code-bus', message: 'HTTP403: access denied.' }],
    };
    h.app.libraryOverviewError = 'Library index access failed.';
    const view = visibleText(h.app.render());
    assert.match(view, /Block discovery is unavailable/);
    assert.match(view, /code-bus: HTTP403: access denied/);
    assert.match(view, /Library index access failed/);
    assert.match(view, /<summary>Details<\/summary>/);
    assert.doesNotMatch(view, /Open Diagnostics|class="diagnostics"|manual names/);
  });

  it('does not offer or execute overwrites for an existing Cards entry', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    configure(h.app);
    h.app.selectedBlock = 'cards';
    h.app.cardsConfirmed = true;
    h.app.libraryReviewConfirmed = true;
    h.app.cardsState = 'completed';
    h.app.cardsResult = { status: 'completed', payload: { analysis: {} } };
    assert.doesNotMatch(visibleText(h.app.renderLibraryDryRun()), /Create Cards page and register/);
    await h.app.generateLibraryDryRun();
    assert.match(h.app.libraryError, /already|overwrite/i);
    assert.equal(data.calls.length, 0);
  });

  it('selects examples without changing raw results and clears stale proposal approvals', async () => {
    const h = await harness(fixtures());
    await h.connect();
    const analysis = {
      examples: [
        {
          id: 'one', name: 'One', description: 'Original', body: [['<p>One</p>']],
        },
        {
          id: 'two', name: 'Two', description: 'Second', body: [['<p>Two</p>']],
        },
      ],
    };
    h.app.cardsResult = { payload: { analysis } };
    h.app.libraryDraft = JSON.stringify(analysis);
    h.app.parseAnalysisHTML = () => ({
      children: [{}], querySelectorAll: () => [], textContent: 'Example',
    });
    h.app.selectedExampleIds = ['one', 'two'];
    h.app.libraryPreview = { stale: true };
    h.app.libraryReviewConfirmed = true;
    h.app.libraryCreationConfirmed = true;
    h.app.toggleExample('two', false);
    assert.deepEqual(JSON.parse(JSON.stringify(h.app.selectedAnalysis().examples.map((e) => e.id))), ['one']);
    h.app.editExample('one', 'description', 'Reviewed text');
    assert.equal(h.app.selectedAnalysis().examples[0].description, 'Reviewed text');
    assert.equal(analysis.examples[0].description, 'Original');
    assert.equal(h.app.libraryPreview, null);
    assert.equal(h.app.libraryReviewConfirmed, false);
    assert.equal(h.app.libraryCreationConfirmed, false);
    assert.match(h.app.libraryDraft, /Original/);
    assert.doesNotMatch(h.app.libraryDraft, /Reviewed text/);
    h.app.toggleExample('one', false);
    assert.throws(() => h.app.selectedAnalysis(), /select at least one/i);
  });

  it('keeps unsupported selection from dispatching Cards actions and refuses block changes during writes', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    configure(h.app);
    h.app.selectBlock('hero');
    h.app.cardsConfirmed = true;
    await h.app.prepareCardsAnalysis();
    assert.match(h.app.cardsError, /verified.*entry paths/i);
    assert.equal(data.calls.length, 0);
    h.app.libraryCreating = true;
    h.app.selectBlock('cards');
    assert.equal(h.app.selectedBlock, 'hero');
  });

  it('resets library overview and selected examples on target changes and discards late GETs', async () => {
    const h = await harness(fixtures());
    await h.connect();
    configure(h.app);
    let resolve;
    h.app.hostActions.daFetch = () => new Promise((done) => { resolve = done; });
    const pending = h.app.refreshLibraryOverview();
    h.app.selectProbeEnvironment('stage');
    resolve(Response.json({}));
    await pending;
    assert.equal(h.app.libraryOverview, null);
    assert.equal(h.app.selectedBlock, '');
    assert.equal(h.app.libraryOverviewError, '');
    assert.equal(h.app.selectedExampleIds, null);
  });

  it('shows readable nested findings without executing model markup', async () => {
    const h = await harness(fixtures());
    const text = visibleText(h.app.renderFindings({
      rowMapping: { classification: 'observed', evidence: ['cards.js:6'], explanation: '<script>not executable</script>' },
      warnings: ['Review before creating'],
    }));
    assert.match(text, /Row mapping/);
    assert.match(text, /observed/);
    assert.match(text, /not executable/);
    assert.match(text, /cards.js:6/);
  });

  it('shows an explicit draft-format error instead of breaking the detail render', async () => {
    const h = await harness(fixtures());
    h.app.cardsResult = { status: 'completed' };
    h.app.libraryDraft = JSON.stringify({ examples: [{ name: 'Bad', body: [42] }] });
    assert.match(visibleText(h.app.renderExampleReview()), /Cannot display this draft/);
  });

  it('keeps technical analysis under a labelled disclosure and offers an explicit output preview', async () => {
    const h = await harness(fixtures());
    await h.connect();
    h.app.cardsResult = {
      status: 'completed',
      payload: {
        analysis: {
          examples: [{
            id: 'sample',
            name: 'Technical name',
            description: 'children.length === 1',
            body: [['<p>Text</p>']],
            options: [],
            assumptions: [],
            evidence: [],
          }],
        },
      },
    };
    h.app.cardsState = 'completed';
    h.app.libraryDraft = JSON.stringify(h.app.cardsResult.payload.analysis);
    h.app.parseAnalysisHTML = () => ({ querySelectorAll: () => [], textContent: 'Text' });
    const choices = visibleText(h.app.renderExampleReview());
    assert.match(choices, /Choose examples/);
    assert.match(choices, /Preview library output/);
    assert.match(choices, /Text cards/);
    assert.doesNotMatch(choices, /children\.length|Technical name/);
    const workflow = visibleText(h.app.renderCardsAnalysis());
    assert.match(workflow, /Analysis details \(not included in library\)/);
    assert.match(workflow, /Example reasoning \(not library descriptions\)/);
    assert.equal(h.app.outputPreviewReady, false);
    assert.equal(h.app.renderLibraryOutput(), '');
  });

  it('uses explicit approved-image placeholders in the content preview, without loading raw model resources', async () => {
    const h = await harness(fixtures());
    const src = 'https://content.da.live/msagolj/ew/.index/image.jpg';
    h.app.cardsRequest = { input: { images: [{ src }] } };
    const imageNode = {
      nodeType: 1,
      tagName: 'IMG',
      childNodes: [],
      getAttribute: (name) => ({ src, alt: 'Example image' }[name] || null),
    };
    const view = h.app.renderOutputNode(imageNode);
    assert.match(view.strings.join(''), /role="img"/);
    assert.doesNotMatch(view.strings.join(''), /<img\b|onerror/);
    assert.match(visibleText(view), /Example image/);
    const unapproved = { ...imageNode, getAttribute: () => 'https://other.example/image.jpg' };
    assert.match(visibleText(h.app.renderOutputNode(unapproved)), /not in the approved asset set/);
  });
});

describe('One-shot page actions', () => {
  const text = (value) => {
    if (Array.isArray(value)) return value.map(text).join(' ');
    if (value?.strings) return value.strings.join(' ') + value.values.map(text).join(' ');
    return typeof value === 'string' ? value : '';
  };
  async function setup() {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.selectProbeEnvironment('prod');
    h.app.discoveryResult = {
      complete: true,
      provider: 'code-bus',
      diagnostics: [],
      blocks: [{ name: 'cards', files: [] }, { name: 'hero', files: [] }],
    };
    h.app.libraryOverview = {
      blocks: {
        cards: {
          status: 'existing', codeStatus: 'present', pagePath: '/docs/library/blocks/cards.html', editorURL: 'https://da.live/canvas#/msagolj/ew/docs/library/blocks/cards',
        },
        hero: { status: 'absent', codeStatus: 'present', pagePath: '/docs/library/blocks/hero.html' },
        retired: {
          status: 'existing', codeStatus: 'missing', pagePath: '/docs/library/blocks/retired.html', editorURL: 'https://da.live/canvas#/msagolj/ew/docs/library/blocks/retired',
        },
      },
    };
    data.files.set('https://admin.da.live/config/msagolj/ew', {
      library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] },
    });
    data.files.set('https://admin.da.live/source/msagolj/ew/docs/library/blocks.json', Response.json({
      ':type': 'sheet',
      total: 1,
      limit: 1,
      offset: 0,
      data: [{ name: 'Cards', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/cards' }],
    }, { headers: { ETag: '"index1"' } }));
    data.files.set(
      'https://admin.da.live/source/msagolj/ew/docs/library/blocks/cards.html',
      new Response('<body>Author changes</body>', {
        headers: { 'Content-Type': 'text/html', ETag: '"page1"' },
      }),
    );
    return { data, h };
  }

  it('shows only Open/Delete/Recreate for an existing page, never stale generated examples', async () => {
    const { data, h } = await setup();
    h.app.cardsResult = { status: 'completed', payload: { analysis: { examples: [{ name: 'STALE EXAMPLE' }] } } };
    await h.app.selectBlock('cards');
    const view = text(h.app.renderBlockDetail());
    assert.match(view, />Open<\/a>/);
    assert.match(view, />Delete<\/button>/);
    assert.match(view, />Recreate<\/button>/);
    assert.doesNotMatch(view, /STALE EXAMPLE|Choose examples|Get Cards examples|<ol/);
    assert.equal(data.calls.length, 0);
  });

  it('makes Open the primary action and leaves Delete/Recreate secondary for existing pages', async () => {
    const { h } = await setup();
    h.app.selectedBlock = 'cards';
    ['existing', 'unregistered'].forEach((status) => {
      h.app.libraryOverview.blocks.cards.status = status;
      const view = text(h.app.renderBlockDetail());
      assert.match(view, /<a class="page-open primary-action"/);
      assert.match(view, /target="_blank" rel="noopener noreferrer">Open<\/a>/);
      const buttons = view.match(/<button[^>]*>[^<]*<\/button>/g) || [];
      ['Delete', 'Recreate'].forEach((label) => {
        const button = buttons.find((markup) => markup.includes(`>${label}</button>`));
        assert.ok(button, label);
        assert.doesNotMatch(button, /primary-action/, label);
      });
    });
  });

  it('distinguishes planned page destinations from existing example pages', async () => {
    const { data, h } = await setup();
    h.app.selectedBlock = 'hero';
    ['absent', 'missing-page', 'existing', 'unregistered'].forEach((status) => {
      h.app.libraryOverview.blocks.hero.status = status;
      const view = text(h.app.renderBlockDetail());
      const missing = ['absent', 'missing-page'].includes(status);
      assert.ok(view.includes(missing ? 'Page to be created:' : 'Example page:'), status);
      assert.ok(!view.includes(missing ? 'Example page:' : 'Page to be created:'), status);
      assert.ok(view.includes('/docs/library/blocks/hero.html'), status);
    });
    assert.equal(data.calls.length, 0);
  });

  it('unions orphan pages with code inventory and marks missing code without inferring deletion', async () => {
    const { data, h } = await setup();
    assert.deepEqual(
      JSON.parse(JSON.stringify(h.app.blockItems.map((item) => item.name))),
      ['cards', 'hero', 'retired'],
    );
    await h.app.selectBlock('retired');
    const view = text(h.app.renderBlockDetail());
    assert.match(view, /Block code missing/);
    assert.match(view, />Open<\/a>/);
    assert.match(view, />Delete<\/button>/);
    assert.equal(h.app.hasBlockCode('retired'), false);
    assert.equal(data.calls.length, 0);
  });

  it('offers Create for no page and refuses unsupported or code-missing generation', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('hero');
    const view = text(h.app.renderBlockDetail());
    assert.match(view, />Create<\/button>/);
    assert.doesNotMatch(view, />Delete<\/button>/);
    await h.app.beginPageAction('create');
    assert.equal(h.app.pageFlow?.mode, 'create');
    assert.equal(data.calls.length, 0);
    h.app.cancelPageAction();
    await h.app.selectBlock('retired');
    await h.app.beginPageAction('recreate');
    assert.match(h.app.libraryError, /verified block code|Generation/);
    assert.equal(data.calls.length, 0);
  });

  it('explains the two Create stages and replaces the duplicate Create button with its active controls', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('hero');
    assert.match(text(h.app.renderBlockDetail()), />Create<\/button>/);
    await h.app.beginPageAction('create');
    const view = text(h.app.renderBlockDetail());
    assert.match(view, /Prepare examples/);
    assert.match(view, /Save library page/);
    assert.match(view, /Continue in chat/);
    assert.match(view, /review and send/i);
    assert.match(view, /No library page will be saved/i);
    assert.match(view, /Examples use three bundled placeholder images/);
    assert.doesNotMatch(view, /If this document has no usable images/);
    assert.doesNotMatch(view, />Create<\/button>|Confirm create page|Production DA|ETag/);
    assert.equal(data.calls.length, 0);
    h.app.cancelPageAction();
    assert.match(text(h.app.renderBlockDetail()), />Create<\/button>/);
    assert.equal(h.app.pageFlow, null);
  });

  it('shows actionable waiting and result-not-ready states without claiming chat started or creating a page', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('hero');
    await h.app.beginPageAction('create');
    h.app.pageFlow = { ...h.app.pageFlow, status: 'waiting' };
    let view = text(h.app.renderPageAction());
    assert.match(view, /Review and send/);
    assert.match(view, /Check result/);
    assert.match(view, /does not stop chat/);
    assert.doesNotMatch(view, /agent is running|Generating|Confirm create page/);
    h.app.cardsState = 'pending';
    view = text(h.app.renderPageAction());
    assert.match(view, /No result yet/);
    assert.match(view, /check again/i);
    assert.equal(data.calls.length, 0);
    assert.equal(data.prompts.length, 0);
  });

  it('retries blocked Create through a fresh confirmation without changing the prior job or starting chat', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('hero');
    const previous = jobs.createJobRequest({
      target: h.app.probeTarget, kind: 'analysis', input: { blockName: 'hero' },
    });
    const root = 'https://admin.da.live/source/msagolj/ew';
    const result = { status: 'completed', payload: { generation: 'blocked' } };
    data.files.set(`${root}${previous.requestPath}`, previous);
    data.files.set(`${root}${previous.resultPath}`, result);
    jobs.saveJobPointer(data.storage, previous, true);
    h.app.cardsRequest = previous;
    h.app.cardsResult = result;
    h.app.savePageFlow({
      mode: 'create',
      name: 'hero',
      environment: 'prod',
      status: 'blocked',
      jobId: previous.jobId,
      startedAt: previous.createdAt,
      error: 'External content is required.',
    });
    await h.app.retryPageGeneration();
    assert.equal(h.app.libraryError, '');
    assert.equal(h.app.pageFlow.mode, 'create');
    assert.equal(h.app.pageFlow.status, 'confirm');
    assert.equal(h.app.pageFlow.jobId, undefined);
    assert.equal(h.app.pageFlow.error, '');
    assert.equal(h.app.cardsRequest, null);
    assert.equal(h.app.cardsResult, null);
    assert.match(text(h.app.renderPageAction()), /Continue in chat/);
    assert.doesNotMatch(text(h.app.renderPageAction()), /Confirm create page/);
    assert.equal(data.calls.length, 0);
    assert.equal(data.prompts.length, 0);
    assert.equal(data.files.get(`${root}${previous.requestPath}`), previous);
    assert.equal(data.files.get(`${root}${previous.resultPath}`), result);
    assert.equal(jobs.loadJobPointer(data.storage, previous.target, 'analysis', 'hero').jobId, previous.jobId);
  });

  it('keeps blocked Recreate recoverable and shows a retry error when the current page cannot be read', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    await h.app.beginPageAction('recreate');
    h.app.savePageFlow({
      ...h.app.pageFlow, status: 'blocked', error: 'External content is required.',
    });
    const blocked = h.app.pageFlow;
    data.files.set(
      'https://admin.da.live/source/msagolj/ew/docs/library/blocks/cards.html',
      new Response(null, { status: 403 }),
    );
    await h.app.retryPageGeneration();
    assert.equal(h.app.pageFlow, blocked);
    assert.match(h.app.libraryError, /403/);
    assert.match(text(h.app.renderPageAction()), /requested action could not be completed/);
    assert.match(text(h.app.renderPageAction()), /Retry analysis|Dismiss/);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
    assert.equal(data.prompts.length, 0);
  });

  it('does not use retry to replace a different pending action or a foreign target', async () => {
    await Promise.all(['waiting', 'different-block', 'different-target'].map(async (scenario) => {
      const { data, h } = await setup();
      await h.app.selectBlock('hero');
      const flow = {
        mode: 'create',
        name: scenario === 'different-block' ? 'cards' : 'hero',
        environment: 'prod',
        status: scenario === 'waiting' ? 'waiting' : 'blocked',
        startedAt: new Date().toISOString(),
        target: scenario === 'different-target'
          ? jobs.getProbeTarget('prod', { org: 'other-org', site: 'other-site' }) : h.app.probeTarget,
        error: 'Keep this action.',
      };
      h.app.pageFlow = flow;
      await h.app.retryPageGeneration();
      assert.equal(h.app.pageFlow, flow);
      assert.ok(h.app.libraryError);
      assert.equal(data.calls.length, 0);
      assert.equal(data.prompts.length, 0);
    }));
  });

  it('separates preparation, result checks and page saving without contradictory controls or messages', async () => {
    const { h } = await setup();
    await h.app.selectBlock('hero');
    await h.app.beginPageAction('create');
    h.app.cardsBusy = true;
    h.app.cardsState = 'collecting';
    let view = text(h.app.renderPageAction());
    assert.match(view, /Preparing examples/);
    assert.doesNotMatch(view, /Continue in chat/);
    h.app.pageFlow = { ...h.app.pageFlow, status: 'waiting' };
    h.app.cardsState = 'requested';
    view = text(h.app.renderPageAction());
    assert.match(view, /Checking result/);
    assert.doesNotMatch(view, /Review and send|Check result<\/button>/);
    h.app.cardsBusy = false;
    h.app.pageFlow = { ...h.app.pageFlow, status: 'ready' };
    h.app.libraryBusy = true;
    h.app.libraryCreating = true;
    view = text(h.app.renderPageAction());
    assert.match(view, /Saving library page/);
    assert.doesNotMatch(view, /No library page|not yet saved|Confirm create page|>Cancel</);
  });

  it('keeps final Create consent separate and reports the selected example count without listing recipes', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('hero');
    await h.app.beginPageAction('create');
    h.app.pageFlow = { ...h.app.pageFlow, status: 'ready' };
    h.app.selectedExampleIds = ['first', 'second'];
    const view = text(h.app.renderPageAction());
    assert.match(view, /2 examples/);
    assert.match(view, /Confirm create page/);
    assert.match(view, /Blocks selector/);
    assert.match(view, /Nothing is published/);
    assert.doesNotMatch(view, /Continue in chat|class="example-card"|class="recipe"/);
    assert.equal(data.calls.length, 0);
    assert.equal(data.prompts.length, 0);
  });

  it('distinguishes an analysis failure from a potentially partial page save', async () => {
    const { h } = await setup();
    await h.app.selectBlock('hero');
    await h.app.beginPageAction('create');
    h.app.pageFlow = { ...h.app.pageFlow, status: 'failed', error: 'Analysis request failed' };
    let view = text(h.app.renderPageAction());
    assert.match(view, /No library page was saved/);
    assert.doesNotMatch(view, /may have been saved|may have succeeded|Refresh current state/);
    h.app.pageFlow = {
      ...h.app.pageFlow,
      status: 'partial',
      error: 'Index write failed',
      receipt: { status: 'partial', page: 'verified', index: 'attempted' },
    };
    view = text(h.app.renderPageAction());
    assert.match(view, /may have been saved/);
    assert.match(view, /Refresh current state/);
    assert.doesNotMatch(view, /No library page was saved/);
  });

  it('preserves partial creation status when the internal writer has already recorded a partial receipt', async () => {
    const { h } = await setup();
    await h.app.selectBlock('hero');
    await h.app.beginPageAction('create');
    h.app.pageFlow = { ...h.app.pageFlow, status: 'ready', jobId: 'new-job' };
    h.app.cardsRequest = {
      jobId: 'new-job', kind: 'analysis', input: { blockName: 'hero' }, target: h.app.probeTarget,
    };
    h.app.generateLibraryDryRun = async () => { h.app.libraryPreview = { proposed: true }; };
    h.app.createApprovedLibrary = async () => {
      h.app.libraryCreationReceipt = {
        jobId: 'new-job', status: 'partial', page: 'verified', index: 'attempted',
      };
      h.app.libraryError = 'Index write failed';
    };
    await h.app.commitPageAction();
    assert.equal(h.app.pageFlow.status, 'partial');
    assert.match(text(h.app.renderPageAction()), /may have been saved/);
  });

  it('prepares a delete confirmation using GETs only and cancellation leaves page/index alone', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    await h.app.beginPageAction('delete');
    assert.equal(h.app.libraryError, '');
    assert.equal(h.app.pageFlow.status, 'confirm');
    assert.equal(h.app.pageFlow.snapshot.pageETag, '"page1"');
    assert.ok(data.calls.every((call) => call.method === 'GET'));
    const confirmation = text(h.app.renderPageAction());
    assert.match(confirmation, /Confirm delete page and index entry/);
    assert.match(confirmation, /deletes the example page and removes its library-index entry/);
    assert.match(confirmation, /Block code, images and unrelated entries are not deleted/);
    assert.doesNotMatch(confirmation, /Production DA|action-target|atomic|conditional|rechecked|concurrent/);
    h.app.cancelPageAction();
    assert.equal(h.app.pageFlow, null);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
  });

  it('cleans the fresh recreation job only after verified replacement and returns to normal actions', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    await h.app.beginPageAction('recreate');
    const request = cards.createCardsRequest({
      target: h.app.probeTarget,
      input: {
        prompt: 'Saved prompt.',
        sourcePage: '/index',
        sources: cards.CARDS_SOURCE_PATHS.map((id) => ({ id, content: '' })),
        images: [{ src: 'https://content.da.live/msagolj/ew/.index/image.jpg', alt: '' }],
      },
    });
    const analysis = {
      blockName: 'cards',
      analysisScope: {},
      structure: {},
      contentRules: {},
      derivedBehavior: {},
      sharedBehavior: {},
      warnings: [],
      unknowns: [],
      optionAnalysis: { status: 'none-found', supportedOptions: [] },
      examples: [{
        id: 'text',
        name: 'Text',
        description: 'Text example',
        options: [],
        body: [['<p>New content</p>']],
        evidence: [cards.CARDS_SOURCE_PATHS[0]],
        assumptions: [],
      }],
    };
    const p = {
      nodeType: 1, tagName: 'P', attributes: [], childNodes: [{ nodeType: 3, textContent: 'New content' }],
    };
    h.app.parseAnalysisHTML = () => ({
      children: [p], childNodes: [p], textContent: 'New content', querySelectorAll: () => [p],
    });
    const root = 'https://admin.da.live/source/msagolj/ew';
    const result = {
      schemaVersion: 1,
      jobId: request.jobId,
      kind: request.kind,
      target: request.target,
      status: 'completed',
      payload: { analysis },
    };
    data.files.set(`${root}${request.requestPath}`, request);
    data.files.set(`${root}${request.resultPath}`, result);
    jobs.saveJobPointer(data.storage, request, true);
    h.app.cardsRequest = request;
    h.app.cardsResult = result;
    h.app.libraryDraft = JSON.stringify(analysis);
    h.app.savePageFlow({
      ...h.app.pageFlow, status: 'ready', jobId: request.jobId, jobKind: request.kind,
    });
    const fetcher = h.app.hostActions.daFetch;
    let savedPage = '<body>Author changes</body>';
    let pageETag = '"page1"';
    h.app.hostActions.daFetch = async (url, options) => {
      if (url === `${root}/docs/library/blocks/cards.html` && options.method === 'GET') {
        data.calls.push({ url, method: 'GET' });
        return new Response(savedPage, { headers: { 'Content-Type': 'text/html', ETag: pageETag } });
      }
      if (url === `${root}/docs/library/blocks/cards.html` && options.method === 'PUT') {
        data.calls.push({ url, method: 'PUT' });
        savedPage = await options.body.get('data').text();
        pageETag = '"updated"';
        data.files.set(url, savedPage);
        return new Response(null, { status: 200 });
      }
      if (options.method === 'DELETE') {
        assert.equal(h.app.pageFlow.status, 'completed', 'Persist page success before scratch cleanup');
      }
      return fetcher(url, options);
    };
    await h.app.commitPageAction();
    assert.equal(h.app.libraryError, '');
    assert.equal(h.app.pageFlow, null);
    assert.match(h.app.notice, /recreated/);
    assert.equal(h.app.jobCleanupReceipt.status, 'completed');
    assert.equal(h.app.jobCleanupError, '');
    assert.ok(h.app.libraryPreviewReceipts.every((receipt) => receipt.status === 'completed'));
    assert.equal(jobs.loadJobPointer(data.storage, request.target, 'cards'), null);
    assert.equal(h.app.cardsSaved, null);
    assert.equal(h.app.cardsRequest, null);
    assert.deepEqual(data.calls.filter((call) => call.method === 'DELETE').map((call) => call.url), [
      `${root}${request.resultPath}`, `${root}${request.requestPath}`,
    ]);
    const firstDelete = data.calls.findIndex((call) => call.method === 'DELETE');
    const verifiedReads = data.calls.slice(0, firstDelete).filter((call) => call.method === 'GET');
    assert.ok(verifiedReads.some((call) => call.url.endsWith('/blocks.json')));
    assert.ok(verifiedReads.some((call) => call.url.endsWith('/cards.html')));
    assert.ok(data.files.has(`${root}/docs/library/blocks/cards.html`));
  });

  it('restores interrupted cleanup as a separate warning without resuming or rewriting the saved page', async () => {
    const data = fixtures();
    const request = jobs.createJobRequest({
      target: jobs.getProbeTarget('prod'), kind: 'analysis', input: { blockName: 'cards' },
    });
    jobs.saveJobPointer(data.storage, request, true);
    jobs.saveJobCleanupReceipt(data.storage, {
      schemaVersion: 1,
      kind: 'job-cleanup',
      target: request.target,
      jobId: request.jobId,
      jobKind: request.kind,
      blockName: 'cards',
      status: 'deleting-result',
      request: 'pending',
      result: 'attempted',
      error: '',
      updatedAt: new Date().toISOString(),
    });
    data.storage.setItem('block-library-generator:page-flow:v2:prod:msagolj:ew:main', JSON.stringify({
      mode: 'create',
      name: 'cards',
      target: request.target,
      environment: 'prod',
      status: 'completed',
      startedAt: request.createdAt,
      jobId: request.jobId,
      jobKind: request.kind,
    }));
    const h = await harness(data);
    await h.connect();
    assert.equal(h.app.pageFlow, null);
    assert.match(h.app.jobCleanupError, /interrupted/);
    assert.match(text(h.app.renderJobCleanupWarning()), /page was saved|page is saved/);
    assert.equal(data.calls.length, 0);
    assert.equal(data.prompts.length, 0);
  });

  it('preserves verified page success when cleanup progress storage fails', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    const request = jobs.createJobRequest({
      target: h.app.probeTarget, kind: 'analysis', input: { blockName: 'cards' },
    });
    h.app.cardsRequest = request;
    jobs.saveJobPointer(data.storage, request, true);
    h.app.savePageFlow({
      mode: 'create',
      name: 'cards',
      status: 'ready',
      environment: 'prod',
      startedAt: request.createdAt,
      jobId: request.jobId,
      jobKind: request.kind,
    });
    const original = data.storage.setItem;
    data.storage.setItem = (key, value) => {
      if (key.includes(':cleanup:')) throw new Error('Cleanup storage unavailable');
      original(key, value);
    };
    await h.app.cleanupSavedAnalysis(request, {
      kind: 'library-creation',
      jobId: request.jobId,
      blockName: 'cards',
      target: request.target,
      status: 'completed',
      page: 'verified',
      index: 'verified',
    });
    assert.equal(h.app.pageFlow.status, 'completed');
    assert.equal(h.app.libraryError, '');
    assert.match(h.app.jobCleanupError, /Cleanup storage unavailable/);
    assert.ok(jobs.loadJobPointer(data.storage, request.target, request.kind, 'cards'));
    assert.equal(data.calls.length, 0);
  });

  it('does not claim page success from unreadable cleanup metadata', async () => {
    const data = fixtures();
    const request = jobs.createJobRequest({
      target: jobs.getProbeTarget('prod'), kind: 'analysis', input: { blockName: 'cards' },
    });
    jobs.saveJobPointer(data.storage, request, true);
    data.storage.setItem(
      `block-library-generator:cleanup:v1:prod:msagolj:ew:main:${request.jobId}`,
      '{broken',
    );
    const h = await harness(data);
    await h.connect();
    const warning = text(h.app.renderJobCleanupWarning());
    assert.match(warning, /cleanup status could not be read/);
    assert.doesNotMatch(warning, /page was saved|page is saved/);
    assert.equal(data.calls.length, 0);
  });

  it('does not overwrite on Recreate click; requires fresh generation and explicit final confirmation', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    await h.app.beginPageAction('recreate');
    assert.equal(h.app.pageFlow.status, 'confirm');
    h.app.pageFlow.snapshot.pageETag = null;
    const confirmation = text(h.app.renderPageAction());
    assert.match(confirmation, /later author edits|later.*edits/);
    assert.match(confirmation, /current page stays in place until replacement is ready and you confirm/);
    assert.match(confirmation, /Examples use three bundled placeholder images/);
    assert.doesNotMatch(confirmation, /Production DA|ETag|atomically|concurrent|rechecked/);
    await h.app.commitPageAction();
    assert.match(h.app.libraryError, /Confirm/);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
    assert.equal(data.prompts.length, 0);
    h.app.cancelPageAction();
    assert.equal(h.app.pageFlow, null);
  });

  it('restores the same site action on reopening without loading an old analysis', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    await h.app.beginPageAction('recreate');
    const flow = h.app.pageFlow;
    h.disconnect();
    const reopened = await harness(data);
    await reopened.connect();
    assert.equal(reopened.app.pageFlow.startedAt, flow.startedAt);
    assert.equal(reopened.app.pageFlow.mode, 'recreate');
    assert.equal(reopened.app.cardsRequest, null);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
  });

  it('retries blocked recreation with a fresh snapshot/job and waits for final replacement confirmation', async () => {
    const { data, h } = await setup();
    const image = 'https://content.da.live/msagolj/ew/.index/image.jpg';
    h.app.discoveryResult.blocks[0].files = cards.CARDS_SOURCE_PATHS.slice(0, 2)
      .map((path) => ({ path }));
    cards.CARDS_SOURCE_PATHS.forEach((path) => {
      data.files.set(
        `https://main--ew--msagolj.preview.da.live${path}`,
        new Response('Source.', { headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } }),
      );
    });
    data.files.set(
      'https://admin.da.live/source/msagolj/ew/index.html',
      new Response('<main>Test</main>', { headers: { 'Content-Type': 'text/html' } }),
    );
    data.fetchPublic = async () => new Response('Prompt.', { headers: { 'Content-Type': 'text/plain' } });
    h.app.parseAnalysisHTML = () => ({
      children: [{}],
      textContent: 'Content',
      querySelectorAll: (selector) => (selector === 'img[src]'
        ? [{ getAttribute: (name) => (name === 'src' ? image : '') }]
        : [{ tagName: 'P', attributes: [] }]),
    });
    await h.app.selectBlock('cards');
    await h.app.beginPageAction('recreate');
    const previous = jobs.createJobRequest({
      target: h.app.probeTarget, kind: 'analysis', input: { blockName: 'cards' },
    });
    const root = 'https://admin.da.live/source/msagolj/ew';
    data.files.set(`${root}${previous.requestPath}`, previous);
    const previousResult = { status: 'completed', payload: { generation: 'blocked' } };
    data.files.set(`${root}${previous.resultPath}`, previousResult);
    jobs.saveJobPointer(data.storage, previous, true);
    h.app.cardsSaved = { jobId: previous.jobId, kind: 'analysis', handoffRequested: true };
    h.app.savePageFlow({
      ...h.app.pageFlow, status: 'blocked', jobId: previous.jobId, error: 'Earlier inputs were unavailable.',
    });
    data.files.set(`${root}/docs/library/blocks/cards.html`, new Response('<body>Author changes</body>', {
      headers: { 'Content-Type': 'text/html', ETag: '"page2"' },
    }));
    data.files.set('https://main--ew--msagolj.preview.da.live/blocks/cards/cards.js', new Response('Updated source.', {
      headers: { 'Content-Type': 'text/javascript' },
    }));
    await h.app.retryPageGeneration();
    assert.equal(h.app.pageFlow.status, 'confirm');
    assert.equal(h.app.pageFlow.snapshot.pageETag, '"page2"');
    assert.equal(h.app.pageFlow.jobId, undefined);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
    assert.equal(data.prompts.length, 0);
    await h.app.generatePageSuggestions();
    assert.equal(h.app.pageFlow.status, 'waiting');
    assert.equal(h.app.pageFlow.jobId, h.app.cardsRequest.jobId);
    assert.notEqual(h.app.cardsRequest.jobId, previous.jobId);
    assert.equal(h.app.cardsRequest.input.sources.find((entry) => entry.id === '/blocks/cards/cards.js').content, 'Updated source.');
    assert.equal(data.files.get(`${root}${previous.requestPath}`), previous);
    assert.equal(data.files.get(`${root}${previous.resultPath}`), previousResult);
    assert.equal(data.prompts.length, 1);
    assert.equal(data.prompts[0].options.autoSend, false);
    assert.ok(data.calls.filter((call) => call.method !== 'GET')
      .every((call) => call.url.includes('/.da/block-library-generator/jobs/')
        || call.url.includes('/docs/library/media/block-library-generator/')));
    const request = h.app.cardsRequest;
    data.files.set(`https://admin.da.live/source/msagolj/ew${request.resultPath}`, {
      schemaVersion: 1,
      kind: request.kind,
      jobId: request.jobId,
      target: request.target,
      status: 'completed',
      payload: {
        analysis: {
          blockName: 'cards',
          generation: { status: 'ready', reason: '' },
          analysisScope: {},
          structure: {},
          contentRules: {},
          derivedBehavior: {},
          sharedBehavior: {},
          warnings: [],
          unknowns: [],
          optionAnalysis: { status: 'none-found', supportedOptions: [] },
          examples: [{
            id: 'fresh',
            name: 'Fresh',
            description: 'Fresh output',
            body: [['<p>Content</p>']],
            options: [],
            assumptions: [],
            evidence: [cards.CARDS_SOURCE_PATHS[0]],
          }],
        },
      },
    });
    const count = data.calls.length;
    await h.app.loadPageGeneration();
    assert.equal(h.app.pageFlow.status, 'ready');
    assert.ok(data.calls.slice(count).every((call) => call.method === 'GET'));
    assert.match(text(h.app.renderPageAction()), /Confirm replace entire page/);
    assert.doesNotMatch(text(h.app.renderBlockDetail()), /class="example-card"|Choose examples/);
    const page = data.files.get('https://admin.da.live/source/msagolj/ew/docs/library/blocks/cards.html');
    assert.equal(await page.clone().text(), '<body>Author changes</body>');
  });

  it('rejects a prior request as the result of a newly confirmed recreation', async () => {
    const { data, h } = await setup();
    const old = cards.createCardsRequest({
      environment: 'prod',
      createdAt: '2026-01-01T00:00:00Z',
      input: {
        prompt: 'Old',
        sourcePage: '/index.html',
        sources: cards.CARDS_SOURCE_PATHS.map((id) => ({ id, content: '' })),
        images: [{ src: 'https://content.da.live/msagolj/ew/.index/image.jpg', alt: '' }],
      },
    });
    await h.app.selectBlock('cards');
    await h.app.beginPageAction('recreate');
    h.app.savePageFlow({ ...h.app.pageFlow, status: 'waiting', jobId: old.jobId });
    data.files.set(`https://admin.da.live/source/msagolj/ew${old.requestPath}`, old);
    await h.app.loadPageGeneration();
    assert.equal(h.app.cardsState, 'error');
    assert.match(h.app.cardsError, /newly generated|fresh/);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
  });

  it('never reports a new Create success using a previous job receipt after a failed write', async () => {
    const { h } = await setup();
    await h.app.selectBlock('cards');
    h.app.pageFlow = {
      mode: 'create',
      name: 'cards',
      environment: 'prod',
      status: 'ready',
      startedAt: new Date().toISOString(),
      jobId: 'new-job',
    };
    h.app.cardsRequest = { jobId: 'new-job', kind: 'cards', target: h.app.probeTarget };
    h.app.libraryOverview.blocks.cards.status = 'absent';
    h.app.libraryCreationReceipt = { jobId: 'old-job', status: 'completed' };
    h.app.generateLibraryDryRun = async () => { h.app.libraryPreview = { proposed: true }; };
    h.app.createApprovedLibrary = async () => { h.app.libraryError = 'Write failed'; };
    await h.app.commitPageAction();
    assert.equal(h.app.pageFlow.status, 'failed');
    assert.match(h.app.pageFlow.error, /Write failed/);
  });

  it('starts fresh generation for every current-site block using its own verified entry paths', async () => {
    await Promise.all(['cards', 'columns', 'hero', 'header', 'footer', 'fragment', 'widget'].map(async (name) => {
      const { data, h } = await setup();
      const entryPaths = [`/blocks/${name}/${name}.js`, `/blocks/${name}/${name}.css`];
      h.app.discoveryResult.blocks.push({ name, files: entryPaths.map((path) => ({ path })) });
      h.app.discoveryResult.blocks = h.app.discoveryResult.blocks.filter((block, index, list) => (
        list.findIndex((item) => item.name === block.name) === index
      ));
      const discovered = h.app.discoveryResult.blocks.find((block) => block.name === name);
      discovered.files = entryPaths.map((path) => ({ path }));
      h.app.libraryOverview.blocks[name] = { status: 'absent', codeStatus: 'present', pagePath: `/docs/library/blocks/${name}.html` };
      [...entryPaths, '/styles/styles.css', '/styles/lazy-styles.css'].forEach((path) => {
        data.files.set(
          `https://main--ew--msagolj.preview.da.live${path}`,
          new Response('', { headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } }),
        );
      });
      data.files.set(
        'https://admin.da.live/source/msagolj/ew/index.html',
        new Response('<main>Home</main>', { headers: { 'Content-Type': 'text/html' } }),
      );
      data.fetchPublic = async () => new Response('Prompt.', { headers: { 'Content-Type': 'text/plain' } });
      h.app.parseAnalysisHTML = () => ({
        children: [{}],
        textContent: 'Example',
        querySelectorAll: (selector) => (selector === 'img[src]' ? [] : [{ tagName: 'P', attributes: [] }]),
      });
      await h.app.selectBlock(name);
      await h.app.beginPageAction('create');
      await h.app.generatePageSuggestions();
      assert.equal(h.app.cardsError, '', name);
      assert.equal(h.app.pageFlow.status, 'waiting', name);
      assert.equal(h.app.pageFlow.jobKind, 'analysis');
      assert.equal(h.app.cardsRequest.input.blockName, name);
      assert.equal(h.app.cardsRequest.input.images.length, 3);
      assert.ok(h.app.cardsRequest.input.images.every((image) => (
        image.src.startsWith('https://content.da.live/msagolj/ew/docs/library/media/block-library-generator/')
      )));
      assert.deepEqual(h.app.cardsRequest.input.entryPaths, entryPaths);
      assert.equal(jobs.loadJobPointer(data.storage, 'prod', 'analysis', name).jobId, h.app.cardsRequest.jobId);
      assert.ok(data.prompts[0].text.includes(`blockName must be ${name}.`));
      assert.ok(data.calls.filter((call) => call.method === 'PUT')
        .every((call) => call.url.includes('/.da/block-library-generator/jobs/')
          || call.url.includes('/docs/library/media/block-library-generator/')));
      assert.equal(data.calls.filter((call) => call.method === 'PUT').length, 4);
    }));
  });

  it('does not prepare a job or hand off chat when placeholder image copying is denied', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('hero');
    const paths = ['/blocks/hero/hero.js', '/blocks/hero/hero.css',
      '/styles/styles.css', '/styles/lazy-styles.css'];
    h.app.discoveryResult.blocks.find((block) => block.name === 'hero').files = paths.slice(0, 2).map((path) => ({ path }));
    paths.forEach((path) => data.files.set(
      `https://main--ew--msagolj.preview.da.live${path}`,
      new Response('', { headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } }),
    ));
    data.files.set(
      'https://admin.da.live/source/msagolj/ew/index.html',
      new Response('<main>Home</main>', { headers: { 'Content-Type': 'text/html' } }),
    );
    data.fetchPublic = async () => new Response('Prompt.', { headers: { 'Content-Type': 'text/plain' } });
    h.app.parseAnalysisHTML = () => ({ querySelectorAll: () => [] });
    const fetcher = h.app.hostActions.daFetch;
    h.app.hostActions.daFetch = async (url, options) => {
      if (options.method === 'PUT' && url.includes('/docs/library/media/')) {
        data.calls.push({ url, method: 'PUT' });
        return new Response(null, { status: 403 });
      }
      return fetcher(url, options);
    };
    await h.app.beginPageAction('create');
    await h.app.generatePageSuggestions();
    assert.match(h.app.cardsError, /403/);
    assert.equal(h.app.cardsRequest, null);
    assert.equal(data.prompts.length, 0);
    assert.ok(!data.calls.some((call) => call.method === 'PUT' && call.url.includes('/.da/')));
  });

  it('keeps long blocked reasons in collapsed Details for both Create and Recreate', async () => {
    const { data, h } = await setup();
    const reason = `The decorator replaces authored content with an external response. ${
      'A resolvable content-fragment path is required. '.repeat(12)}`;
    function markup(value) {
      if (Array.isArray(value)) return value.map(markup).join('');
      if (value?.strings) {
        return value.strings.reduce((output, part, index) => (
          output + part + markup(value.values[index])
        ), '');
      }
      return typeof value === 'string' ? value : '';
    }
    h.app.selectedBlock = 'hero';
    ['create', 'recreate'].forEach((mode) => {
      h.app.libraryOverview.blocks.hero.status = mode === 'recreate' ? 'existing' : 'absent';
      h.app.pageFlow = {
        mode, name: 'hero', status: 'blocked', error: reason,
      };
      const html = markup(h.app.renderPageAction());
      const details = html.match(/<details>([\s\S]*?)<\/details>/);
      assert.ok(details, 'Full reasoning must remain available under Details');
      assert.ok(details[1].includes(reason));
      const initial = html.replace(/<details>[\s\S]*?<\/details>/g, '');
      assert.ok(!initial.includes(reason), 'Technical reasoning must not appear in the initial summary');
      assert.match(initial, /Working examples could not be generated from the block's code/);
      assert.doesNotMatch(initial, /More content or configuration is needed/);
      assert.match(initial, mode === 'create'
        ? /No library page was saved/
        : /The existing library page was not changed/);
      assert.match(initial, /Dismiss/);
      assert.match(initial, /Retry analysis/);
      assert.match(initial, /update the block's JavaScript or CSS and retry the analysis/);
      if (mode === 'create') {
        assert.match(initial, /Alternatively, create a default example page as a starting point/);
        assert.match(initial, /edit the block in DA to provide usable values/);
      } else {
        assert.match(initial, /Replace with a default example page/);
        assert.match(initial, /replacing the existing page/);
      }
      assert.doesNotMatch(initial, /Make any needed changes in the site or editor/);
      assert.doesNotMatch(html, /<details[^>]*\bopen\b|Confirm create page|Confirm replace entire page/);
      assert.equal(h.app.pageFlow.error, reason);
    });
    assert.equal(data.calls.length, 0);
  });

  it('shows an honest blocked generation verdict instead of enabling page creation', async () => {
    const { data, h } = await setup();
    const request = blockAnalysis.createAnalysisRequest({
      environment: 'prod',
      input: {
        blockName: 'header',
        entryPaths: ['/blocks/header/header.js'],
        prompt: 'Prompt.',
        sourcePage: '/index.html',
        images: [],
        links: [{ href: '/index', label: 'Home' }],
        sources: ['/blocks/header/header.js', '/styles/styles.css', '/styles/lazy-styles.css']
          .map((id) => ({ id, content: '' })),
      },
    });
    h.app.discoveryResult.blocks.push({ name: 'header', files: [{ path: '/blocks/header/header.js' }] });
    await h.app.selectBlock('header');
    h.app.pageFlow = {
      mode: 'create',
      name: 'header',
      environment: 'prod',
      jobId: request.jobId,
      jobKind: 'analysis',
      startedAt: request.createdAt,
      status: 'waiting',
    };
    data.files.set(`https://admin.da.live/source/msagolj/ew${request.requestPath}`, request);
    data.files.set(`https://admin.da.live/source/msagolj/ew${request.resultPath}`, {
      schemaVersion: 1,
      jobId: request.jobId,
      target: request.target,
      kind: 'analysis',
      status: 'completed',
      payload: {
        analysis: {
          blockName: 'header',
          generation: { status: 'blocked', reason: 'Navigation content is required.' },
          analysisScope: {},
          structure: {},
          contentRules: {},
          derivedBehavior: {},
          sharedBehavior: {},
          optionAnalysis: { status: 'incomplete', supportedOptions: [] },
          warnings: [],
          unknowns: [],
          examples: [],
        },
      },
    });
    await h.app.loadPageGeneration();
    assert.equal(h.app.cardsError, '');
    assert.equal(h.app.pageFlow.status, 'blocked');
    assert.match(text(h.app.renderPageAction()), /Navigation content is required/);
    assert.doesNotMatch(text(h.app.renderPageAction()), /Confirm create page/);
    await h.app.commitPageAction();
    assert.match(h.app.libraryError, /Confirm/);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
  });
});

describe('Diagnostic saved Cards readers (not the page landing view)', () => {
  async function setup({ status = 'completed' } = {}) {
    const data = fixtures();
    const request = cards.createCardsRequest({
      environment: 'prod',
      input: {
        prompt: 'Saved prompt.',
        sourcePage: '/index.html',
        sources: cards.CARDS_SOURCE_PATHS.map((id) => ({ id, content: 'Source.' })),
        images: [{ src: 'https://content.da.live/msagolj/ew/.index/image.jpg', alt: '' }],
      },
    });
    const analysis = {
      blockName: 'cards',
      analysisScope: {},
      structure: {},
      contentRules: {},
      optionAnalysis: { status: 'none-found', supportedOptions: [] },
      derivedBehavior: {},
      sharedBehavior: {},
      warnings: [],
      unknowns: [],
      examples: [{
        id: 'text',
        name: 'Original',
        description: 'Technical source notes.',
        options: [],
        body: [['<p>Example</p>']],
        evidence: [cards.CARDS_SOURCE_PATHS[0]],
        assumptions: [],
      }],
    };
    jobs.saveJobPointer(data.storage, request, true);
    data.files.set(`https://admin.da.live/source/msagolj/ew${request.requestPath}`, request);
    if (status === 'completed') {
      data.files.set(`https://admin.da.live/source/msagolj/ew${request.resultPath}`, {
        schemaVersion: 1,
        jobId: request.jobId,
        kind: 'cards',
        target: request.target,
        status: 'completed',
        payload: { analysis },
      });
    }
    const h = await harness(data);
    await h.connect();
    h.app.selectProbeEnvironment('prod');
    h.app.discoveryResult = { blocks: [{ name: 'cards', files: [] }, { name: 'hero', files: [] }] };
    h.app.parseAnalysisHTML = () => ({
      children: [{}], querySelectorAll: () => [], textContent: 'Example',
    });
    return { data, h, request };
  }

  it('loads a saved result explicitly for diagnostics without write confirmation', async () => {
    const { data, h, request } = await setup();
    assert.equal(h.app.cardsConfirmed, false);
    await h.app.selectBlock('cards');
    assert.equal(data.calls.length, 0, 'Page selection must not load stale generated suggestions');
    await h.app.loadSavedCardsDraft();
    assert.equal(h.app.cardsState, 'completed');
    assert.equal(h.app.cardsRequest.jobId, request.jobId);
    assert.equal(h.app.selectedAnalysis().examples[0].name, 'Text cards');
    assert.equal(h.app.cardsConfirmed, false);
    assert.deepEqual(data.calls.map((call) => call.method), ['GET', 'GET']);
    assert.equal(data.prompts.length, 0);
  });

  it('can explicitly read old diagnostic data after a fresh instance without starting another job', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    await h.app.loadSavedCardsDraft();
    h.disconnect();
    const fresh = await harness(data);
    await fresh.connect();
    fresh.app.selectProbeEnvironment('prod');
    fresh.app.discoveryResult = { blocks: [{ name: 'cards', files: [] }] };
    fresh.app.parseAnalysisHTML = () => ({
      children: [{}], querySelectorAll: () => [], textContent: 'Example',
    });
    await fresh.app.selectBlock('cards');
    await fresh.app.loadSavedCardsDraft();
    assert.equal(fresh.app.cardsState, 'completed');
    assert.equal(fresh.app.cardsConfirmed, false);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
    assert.equal(data.prompts.length, 0);
  });

  it('shows pending rather than preparing or sending when no result exists', async () => {
    const { data, h } = await setup({ status: 'pending' });
    await h.app.selectBlock('cards');
    await h.app.loadSavedCardsDraft();
    assert.equal(h.app.cardsState, 'pending');
    assert.equal(h.app.cardsResult, null);
    assert.equal(h.app.cardsError, '');
    assert.equal(data.prompts.length, 0);
    assert.ok(data.calls.every((call) => call.method === 'GET'));
  });

  it('does not keep rereading or discard local library copy when returning to loaded Cards', async () => {
    const { data, h } = await setup();
    await h.app.selectBlock('cards');
    await h.app.loadSavedCardsDraft();
    h.app.editExample('text', 'name', 'Reviewed library name');
    await h.app.selectBlock('hero');
    const count = data.calls.length;
    await h.app.selectBlock('cards');
    assert.equal(data.calls.length, count);
    assert.equal(h.app.cardsRequest, null, 'Changing blocks clears the other block draft');
    assert.equal(h.app.libraryPresentation, null);
  });

  it('does not restore a late result after selecting a different block', async () => {
    const { data, h } = await setup();
    const original = h.app.hostActions.daFetch;
    let finishRequest;
    h.app.hostActions.daFetch = (url, init) => (
      url.endsWith('/request.json')
        ? new Promise((resolve) => { finishRequest = () => original(url, init).then(resolve); })
        : original(url, init)
    );
    await h.app.selectBlock('cards');
    const pending = h.app.loadSavedCardsDraft();
    await h.app.selectBlock('hero');
    finishRequest();
    await pending;
    assert.equal(h.app.selectedBlock, 'hero');
    assert.equal(h.app.cardsResult, null);
    assert.equal(h.app.cardsBusy, false);
    assert.equal(data.calls.length, 1);
  });

  it('exposes read failures and retains write-specific approval for a new analysis', async () => {
    const { data, h, request } = await setup();
    data.files.set(
      `https://admin.da.live/source/msagolj/ew${request.resultPath}`,
      new Response(null, { status: 403 }),
    );
    await h.app.selectBlock('cards');
    await h.app.loadSavedCardsDraft();
    assert.equal(h.app.cardsState, 'error');
    assert.match(h.app.cardsError, /403/);
    const count = data.calls.length;
    await h.app.prepareCardsAnalysis();
    assert.match(h.app.cardsError, /Confirm/);
    assert.equal(data.calls.length, count);
    assert.equal(data.prompts.length, 0);
  });

  it('keeps environment identity gates for read-only saved-data loading', async () => {
    const { data, h } = await setup();
    h.app.hostContext.daOrigin = 'https://stage-admin.da.live';
    await h.app.selectBlock('cards');
    await h.app.loadSavedCardsDraft();
    assert.equal(data.calls.length, 0);
    assert.match(h.app.cardsError, /origin|environment|Production/i);
  });
});

describe('app connection regressions', () => {
  it('keeps standalone opening read-only and handles an unavailable SDK', async () => {
    const direct = await harness(fixtures(), { embedded: false });
    assert.equal(direct.app.connectionState, 'unavailable');
    assert.match(direct.app.probeBlockReason, /editor/i);
    const failed = await harness(fixtures(), { sdkFails: true });
    assert.equal(failed.app.connectionState, 'error');
  });

  describe('Read-only library dry-run app flow', () => {
    const configURL = 'https://admin.da.live/config/msagolj/ew';
    const indexURL = 'https://admin.da.live/source/msagolj/ew/docs/library/blocks.json';
    function configure(data, app) {
      app.selectProbeEnvironment('prod');
      app.cardsConfirmed = true;
      app.cardsRequest = cards.createCardsRequest({
        environment: 'prod',
        input: {
          prompt: 'Saved prompt.',
          sourcePage: '/index.html',
          sources: cards.CARDS_SOURCE_PATHS.map((id) => ({ id, content: 'Source.' })),
          images: [{ src: 'https://content.da.live/msagolj/ew/.index/image.jpg', alt: '' }],
          links: [{ href: '/index', label: 'Home' }],
        },
      });
      const analysis = {
        blockName: 'cards',
        analysisScope: {},
        structure: {},
        contentRules: {},
        derivedBehavior: {},
        sharedBehavior: {},
        warnings: [],
        unknowns: [],
        optionAnalysis: { status: 'none-found', supportedOptions: [] },
        examples: [{
          id: 'text',
          name: 'Text',
          description: 'Text-only cards.',
          options: [],
          body: [['<p>Example</p>']],
          evidence: [cards.CARDS_SOURCE_PATHS[0]],
          assumptions: [],
        }],
      };
      app.cardsResult = { status: 'completed', payload: { analysis } };
      app.cardsState = 'completed';
      app.libraryDraft = JSON.stringify(analysis);
      app.parseAnalysisHTML = () => {
        const p = {
          nodeType: 1,
          tagName: 'P',
          attributes: [],
          childNodes: [{ nodeType: 3, textContent: 'Example' }],
        };
        return { children: [p], childNodes: [p], querySelectorAll: () => [p] };
      };
      data.files.set(configURL, {
        library: { data: [{ title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json' }] },
      });
      data.files.set(indexURL, {
        ':type': 'sheet',
        total: 1,
        limit: 1,
        offset: 0,
        ':colWidths': [142, 652],
        data: [{ name: 'Columns', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/columns' }],
      });
    }

    it('requires review confirmation and valid draft JSON before any reads', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      await h.app.generateLibraryDryRun();
      assert.match(h.app.libraryError, /review/i);
      assert.equal(data.calls.length, 0);
      h.app.libraryReviewConfirmed = true;
      h.app.libraryDraft = '{invalid';
      await h.app.generateLibraryDryRun();
      assert.match(h.app.libraryError, /JSON/);
      assert.equal(data.calls.length, 0);
    });

    it('shows exact proposed changes with GET only and never changes the raw result', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      const raw = JSON.stringify(h.app.cardsResult);
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.libraryPreview.writesPerformed, 0);
      assert.equal(h.app.libraryPreview.operations[1].after.data.length, 2);
      assert.equal(JSON.stringify(h.app.cardsResult), raw);
      assert.equal(data.calls.length, 3);
      assert.ok(data.calls.every(({ method }) => method === 'GET'));
    });

    it('builds a proposal from only the selected reviewed examples', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      const analysis = JSON.parse(h.app.libraryDraft);
      analysis.examples.push({ ...analysis.examples[0], id: 'second', name: 'Second' });
      h.app.libraryDraft = JSON.stringify(analysis);
      h.app.editExample('second', 'name', 'Second');
      h.app.selectedExampleIds = ['second'];
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      assert.equal(h.app.libraryError, '');
      const page = h.app.libraryPreview.operations[0].content;
      assert.match(page, /<h2>Second<\/h2>/);
      assert.doesNotMatch(page, /<h2>Text<\/h2>/);
      assert.equal(analysis.examples.length, 2);
      assert.ok(data.calls.every(({ method }) => method === 'GET'));
    });

    it('invalidates the old preview and approval when the draft changes', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      const raw = JSON.stringify(h.app.cardsResult);
      h.app.changeLibraryDraft(h.app.libraryDraft.replace('Text-only cards.', 'Reviewed description.'));
      assert.equal(h.app.libraryPreview, null);
      assert.equal(h.app.libraryReviewConfirmed, false);
      assert.equal(JSON.stringify(h.app.cardsResult), raw);
    });

    function enableCreation(data, app, failIndex = false) {
      const pageURL = 'https://admin.da.live/source/msagolj/ew/docs/library/blocks/cards.html';
      const state = { page: null, index: data.files.get(indexURL) };
      app.hostActions.daFetch = async (url, options) => {
        data.calls.push({ url, method: options.method });
        if (url.startsWith('https://admin.hlx.page/preview/')
          || url.startsWith('https://admin.hlx.page/status/')) {
          return Response.json({ preview: { status: 200 } });
        }
        if (options.method === 'GET') {
          if (url === pageURL) {
            return state.page === null ? new Response(null, { status: 404 })
              : new Response(state.page, { headers: { 'Content-Type': 'text/html' } });
          }
          const value = url === indexURL ? state.index : data.files.get(url);
          if (value === undefined) return new Response(null, { status: 404 });
          return new Response(JSON.stringify(value), {
            headers: { 'Content-Type': 'application/json', ETag: '"v1"' },
          });
        }
        if (options.method === 'DELETE') {
          assert.ok(url.includes('/.da/block-library-generator/jobs/'));
          data.files.delete(url);
          return new Response(null, { status: 204 });
        }
        assert.equal(options.method, 'PUT');
        const content = await options.body.get('data').text();
        if (url === pageURL) {
          assert.equal(options.headers['If-None-Match'], '*');
          state.page = content;
        } else {
          assert.equal(options.headers['If-Match'], '"v1"');
          if (failIndex) return new Response(null, { status: 412 });
          state.index = JSON.parse(content);
        }
        return new Response(null, { status: 201 });
      };
      return state;
    }

    async function starterFixture({
      inferred = true, failIndex = false, mode = 'create',
    } = {}) {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      const input = {
        ...h.app.cardsRequest.input,
        blockName: 'cards',
        entryPaths: cards.CARDS_SOURCE_PATHS.slice(0, 2),
      };
      const request = blockAnalysis.createAnalysisRequest({ environment: 'prod', input });
      const analysis = {
        ...JSON.parse(h.app.libraryDraft),
        generation: {
          status: 'blocked',
          reason: 'Provide a real content-fragment path.',
          ...(inferred ? {
            starter: {
              body: [['Content Fragment path - replace with a real value'], ['Variation (optional)']],
              evidence: [cards.CARDS_SOURCE_PATHS[0]],
            },
          } : {}),
        },
        examples: [],
      };
      const result = {
        schemaVersion: 1,
        jobId: request.jobId,
        kind: request.kind,
        target: request.target,
        status: 'completed',
        payload: { analysis },
      };
      const root = 'https://admin.da.live/source/msagolj/ew';
      data.files.set(`${root}${request.requestPath}`, request);
      data.files.set(`${root}${request.resultPath}`, result);
      jobs.saveJobPointer(data.storage, request, true);
      h.app.cardsRequest = request;
      h.app.cardsResult = result;
      h.app.cardsState = 'completed';
      h.app.libraryDraft = JSON.stringify(analysis);
      h.app.selectedBlock = 'cards';
      h.app.discoveryResult = {
        complete: true,
        blocks: [{ name: 'cards', files: cards.CARDS_SOURCE_PATHS.slice(0, 2).map((path) => ({ path })) }],
      };
      h.app.libraryOverview = { blocks: { cards: { status: 'absent' } } };
      h.app.savePageFlow({
        mode: 'create',
        name: 'cards',
        status: 'blocked',
        environment: 'prod',
        startedAt: request.createdAt,
        jobId: request.jobId,
        jobKind: request.kind,
        error: analysis.generation.reason,
      });
      const state = enableCreation(data, h.app, failIndex);
      if (mode === 'recreate') {
        const pageURL = `${root}/docs/library/blocks/cards.html`;
        state.page = '<body>Existing author content</body>';
        state.pageETag = '"page1"';
        state.index.data.push({
          name: 'Cards', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/cards',
        });
        state.index.total = 2;
        state.index.limit = 2;
        h.app.libraryOverview.blocks.cards = { status: 'existing', pagePath: '/docs/library/blocks/cards.html' };
        const fetcher = h.app.hostActions.daFetch;
        h.app.hostActions.daFetch = async (url, options) => {
          if (url === pageURL && options.method === 'GET') {
            data.calls.push({ url, method: 'GET' });
            return new Response(state.page, {
              headers: { 'Content-Type': 'text/html', ETag: state.pageETag },
            });
          }
          if (url === pageURL && options.method === 'PUT') {
            data.calls.push({ url, method: 'PUT' });
            assert.equal(options.headers['If-Match'], state.pageETag);
            state.page = await options.body.get('data').text();
            state.pageETag = '"page-updated"';
            return new Response(null, { status: 200 });
          }
          return fetcher(url, options);
        };
        const snapshot = await lifecycle.prepareLibraryAction({
          daFetch: h.app.hostActions.daFetch,
          target: h.app.probeTarget,
          name: 'cards',
          pagePath: '/docs/library/blocks/cards.html',
        });
        h.app.savePageFlow({ ...h.app.pageFlow, mode, snapshot });
      }
      return {
        data, h, state, request, result, root,
      };
    }

    it('keeps starter confirmation compact and leaves inferred cells on the saved page, not in the dialog', async () => {
      const { data, h, state } = await starterFixture();
      assert.match(JSON.stringify(h.app.renderPageAction()), /Create a default example page/);
      await h.app.prepareDefaultExample();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.pageFlow.status, 'ready');
      assert.equal(h.app.pageFlow.starter, true);
      const review = JSON.stringify(h.app.renderPageAction());
      assert.match(review, /not a working example/);
      assert.match(review, /Open the saved page in DA/);
      assert.match(review, /Confirm create starter page/);
      assert.doesNotMatch(review, /Examples are ready|Confirm create page|output-row|output-cell|Content Fragment path|Variation/);
      assert.equal(state.page, null);
      assert.ok(data.calls.every((call) => call.method === 'GET'));
      assert.equal(data.prompts.length, 0);
      h.app.backToBlockedAnalysis();
      assert.equal(h.app.pageFlow.status, 'blocked');
      assert.equal(h.app.pageFlow.starter, false);
      assert.equal(state.page, null);
      h.app.pageFlow = { ...h.app.pageFlow, mode: 'delete' };
      assert.doesNotMatch(JSON.stringify(h.app.renderPageAction()), /Replace with a default example page/);
      await h.app.prepareDefaultExample();
      assert.match(h.app.libraryError, /existing page|blocked.*analysis/);
    });

    it('restores a starter review and creates one labelled page with Preview while retaining the blocked job', async () => {
      const {
        data, h, state, request, result, root,
      } = await starterFixture();
      const raw = JSON.stringify(result);
      await h.app.prepareDefaultExample();
      h.disconnect();
      const reopened = await harness(data);
      await reopened.connect();
      reopened.app.hostActions.daFetch = h.app.hostActions.daFetch;
      reopened.app.discoveryResult = h.app.discoveryResult;
      reopened.app.libraryOverview = { blocks: { cards: { status: 'absent' } } };
      await reopened.app.selectBlock('cards');
      assert.equal(reopened.app.libraryError, '');
      assert.equal(reopened.app.pageFlow.starter, true);
      assert.equal(reopened.app.pageFlow.status, 'ready');
      assert.doesNotMatch(JSON.stringify(reopened.app.renderPageAction()), /Content Fragment path|output-cell/);
      assert.equal(state.page, null);
      assert.ok(data.calls.every((call) => call.method === 'GET'));
      await reopened.app.commitPageAction();
      assert.equal(reopened.app.libraryError, '');
      assert.equal(reopened.app.pageFlow, null);
      assert.equal(reopened.app.libraryCreationReceipt.status, 'completed');
      assert.equal(reopened.app.libraryCreationReceipt.starter, true);
      assert.match(reopened.app.notice, /starter page created/);
      assert.match(state.page, /Content Fragment path/);
      assert.match(state.page, /not a working example/);
      assert.equal((state.page.match(/class="cards"/g) || []).length, 1);
      assert.equal(reopened.app.libraryPreviewReceipts.length, 2);
      assert.ok(reopened.app.libraryPreviewReceipts.every((receipt) => receipt.status === 'completed'));
      assert.equal(JSON.stringify(result), raw);
      assert.ok(data.files.has(`${root}${request.requestPath}`));
      assert.ok(data.files.has(`${root}${request.resultPath}`));
      assert.equal(jobs.loadJobPointer(data.storage, request.target, 'analysis', 'cards').jobId, request.jobId);
      assert.ok(!data.calls.some((call) => call.method === 'DELETE'));
      assert.equal(reopened.app.jobCleanupReceipt, null);
      assert.equal(state.index.data[0].name, 'Columns');
      assert.ok(state.index.data.some((row) => row.name === 'Cards'));
    });

    it('offers a blocked Recreate starter replacement with a fresh snapshot and separate final consent', async () => {
      const { data, h, state } = await starterFixture({ mode: 'recreate' });
      state.page = '<body>Updated since the analysis began</body>';
      state.pageETag = '"page2"';
      assert.match(JSON.stringify(h.app.renderPageAction()), /Replace with a default example page/);
      await h.app.prepareDefaultExample();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.pageFlow.status, 'ready');
      assert.equal(h.app.pageFlow.mode, 'recreate');
      assert.equal(h.app.pageFlow.starter, true);
      assert.equal(h.app.pageFlow.snapshot.pageETag, '"page2"');
      const confirmation = JSON.stringify(h.app.renderPageAction());
      assert.match(confirmation, /Confirm replace with starter page/);
      assert.match(confirmation, /replaces the whole page, including later author edits/i);
      assert.match(confirmation, /not a working example/);
      assert.doesNotMatch(confirmation, /Content Fragment path|Variation|output-cell|Fresh output is ready|Confirm replace entire page/);
      assert.ok(data.calls.every((call) => call.method === 'GET'));
      assert.equal(state.page, '<body>Updated since the analysis began</body>');
      assert.equal(data.prompts.length, 0);
      h.app.backToBlockedAnalysis();
      assert.equal(h.app.pageFlow.status, 'blocked');
      assert.equal(h.app.pageFlow.starter, false);
      assert.equal(state.page, '<body>Updated since the analysis began</body>');
    });

    it('offers explicit replacement when an existing page is found for an older blocked Create action', async () => {
      const {
        data, h, state, request, result, root,
      } = await starterFixture({ mode: 'recreate', inferred: false });
      h.app.savePageFlow({ ...h.app.pageFlow, mode: 'create', snapshot: null });
      const view = JSON.stringify(h.app.renderPageAction());
      assert.match(view, /Replace with a default example page/);
      assert.match(view, /existing library page was not changed/);
      assert.doesNotMatch(view, />Create a default example page/);
      await h.app.prepareDefaultExample();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.pageFlow.mode, 'recreate');
      assert.equal(h.app.pageFlow.status, 'ready');
      assert.equal(h.app.pageFlow.snapshot.pageETag, '"page1"');
      assert.equal(state.page, '<body>Existing author content</body>');
      assert.ok(data.calls.every((call) => call.method === 'GET'));
      assert.match(JSON.stringify(h.app.renderPageAction()), /Confirm replace with starter page/);
      await h.app.commitPageAction();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.pageFlow, null);
      assert.match(state.page, /one empty cell/);
      assert.equal(result.payload.analysis.generation.status, 'blocked');
      assert.ok(data.files.has(`${root}${request.requestPath}`));
      assert.ok(data.files.has(`${root}${request.resultPath}`));
      assert.ok(!data.calls.some((call) => call.method === 'DELETE'));
    });

    it('restarts stale blocked Create as Recreate only after rechecking the existing page', async () => {
      const { data, h, state } = await starterFixture({ mode: 'recreate' });
      h.app.savePageFlow({ ...h.app.pageFlow, mode: 'create', snapshot: null });
      await h.app.retryPageGeneration();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.pageFlow.mode, 'recreate');
      assert.equal(h.app.pageFlow.status, 'confirm');
      assert.equal(h.app.pageFlow.snapshot.pageETag, '"page1"');
      assert.equal(h.app.pageFlow.jobId, undefined);
      assert.equal(state.page, '<body>Existing author content</body>');
      assert.ok(data.calls.every((call) => call.method === 'GET'));
      assert.equal(data.prompts.length, 0);
    });

    it('does not convert a stale blocked Create into replacement when current page status is unknown or denied', async () => {
      await Promise.all(['unknown', 'denied'].map(async (scenario) => {
        const { data, h, state } = await starterFixture({ mode: 'recreate' });
        h.app.savePageFlow({ ...h.app.pageFlow, mode: 'create', snapshot: null });
        if (scenario === 'unknown') delete h.app.libraryOverview.blocks.cards;
        else {
          const fetcher = h.app.hostActions.daFetch;
          h.app.hostActions.daFetch = async (url, options) => (
            url.endsWith('/cards.html') ? new Response(null, { status: 403 }) : fetcher(url, options)
          );
        }
        await h.app.prepareDefaultExample();
        assert.ok(h.app.libraryError);
        assert.equal(h.app.pageFlow.status, 'blocked');
        assert.equal(h.app.pageFlow.mode, 'create');
        assert.equal(state.page, '<body>Existing author content</body>');
        assert.ok(data.calls.every((call) => call.method === 'GET'));
      }));
    });

    it('restores and replaces an existing page with one labelled starter while retaining its blocked job', async () => {
      const {
        data, h, state, request, result, root,
      } = await starterFixture({ mode: 'recreate' });
      const before = JSON.stringify(result);
      const indexBefore = JSON.stringify(state.index);
      await h.app.prepareDefaultExample();
      const overviewBefore = h.app.libraryOverview;
      h.disconnect();
      const reopened = await harness(data);
      await reopened.connect();
      reopened.app.hostActions.daFetch = h.app.hostActions.daFetch;
      reopened.app.discoveryResult = h.app.discoveryResult;
      reopened.app.libraryOverview = overviewBefore;
      await reopened.app.selectBlock('cards');
      assert.equal(reopened.app.pageFlow.status, 'ready');
      assert.equal(reopened.app.pageFlow.starter, true);
      assert.match(JSON.stringify(reopened.app.renderPageAction()), /Confirm replace with starter page/);
      assert.ok(data.calls.every((call) => call.method === 'GET'));
      const fetcher = reopened.app.hostActions.daFetch;
      reopened.app.hostActions.daFetch = async (url, options) => {
        if (url.includes('/preview/')) {
          assert.equal(reopened.app.pageFlow.status, 'completed', 'Persist source success before Preview');
          assert.equal(reopened.app.pageFlow.receipt.starter, true);
        }
        return fetcher(url, options);
      };
      await reopened.app.commitPageAction();
      assert.equal(reopened.app.libraryError, '');
      assert.equal(reopened.app.pageFlow, null);
      assert.match(reopened.app.notice, /replaced with a starter/);
      assert.match(state.page, /Content Fragment path|Variation/);
      assert.match(state.page, /not a working example/);
      assert.equal((state.page.match(/class="cards"/g) || []).length, 1);
      assert.equal(JSON.stringify(state.index), indexBefore);
      assert.equal(reopened.app.libraryPreviewReceipts.length, 2);
      assert.ok(reopened.app.libraryPreviewReceipts.every((receipt) => receipt.status === 'completed'));
      assert.equal(JSON.stringify(result), before);
      assert.ok(data.files.has(`${root}${request.requestPath}`));
      assert.ok(data.files.has(`${root}${request.resultPath}`));
      assert.equal(jobs.loadJobPointer(data.storage, request.target, 'analysis', 'cards').jobId, request.jobId);
      assert.ok(!data.calls.some((call) => call.method === 'DELETE'));
    });

    it('does not replace changed content after starter consent, or advance confirmation when snapshot reads fail', async () => {
      await Promise.all(['changed', 'denied'].map(async (scenario) => {
        const { data, h, state } = await starterFixture({ mode: 'recreate' });
        if (scenario === 'denied') {
          const fetcher = h.app.hostActions.daFetch;
          h.app.hostActions.daFetch = async (url, options) => (
            url.endsWith('/cards.html') ? new Response(null, { status: 403 }) : fetcher(url, options)
          );
        }
        await h.app.prepareDefaultExample();
        if (scenario === 'changed') {
          assert.equal(h.app.pageFlow.status, 'ready');
          state.page = '<body>New author edit after confirmation was prepared</body>';
          state.pageETag = '"page3"';
          await h.app.commitPageAction();
          assert.match(h.app.libraryError, /changed/);
          assert.equal(state.page, '<body>New author edit after confirmation was prepared</body>');
        } else {
          assert.equal(h.app.pageFlow.status, 'blocked');
          assert.match(h.app.libraryError, /403/);
          assert.equal(state.page, '<body>Existing author content</body>');
        }
        assert.ok(data.calls.every((call) => call.method === 'GET'));
      }));
    });

    it('prepares an older blocked result without inferred layout and still refuses an existing-page Create', async () => {
      const { data, h, state } = await starterFixture({ inferred: false });
      await h.app.prepareDefaultExample();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.pageFlow.status, 'ready');
      assert.equal(h.app.pageFlow.starter, true);
      assert.equal(state.page, null);
      assert.ok(data.calls.every((call) => call.method === 'GET'));
      const fresh = await starterFixture();
      await fresh.h.app.prepareDefaultExample();
      fresh.state.page = '<body>Someone else created this page</body>';
      await fresh.h.app.commitPageAction();
      assert.match(fresh.h.app.libraryError, /already exists/);
      assert.equal(fresh.state.page, '<body>Someone else created this page</body>');
      assert.ok(fresh.data.calls.every((call) => call.method === 'GET'));
    });

    it('restores and saves one empty cell when a blocked Create or Recreate has no inferred layout', async () => {
      await Promise.all(['create', 'recreate'].map(async (mode) => {
        const {
          data, h, state, request, result, root,
        } = await starterFixture({ mode, inferred: false });
        if (mode === 'recreate') result.payload.analysis.generation.starter = null;
        const original = JSON.stringify(result);
        const overviewBefore = h.app.libraryOverview;
        await h.app.prepareDefaultExample();
        assert.equal(h.app.libraryError, '');
        assert.equal(h.app.pageFlow.status, 'ready');
        assert.ok(data.calls.every((call) => call.method === 'GET'));
        h.disconnect();
        const reopened = await harness(data);
        await reopened.connect();
        reopened.app.hostActions.daFetch = h.app.hostActions.daFetch;
        reopened.app.discoveryResult = {
          complete: true, blocks: [{ name: 'cards', files: [{ path: '/blocks/cards/cards.js' }] }],
        };
        reopened.app.libraryOverview = overviewBefore;
        await reopened.app.selectBlock('cards');
        assert.equal(reopened.app.pageFlow.status, 'ready');
        assert.equal(reopened.app.pageFlow.starter, true);
        assert.equal(reopened.app.libraryError, '');
        await reopened.app.commitPageAction();
        assert.equal(reopened.app.libraryError, '');
        assert.equal(reopened.app.pageFlow, null);
        assert.match(state.page, /<div class="cards">\s*<div>\s*<div><\/div>\s*<\/div>\s*<\/div>/);
        assert.match(state.page, /one empty cell/);
        assert.match(state.page, /not a working example/);
        assert.equal((state.page.match(/class="cards"/g) || []).length, 1);
        assert.equal(JSON.stringify(result), original);
        assert.ok(data.files.has(`${root}${request.requestPath}`));
        assert.ok(data.files.has(`${root}${request.resultPath}`));
        assert.ok(!data.calls.some((call) => call.method === 'DELETE'));
        assert.equal(data.prompts.length, 0);
        assert.equal(reopened.app.libraryPreviewReceipts.length, 2);
      }));
    });

    it('reports a partial starter save honestly and retains blocked job files if the index write fails', async () => {
      const {
        data, h, state, request, root,
      } = await starterFixture({ failIndex: true });
      await h.app.prepareDefaultExample();
      await h.app.commitPageAction();
      assert.match(h.app.libraryError, /412/);
      assert.equal(h.app.pageFlow.status, 'partial');
      assert.equal(h.app.libraryCreationReceipt.starter, true);
      assert.match(JSON.stringify(h.app.renderPageAction()), /may have been saved/);
      assert.ok(state.page.includes('not a working example'));
      assert.ok(!state.index.data.some((row) => row.name === 'Cards'));
      assert.ok(data.files.has(`${root}${request.requestPath}`));
      assert.ok(data.files.has(`${root}${request.resultPath}`));
      assert.ok(data.calls.every((call) => !['POST', 'DELETE'].includes(call.method)));
    });

    it('cleans a verified new Create job but never turns cleanup failure into a failed page action', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      const state = enableCreation(data, h.app);
      const request = h.app.cardsRequest;
      const root = 'https://admin.da.live/source/msagolj/ew';
      data.files.set(`${root}${request.requestPath}`, request);
      data.files.set(`${root}${request.resultPath}`, {
        schemaVersion: 1,
        jobId: request.jobId,
        kind: request.kind,
        target: request.target,
        status: 'completed',
        payload: { analysis: JSON.parse(h.app.libraryDraft) },
      });
      jobs.saveJobPointer(data.storage, request, true);
      h.app.cardsSaved = { jobId: request.jobId, kind: 'cards', handoffRequested: true };
      h.app.selectedBlock = 'cards';
      h.app.discoveryResult = {
        complete: true, blocks: [{ name: 'cards', files: [] }],
      };
      h.app.libraryOverview = { blocks: { cards: { status: 'absent' } } };
      h.app.savePageFlow({
        mode: 'create',
        name: 'cards',
        status: 'ready',
        environment: 'prod',
        startedAt: request.createdAt,
        jobId: request.jobId,
        jobKind: request.kind,
      });
      const fetcher = h.app.hostActions.daFetch;
      h.app.hostActions.daFetch = async (url, options) => {
        if (url.startsWith('https://admin.hlx.page/preview/')) {
          assert.equal(h.app.libraryCreationReceipt.status, 'completed');
          assert.equal(h.app.pageFlow.status, 'completed');
        }
        if (options.method === 'DELETE') {
          assert.equal(h.app.libraryCreationReceipt.status, 'completed');
          assert.equal(h.app.pageFlow.status, 'completed');
          assert.ok(state.page);
          assert.ok(state.index.data.some((row) => row.name === 'Cards'));
          data.calls.push({ url, method: 'DELETE' });
          return new Response(null, { status: 403 });
        }
        return fetcher(url, options);
      };
      await h.app.commitPageAction();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.libraryCreationReceipt.status, 'completed');
      assert.equal(h.app.pageFlow, null);
      assert.match(h.app.notice, /created/);
      assert.equal(h.app.jobCleanupReceipt.status, 'failed');
      assert.match(h.app.jobCleanupError, /403/);
      assert.match(JSON.stringify(h.app.renderJobCleanupWarning()), /page was saved|page is saved/);
      assert.ok(jobs.loadJobPointer(data.storage, request.target, 'cards'));
      assert.ok(data.files.has(`${root}${request.requestPath}`));
      assert.equal(h.app.libraryPreviewReceipts.length, 2);
      assert.ok(h.app.libraryPreviewReceipts.every((receipt) => receipt.status === 'completed'));
      const firstPreview = data.calls.findIndex((call) => call.url.includes('/preview/'));
      const firstCleanup = data.calls.findIndex((call) => call.method === 'DELETE');
      assert.ok(firstPreview >= 0 && firstCleanup > firstPreview);
      const reopened = await harness(data);
      await reopened.connect();
      assert.match(reopened.app.jobCleanupError, /403/);
      assert.equal(reopened.app.pageFlow, null);
    });

    it('retains a saved Create and cleans its job when Preview is denied, without retrying on read-only checks', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      const state = enableCreation(data, h.app);
      const request = h.app.cardsRequest;
      const root = 'https://admin.da.live/source/msagolj/ew';
      data.files.set(`${root}${request.requestPath}`, request);
      data.files.set(`${root}${request.resultPath}`, {
        schemaVersion: 1,
        jobId: request.jobId,
        kind: request.kind,
        target: request.target,
        status: 'completed',
        payload: { analysis: JSON.parse(h.app.libraryDraft) },
      });
      const fetcher = h.app.hostActions.daFetch;
      h.app.hostActions.daFetch = async (url, options) => {
        if (url.startsWith('https://admin.hlx.page/preview/')) {
          assert.equal(h.app.libraryCreationReceipt.status, 'completed');
          assert.ok(state.page);
          data.calls.push({ url, method: options.method });
          return new Response(null, { status: 403 });
        }
        return fetcher(url, options);
      };
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      h.app.libraryCreationConfirmed = true;
      await h.app.createApprovedLibrary();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.libraryCreationReceipt.status, 'completed');
      assert.equal(h.app.jobCleanupReceipt.status, 'completed');
      assert.equal(h.app.libraryPreviewReceipts.length, 2);
      assert.ok(h.app.libraryPreviewReceipts.every((receipt) => receipt.status === 'failed'));
      assert.match(JSON.stringify(h.app.renderLibraryPreviewWarning()), /DA changes were saved|403/);
      const previews = data.calls.filter((call) => call.url.includes('/preview/')).length;
      await h.app.runCreationOperation(true);
      assert.equal(h.app.libraryError, '');
      assert.equal(data.calls.filter((call) => call.url.includes('/preview/')).length, previews);
      assert.ok(state.page);
    });

    it('requires separate creation approval even after approving the dry run', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      const count = data.calls.length;
      await h.app.createApprovedLibrary();
      assert.match(h.app.libraryError, /Approve/);
      assert.equal(data.calls.length, count);
    });

    it('allows a read-only proposal without scratch-write consent but still blocks unapproved creation', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      h.app.cardsConfirmed = false;
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.libraryPreview.mode, 'dry-run');
      assert.ok(data.calls.every(({ method }) => method === 'GET'));
      const count = data.calls.length;
      await h.app.createApprovedLibrary();
      assert.match(h.app.libraryError, /Approve/);
      assert.equal(data.calls.length, count);
    });

    it('creates with conditional writes and restores a receipt for read-only checking after reopen', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      const state = enableCreation(data, h.app);
      const request = h.app.cardsRequest;
      const root = 'https://admin.da.live/source/msagolj/ew';
      data.files.set(`${root}${request.requestPath}`, request);
      data.files.set(`${root}${request.resultPath}`, {
        schemaVersion: 1,
        jobId: request.jobId,
        kind: request.kind,
        target: request.target,
        status: 'completed',
        payload: { analysis: JSON.parse(h.app.libraryDraft) },
      });
      jobs.saveJobPointer(data.storage, request, true);
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      h.app.libraryCreationConfirmed = true;
      await h.app.createApprovedLibrary();
      assert.equal(h.app.libraryError, '');
      assert.equal(h.app.libraryCreationReceipt.status, 'completed');
      assert.equal(h.app.libraryPreview, null);
      assert.equal(h.app.libraryCreationConfirmed, false);
      assert.equal(h.app.jobCleanupReceipt.status, 'completed');
      assert.equal(h.app.cardsRequest, null);
      assert.equal(jobs.loadJobPointer(data.storage, request.target, 'cards'), null);
      assert.ok(state.page);
      assert.ok(state.index.data.some((row) => row.name === 'Cards'));
      assert.deepEqual(data.calls.filter((call) => call.method === 'DELETE').map((call) => call.url), [
        `${root}${request.resultPath}`, `${root}${request.requestPath}`,
      ]);
      const fetcher = h.app.hostActions.daFetch;
      h.disconnect();
      const reopened = await harness(data);
      await reopened.connect();
      reopened.app.selectProbeEnvironment('prod');
      reopened.app.cardsConfirmed = true;
      reopened.app.hostActions.daFetch = fetcher;
      assert.equal(reopened.app.libraryCreationReceipt.status, 'completed');
      const count = data.calls.length;
      await reopened.app.verifyLibraryCreation();
      assert.equal(reopened.app.libraryCreationReceipt.status, 'completed');
      assert.ok(data.calls.slice(count).every(({ method }) => method === 'GET'));
    });

    it('retains partial creation diagnostics and never automatically retries the index', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      const state = enableCreation(data, h.app, true);
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      h.app.libraryCreationConfirmed = true;
      await h.app.createApprovedLibrary();
      assert.match(h.app.libraryError, /412/);
      assert.ok(state.page);
      assert.equal(state.index.data.length, 1);
      assert.equal(h.app.libraryCreationReceipt.status, 'partial');
      assert.equal(creation.loadCreationReceipt(data.storage, 'prod').page, 'verified');
      assert.equal(data.calls.filter(({ method }) => method === 'PUT').length, 2);
      assert.equal(data.calls.filter(({ method }) => method === 'DELETE').length, 0);
      assert.equal(h.app.jobCleanupReceipt, null);
    });

    it('blocks target/ref changes while a creation operation is active', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      h.app.libraryCreating = true;
      h.app.selectProbeEnvironment('stage');
      h.app.changeDiscoveryInput('ref', 'other');
      assert.equal(h.app.probeEnvironment, 'prod');
      assert.equal(h.app.discoveryRef, 'main');
      assert.match(h.app.libraryError, /Wait/);
      assert.match(h.app.discoveryError, /Wait/);
    });

    it('reports an existing Cards page as a conflict, not a proposed overwrite', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      data.files.set('https://admin.da.live/source/msagolj/ew/docs/library/blocks/cards.html', {});
      h.app.libraryReviewConfirmed = true;
      await h.app.generateLibraryDryRun();
      assert.equal(h.app.libraryPreview, null);
      assert.match(h.app.libraryError, /already exists/i);
      assert.ok(data.calls.every(({ method }) => method === 'GET'));
    });

    it('discards in-flight proposals when the environment changes', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      let resolveConfig;
      h.app.hostActions.daFetch = () => new Promise((resolve) => { resolveConfig = resolve; });
      h.app.libraryReviewConfirmed = true;
      const pending = h.app.generateLibraryDryRun();
      h.app.selectProbeEnvironment('stage');
      resolveConfig(new Response(JSON.stringify(data.files.get(configURL)), {
        headers: { 'Content-Type': 'application/json' },
      }));
      await pending;
      assert.equal(h.app.libraryPreview, null);
      assert.equal(h.app.libraryReviewConfirmed, false);
      assert.equal(h.app.libraryDraft, '');
      assert.equal(h.app.libraryError, '');
    });
  });

  describe('Cards analysis app flow with mocked sources and HTML elements', () => {
    const image = 'https://content.da.live/msagolj/ew/.index/example.jpg';
    function configure(data, app) {
      app.selectProbeEnvironment('prod');
      app.discoveryResult = {
        complete: true,
        provider: 'code-bus',
        diagnostics: [],
        blocks: [{ name: 'cards', files: cards.CARDS_SOURCE_PATHS.slice(0, 2).map((path) => ({ path })) }],
      };
      const origin = 'https://main--ew--msagolj.preview.da.live';
      cards.CARDS_SOURCE_PATHS.forEach((path) => data.files.set(`${origin}${path}`, new Response('Source content.', { headers: { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/css' } })));
      data.files.set('https://admin.da.live/source/msagolj/ew/index.html', new Response('<body><main><img></main></body>', { headers: { 'Content-Type': 'text/html' } }));
      data.fetchPublic = async (url, options) => {
        data.publicCalls.push({ url, options });
        return new Response('Saved prompt unchanged.', { headers: { 'Content-Type': 'text/plain' } });
      };
      app.parseAnalysisHTML = () => ({
        children: [{}],
        querySelectorAll: (selector) => (selector === 'img[src]' ? [{
          getAttribute: (name) => (name === 'src' ? image : ''),
        }] : [{ tagName: 'P', attributes: [] }]),
      });
    }

    it('requires Cards-specific confirmation before source reads or writes', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      h.app.selectProbeEnvironment('prod');
      h.app.probeConfirmed = true;
      await h.app.prepareCardsAnalysis();
      assert.match(h.app.cardsError, /Confirm/);
      assert.equal(data.calls.length, 0);
      assert.equal(data.publicCalls.length, 0);
    });

    it('prepares real source snapshots and keeps probe/Cards resume pointers separate', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      h.app.selectProbeEnvironment('prod');
      h.app.cardsConfirmed = true;
      await h.app.prepareCardsAnalysis();
      assert.equal(h.app.cardsState, 'prepared');
      assert.equal(h.app.cardsRequest.kind, 'analysis');
      assert.equal(h.app.cardsRequest.input.sources.length, 4);
      assert.equal(h.app.cardsRequest.input.sourcePage, null);
      const expectedImages = placeholderImages.PLACEHOLDER_IMAGES.map((asset) => ({
        src: `https://content.da.live/msagolj/ew/docs/library/media/block-library-generator/${asset.file}`,
        alt: asset.alt,
      }));
      assert.deepEqual(h.app.cardsRequest.input.images, expectedImages);
      assert.equal(h.app.cardsRequest.input.links[0].href, '/index');
      assert.equal(jobs.loadProbePointer(data.storage, 'prod'), null);
      assert.equal(jobs.loadJobPointer(data.storage, 'prod', 'analysis', 'cards').jobId, h.app.cardsRequest.jobId);
      assert.equal(data.calls.filter(({ method }) => method === 'PUT').length, 4);
      assert.equal(data.prompts.length, 0);
    });

    it('always prepares placeholders without reading the launch document, even when it could supply images', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      h.app.context = { ...h.app.context, path: '/not-readable-from-launch' };
      h.app.cardsConfirmed = true;
      h.app.parseAnalysisHTML = () => { throw new Error('Document images must not be collected'); };
      await h.app.prepareCardsAnalysis();
      assert.equal(h.app.cardsError, '');
      assert.equal(h.app.cardsState, 'prepared');
      assert.equal(h.app.cardsRequest.input.sourcePage, null);
      assert.equal(h.app.cardsRequest.input.images.length, 3);
      assert.ok(h.app.cardsRequest.input.images.every((asset) => asset.src.includes('/docs/library/media/block-library-generator/')));
      assert.ok(h.app.cardsRequest.input.images.every((asset) => asset.src !== image));
      assert.ok(data.calls.every((call) => !call.url.includes('not-readable-from-launch')));
      const originalAssets = h.app.cardsRequest.input.images;
      h.app.cardsNewConfirmed = true;
      await h.app.prepareCardsAnalysis();
      assert.equal(h.app.cardsError, '');
      assert.deepEqual(h.app.cardsRequest.input.images, originalAssets);
      assert.equal(data.calls.filter((call) => call.method === 'PUT'
        && call.url.includes('/docs/library/media/')).length, 3);
      assert.equal(data.prompts.length, 0);
    });

    it('hands off, reopens, resumes and validates a Cards result without resending', async () => {
      const data = fixtures();
      const first = await harness(data);
      await first.connect();
      configure(data, first.app);
      first.app.selectProbeEnvironment('prod');
      first.app.cardsConfirmed = true;
      await first.app.prepareCardsAnalysis();
      const request = first.app.cardsRequest;
      first.app.sendCardsAnalysis();
      assert.equal(data.prompts[0].options.autoSend, false);
      assert.equal(data.closed.length, 1);
      first.disconnect();
      const reopened = await harness(data);
      await reopened.connect();
      configure(data, reopened.app);
      reopened.app.selectProbeEnvironment('prod');
      assert.equal(reopened.app.cardsSaved.jobId, request.jobId);
      reopened.app.cardsConfirmed = true;
      await reopened.app.resumeCardsAnalysis();
      reopened.app.sendCardsAnalysis();
      assert.match(reopened.app.cardsError, /already requested/i);
      assert.equal(data.prompts.length, 1);
      await reopened.app.checkCardsAnalysis();
      assert.equal(reopened.app.cardsState, 'pending');
      data.files.set(`https://admin.da.live/source/msagolj/ew${request.resultPath}`, {
        schemaVersion: 1,
        jobId: request.jobId,
        kind: request.kind,
        target: request.target,
        status: 'completed',
        payload: {
          analysis: {
            blockName: 'cards',
            generation: { status: 'ready', reason: '' },
            analysisScope: {},
            optionAnalysis: { status: 'none-found', supportedOptions: [] },
            structure: {},
            contentRules: [],
            derivedBehavior: {},
            sharedBehavior: {},
            warnings: [],
            unknowns: [],
            examples: [{
              id: 'text-only',
              name: 'Text cards',
              description: 'Rich text.',
              options: [],
              body: [['<p>Example</p>']],
              evidence: [cards.CARDS_SOURCE_PATHS[0]],
              assumptions: [],
            }],
          },
        },
      });
      await reopened.app.checkCardsAnalysis();
      assert.equal(reopened.app.cardsState, 'completed');
      assert.equal(data.prompts.length, 1);
      assert.equal(data.calls.filter(({ method }) => method === 'PUT').length, 4);
    });

    it('does not dispatch or write a job after a required source failure', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      data.files.delete('https://main--ew--msagolj.preview.da.live/blocks/cards/cards.js');
      h.app.selectProbeEnvironment('prod');
      h.app.cardsConfirmed = true;
      await h.app.prepareCardsAnalysis();
      assert.equal(h.app.cardsState, 'error');
      assert.match(h.app.cardsError, /404/);
      assert.equal(data.calls.filter(({ method }) => method === 'PUT').length, 0);
      assert.equal(data.prompts.length, 0);
    });

    it('clears Cards confirmation, loaded state and request on environment/ref change', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      h.app.cardsConfirmed = true;
      h.app.cardsRequest = { target: jobs.PROBE_TARGETS.stage };
      h.app.selectProbeEnvironment('stage');
      assert.equal(h.app.cardsConfirmed, false);
      assert.equal(h.app.cardsRequest, null);
      h.app.cardsConfirmed = true;
      h.app.changeDiscoveryInput('ref', 'other');
      assert.equal(h.app.cardsConfirmed, false);
      assert.match(h.app.cardsBlockReason, /Production/);
    });

    it('rejects an invalid completed result without displaying success or unvalidated JSON', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      h.app.selectProbeEnvironment('prod');
      h.app.cardsConfirmed = true;
      await h.app.prepareCardsAnalysis();
      const request = h.app.cardsRequest;
      data.files.set(`https://admin.da.live/source/msagolj/ew${request.resultPath}`, {
        schemaVersion: 1,
        jobId: request.jobId,
        kind: request.kind,
        target: request.target,
        status: 'completed',
        payload: { analysis: { blockName: 'hero' } },
      });
      await h.app.checkCardsAnalysis();
      assert.equal(h.app.cardsState, 'error');
      assert.equal(h.app.cardsResult, null);
      assert.match(h.app.cardsError, /missing|Cards/i);
    });

    it('clears Cards confirmation and loaded data on disconnect', async () => {
      const h = await harness(fixtures());
      await h.connect();
      h.app.cardsConfirmed = true;
      h.app.cardsRequest = { target: jobs.PROBE_TARGETS.stage };
      h.app.cardsResult = { status: 'completed' };
      h.disconnect();
      assert.equal(h.app.cardsConfirmed, false);
      assert.equal(h.app.cardsRequest, null);
      assert.equal(h.app.cardsResult, null);
      assert.equal(h.app.cardsState, 'idle');
    });

    it('discards late source collection on an environment change without writing', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      configure(data, h.app);
      let finishPrompt;
      data.fetchPublic = () => new Promise((resolve) => { finishPrompt = resolve; });
      h.app.selectProbeEnvironment('prod');
      h.app.cardsConfirmed = true;
      const pending = h.app.prepareCardsAnalysis();
      h.app.selectProbeEnvironment('stage');
      finishPrompt(new Response('Saved prompt.', { headers: { 'Content-Type': 'text/plain' } }));
      await pending;
      assert.equal(h.app.cardsRequest, null);
      assert.equal(h.app.cardsConfirmed, false);
      assert.equal(h.app.cardsState, 'idle');
      assert.equal(jobs.loadJobPointer(data.storage, 'prod', 'cards'), null);
      assert.equal(data.calls.filter(({ method }) => method === 'PUT').length, 0);
    });
  });

  it('still allows a late handshake after the ten-second context timeout', async () => {
    const h = await harness(fixtures());
    const [{ callback, delay }] = [...h.timers.values()];
    assert.equal(delay, 10000);
    callback();
    assert.equal(h.app.connectionState, 'unavailable');
    await h.connect();
    assert.equal(h.app.connectionState, 'ready');
    assert.equal(h.app.probeBlockReason, '');
  });
});

describe('app probe workflow with mocked host and storage', () => {
  it('requires confirmation before any storage write or authenticated request', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    await h.app.prepareProbe();
    assert.match(h.app.probeError, /Confirm/);
    assert.equal(data.calls.length, 0);
    assert.equal(jobs.loadProbePointer(data.storage), null);
  });

  it('prepares and reads back the request without sending chat or retaining the token', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.probeConfirmed = true;
    await h.app.prepareProbe();
    assert.equal(h.app.probeState, 'prepared');
    assert.equal(h.app.probeBusy, false);
    assert.equal(data.prompts.length, 0);
    assert.deepEqual(data.calls.map(({ method }) => method), ['GET', 'PUT', 'GET']);
    assert.equal(JSON.stringify(h.app).includes('test-token-do-not-persist'), false);
    assert.equal(jobs.loadProbePointer(data.storage, 'prod').jobId, h.app.probeRequest.jobId);
  });

  it('hands off once, closes, resumes without resending, and checks a final result', async () => {
    const data = fixtures();
    const first = await harness(data);
    await first.connect();
    first.app.probeConfirmed = true;
    await first.app.prepareProbe();
    const request = first.app.probeRequest;
    first.app.sendProbe();
    assert.equal(data.prompts.length, 1);
    assert.equal(data.prompts[0].options.autoSend, false);
    assert.equal(data.closed.length, 1);
    first.disconnect();

    const resumed = await harness(data);
    await resumed.connect();
    assert.equal(resumed.app.savedProbe.jobId, request.jobId);
    assert.equal(resumed.app.probeRequest, null);
    resumed.app.probeConfirmed = true;
    await resumed.app.resumeProbe();
    assert.equal(resumed.app.probeRequest.jobId, request.jobId);
    resumed.app.sendProbe();
    assert.match(resumed.app.probeError, /already requested/);
    assert.equal(data.prompts.length, 1);

    await resumed.app.checkProbeResult();
    assert.equal(resumed.app.probeState, 'pending');
    const resultUrl = `${jobs.PROBE_TARGETS.prod.adminOrigin}/source/msagolj/ew${request.resultPath}`;
    data.files.set(resultUrl, {
      schemaVersion: 1,
      jobId: request.jobId,
      kind: 'probe',
      target: { ...jobs.PROBE_TARGETS.prod },
      status: 'completed',
      payload: { message: jobs.PROBE_MARKER },
    });
    await resumed.app.checkProbeResult();
    assert.equal(resumed.app.probeState, 'received');
    assert.equal(data.prompts.length, 1);
  });

  it('rejects a wrong-job result instead of displaying success', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.probeConfirmed = true;
    await h.app.prepareProbe();
    const resultUrl = `${jobs.PROBE_TARGETS.prod.adminOrigin}/source/msagolj/ew${h.app.probeRequest.resultPath}`;
    data.files.set(resultUrl, { jobId: 'a different job' });
    await h.app.checkProbeResult();
    assert.equal(h.app.probeState, 'error');
    assert.equal(h.app.probeResult, null);
    assert.match(h.app.probeError, /identity/);
  });

  it('does not replace the resume pointer without a second explicit confirmation', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.probeConfirmed = true;
    await h.app.prepareProbe();
    const firstId = h.app.savedProbe.jobId;
    await h.app.prepareProbe();
    assert.match(h.app.probeError, /replacing/);
    assert.equal(h.app.savedProbe.jobId, firstId);
    assert.equal(data.calls.length, 3);
  });

  it('aborts a detached operation before it can advance to a PUT', async () => {
    const data = fixtures();
    let resolveRead;
    data.actions.daFetch = (url, options) => {
      data.calls.push({ url, method: options.method });
      return new Promise((resolve) => { resolveRead = resolve; });
    };
    const h = await harness(data);
    await h.connect();
    h.app.probeConfirmed = true;
    const operation = h.app.prepareProbe();
    h.disconnect();
    resolveRead(new Response(null, { status: 404 }));
    await operation;
    assert.equal(data.calls.length, 1);
    assert.equal(h.app.probeRequest, null);
    assert.equal(h.app.probeBusy, false);
  });
});

describe('Production UI and legacy developer service controls', () => {
  it('requires fresh confirmation when explicitly switching the legacy developer service', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    assert.equal(h.app.probeEnvironment, 'prod');
    h.app.selectProbeEnvironment('stage');
    h.app.probeConfirmed = true;
    await h.app.prepareProbe();
    const stageId = h.app.probeRequest.jobId;
    h.app.probeResult = { status: 'completed' };
    h.app.newProbeConfirmed = true;
    h.app.selectProbeEnvironment('prod');
    assert.equal(h.app.probeEnvironment, 'prod');
    assert.equal(h.app.probeConfirmed, false);
    assert.equal(h.app.newProbeConfirmed, false);
    assert.equal(h.app.probeRequest, null);
    assert.equal(h.app.probeResult, null);
    assert.equal(h.app.savedProbe, null);
    assert.equal(h.app.handoffRequested, false);
    await h.app.prepareProbe();
    assert.match(h.app.probeError, /Confirm/);
    assert.equal(data.calls.length, 3);
    h.app.probeConfirmed = true;
    await h.app.prepareProbe();
    assert.equal(h.app.probeRequest.target.environment, 'prod');
    assert.notEqual(h.app.probeRequest.jobId, stageId);
    assert.ok(data.calls.slice(3).every(({ url }) => url.startsWith('https://admin.da.live/')));
    assert.equal(jobs.loadProbePointer(data.storage, 'stage').jobId, stageId);
  });

  describe('app block discovery', () => {
    function addInventory(data) {
      data.files.set('https://admin.hlx.page/config/msagolj/aggregated/ew.json', {
        code: { owner: 'msagolj', repo: 'ew', source: { url: 'https://github.com/msagolj/ew' } },
      });
      data.files.set('https://api.aem.live/msagolj/repos/ew/code/main/blocks/', {
        children: [{ type: 'folder', path: '/msagolj/repos/ew/code/main/blocks/cards/' }],
      });
      data.files.set('https://api.aem.live/msagolj/repos/ew/code/main/blocks/cards/', {
        children: [{ type: 'file', path: '/msagolj/repos/ew/code/main/blocks/cards/cards.js', size: 0 }],
      });
    }

    it('discovers without probe approval and writes only shared inventory metadata', async () => {
      const data = fixtures();
      addInventory(data);
      const h = await harness(data);
      await h.connect();
      h.app.selectProbeEnvironment('prod');
      assert.equal(h.app.probeConfirmed, false);
      await h.app.discoverInventory();
      assert.equal(h.app.discoveryResult.provider, 'code-bus');
      assert.equal(h.app.discoveryResult.blocks[0].name, 'cards');
      assert.equal(h.app.discoveryBusy, false);
      assert.deepEqual(data.calls.filter(({ method }) => method !== 'GET'), [{
        url: 'https://admin.da.live/source/msagolj/ew/.da/block-library-generator/cache/blocks-main.json',
        method: 'PUT',
      }]);
      assert.equal(data.prompts.length, 0);
      assert.equal(jobs.loadProbePointer(data.storage, 'prod'), null);
    });

    it('shows provider failures before accepting clearly labelled manual names', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect();
      await h.app.discoverInventory();
      assert.equal(h.app.discoveryResult.provider, null);
      assert.ok(h.app.discoveryResult.diagnostics.length > 0);
      h.app.manualBlockNames = 'Cards, hero';
      h.app.useManualBlocks();
      assert.equal(h.app.discoveryResult.provider, 'manual');
      assert.equal(h.app.discoveryResult.complete, false);
      assert.equal(h.app.discoveryResult.diagnostics.length > 0, true);
      h.app.manualBlockNames = '../invalid';
      h.app.useManualBlocks();
      assert.match(h.app.discoveryError, /Invalid/);
    });

    it('blocks a standalone Apps context from discovering the app-code repository', async () => {
      const data = fixtures();
      const h = await harness(data);
      await h.connect({
        context: {
          org: 'adobe-rnd', site: 'aem-apps', path: '/app', view: 'fullscreen',
        },
        token: 'test-token',
        actions: data.actions,
      });
      await h.app.discoverInventory();
      assert.match(h.app.discoveryError, /Choose a site/i);
      assert.equal(data.calls.length, 0);
    });

    it('clears discovery and cancels pending reads when the environment changes', async () => {
      const data = fixtures();
      let resolveRead;
      data.actions.daFetch = (url, options) => {
        data.calls.push({ url, method: options.method });
        return new Promise((resolve) => { resolveRead = resolve; });
      };
      const h = await harness(data);
      await h.connect();
      const pending = h.app.discoverInventory();
      h.app.selectProbeEnvironment('stage');
      resolveRead(new Response(null, { status: 404 }));
      await pending;
      assert.equal(h.app.discoveryResult, null);
      assert.equal(h.app.discoveryBusy, false);
      assert.equal(h.app.discoveryError, '');
      assert.equal(data.calls.length, 1);
      assert.equal(data.publicCalls.length, 0);
    });

    it('clears inventory on ref/repository changes and blocks pending results after disconnect', async () => {
      const data = fixtures();
      addInventory(data);
      const h = await harness(data);
      await h.connect();
      await h.app.discoverInventory();
      h.app.changeDiscoveryInput('ref', 'feature');
      assert.equal(h.app.discoveryRef, 'feature');
      assert.equal(h.app.discoveryResult, null);
      h.app.changeDiscoveryInput('repository', 'owner/repo');
      assert.equal(h.app.githubRepository, 'owner/repo');
      let resolveRead;
      h.app.hostActions.daFetch = () => new Promise((resolve) => { resolveRead = resolve; });
      const pending = h.app.discoverInventory();
      h.disconnect();
      resolveRead(new Response(null, { status: 404 }));
      await pending;
      assert.equal(h.app.discoveryResult, null);
      assert.equal(data.publicCalls.length, 0);
    });
  });

  it('reopens the production pointer but still requires confirmation before probe submission', async () => {
    const data = fixtures();
    const first = await harness(data);
    await first.connect();
    first.app.selectProbeEnvironment('prod');
    first.app.probeConfirmed = true;
    await first.app.prepareProbe();
    const request = first.app.probeRequest;
    first.app.sendProbe();
    first.disconnect();
    const reopened = await harness(data);
    await reopened.connect();
    assert.equal(reopened.app.probeEnvironment, 'prod');
    assert.equal(reopened.app.savedProbe.jobId, request.jobId);
    assert.equal(reopened.app.probeConfirmed, false);
    reopened.app.probeConfirmed = true;
    await reopened.app.resumeProbe();
    assert.equal(reopened.app.probeRequest.jobId, request.jobId);
    assert.equal(reopened.app.handoffRequested, true);
    assert.equal(data.prompts.length, 1);
    const resultUrl = `${jobs.PROBE_TARGETS.prod.adminOrigin}/source/msagolj/ew${request.resultPath}`;
    data.files.set(resultUrl, {
      schemaVersion: 1,
      jobId: request.jobId,
      kind: 'probe',
      target: { ...jobs.PROBE_TARGETS.prod },
      status: 'completed',
      payload: { message: jobs.PROBE_MARKER },
    });
    await reopened.app.checkProbeResult();
    assert.equal(reopened.app.probeState, 'received');
    reopened.app.sendProbe();
    assert.match(reopened.app.probeError, /already requested/);
    assert.equal(data.prompts.length, 1);
  });

  it('blocks dispatch and result reads for a loaded job from another environment', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.selectProbeEnvironment('prod');
    h.app.probeConfirmed = true;
    h.app.probeRequest = jobs.createProbeRequest();
    h.app.sendProbe();
    assert.match(h.app.probeError, /environment/i);
    assert.equal(data.prompts.length, 0);
    assert.equal(data.closed.length, 0);
    await h.app.checkProbeResult();
    assert.match(h.app.probeError, /environment/i);
    assert.equal(data.calls.length, 0);
  });

  it('discards an in-flight environment operation without writing or overwriting new state', async () => {
    const data = fixtures();
    let resolveRead;
    data.actions.daFetch = (url, options) => {
      data.calls.push({ url, method: options.method });
      return new Promise((resolve) => { resolveRead = resolve; });
    };
    const h = await harness(data);
    await h.connect();
    h.app.probeConfirmed = true;
    const pending = h.app.prepareProbe();
    h.app.selectProbeEnvironment('stage');
    assert.equal(h.app.probeBusy, false);
    assert.equal(h.app.probeConfirmed, false);
    resolveRead(new Response(null, { status: 404 }));
    await pending;
    assert.equal(h.app.probeEnvironment, 'stage');
    assert.equal(h.app.probeState, 'idle');
    assert.equal(h.app.probeRequest, null);
    assert.equal(h.app.probeError, '');
    assert.equal(data.calls.length, 1);
  });

  it('does not reset an active operation when selecting the same environment', async () => {
    const data = fixtures();
    const h = await harness(data);
    await h.connect();
    h.app.probeConfirmed = true;
    h.app.selectProbeEnvironment('prod');
    assert.equal(h.app.probeConfirmed, true);
    h.app.selectProbeEnvironment('not-an-environment');
    assert.equal(h.app.probeEnvironment, 'prod');
    assert.match(h.app.probeError, /environment/i);
    assert.equal(data.calls.length, 0);
  });
});
