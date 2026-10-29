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
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getProbeTarget } from '../../../../tools/apps/block-library-generator/jobs.js';
import {
  inspectLibrarySetup, initializeBlockLibrary, saveLibrarySetupReceipt, loadLibrarySetupReceipt,
} from '../../../../tools/apps/block-library-generator/library-setup.js';

const target = getProbeTarget('prod', { org: 'msagolj', site: 'frescopa' });
const configURL = `${target.adminOrigin}/config/${target.org}/${target.site}`;
const sourceRoot = `${target.adminOrigin}/source/${target.org}/${target.site}`;
const contentRoot = `https://content.da.live/${target.org}/${target.site}`;
const sheet = (data) => ({
  ':type': 'sheet', total: data.length, limit: data.length, offset: 0, data,
});
const emptyIndex = () => sheet([]);
const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
function fixture({ registered = false, indexed = false, directory = '/docs/library' } = {}) {
  const generator = {
    title: 'Block Library Generator',
    path: 'http://localhost:3000/tools/apps/block-library-generator/block-library-generator.html',
    experience: 'fullsize-dialog',
  };
  const state = {
    config: {
      ':type': 'multi-sheet',
      ':names': ['library', 'apps', 'permissions'],
      library: { ...sheet([generator]), ':colWidths': [120, 600] },
      apps: sheet([{ title: 'Keep app', path: 'https://da.live/apps' }]),
      permissions: sheet([{ path: 'CONFIG', actions: 'write', groups: 'existing-admins' }]),
    },
    index: indexed ? { ...emptyIndex(), extra: 'preserve index metadata' } : null,
    calls: [],
    statuses: new Map(),
    progress: [],
    indexURL: `${sourceRoot}${directory}/blocks.json`,
  };
  if (registered) {
    state.config.library = {
      ...state.config.library,
      ...sheet([...state.config.library.data, { title: 'Blocks', path: `${contentRoot}${directory}/blocks.json` }]),
    };
  }
  const daFetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    state.calls.push({ url, ...options, method });
    if (state.statuses.has(`${method} ${url}`)) {
      return new Response(null, { status: state.statuses.get(`${method} ${url}`) });
    }
    if (method === 'GET') {
      const value = url === configURL ? state.config : state.index;
      assert.ok(url === configURL || url === state.indexURL, `Unexpected URL: ${url}`);
      return value === null ? new Response(null, { status: 404 }) : Response.json(value);
    }
    if (url === configURL) {
      assert.equal(method, 'POST');
      assert.equal(options.headers?.['If-Match'], undefined, 'Do not pretend config POST is conditional');
      state.config = JSON.parse(options.body.get('config'));
      return Response.json(state.config, { status: 201 });
    }
    assert.equal(url, state.indexURL);
    assert.equal(method, 'PUT');
    assert.equal(options.headers['If-None-Match'], '*');
    if (state.index !== null) return new Response(null, { status: 412 });
    state.index = JSON.parse(await options.body.get('data').text());
    return new Response(null, { status: 201 });
  };
  return {
    state,
    daFetch,
    options: {
      target,
      daFetch,
      allowNonAtomicConfig: true,
      onProgress: (receipt) => state.progress.push(receipt),
    },
  };
}

describe('Block library first-run setup', () => {
  it('distinguishes all four registration/index states without writes', async () => {
    await Promise.all([false, true].flatMap((registered) => [false, true].map(async (indexed) => {
      const { state, daFetch } = fixture({ registered, indexed });
      const setup = await inspectLibrarySetup({ target, daFetch });
      assert.equal(setup.status, registered && indexed ? 'ready' : 'required');
      assert.equal(setup.createIndex, !indexed);
      assert.equal(setup.registerLibrary, !registered);
      assert.equal(setup.paths.indexPath, '/docs/library/blocks.json');
      assert.equal(setup.examplesDirectory, '/docs/library/blocks');
      assert.ok(state.calls.every((call) => call.method === 'GET'));
    })));
  });

  it('uses the existing configured location instead of proposing a second default library', async () => {
    const { state, daFetch } = fixture({ registered: true, directory: '/custom/library' });
    const setup = await inspectLibrarySetup({ target, daFetch });
    assert.equal(setup.paths.indexPath, '/custom/library/blocks.json');
    assert.equal(setup.examplesDirectory, '/custom/library/blocks');
    assert.equal(setup.registerLibrary, false);
    assert.ok(state.calls.every((call) => !call.url.includes('/docs/library/')));
  });

  it('creates only the missing configured index and leaves all configuration byte-equivalent', async () => {
    const { state, options } = fixture({ registered: true });
    const configBefore = JSON.stringify(state.config);
    const proposal = await inspectLibrarySetup(options);
    const outcome = await initializeBlockLibrary({
      ...options, proposal, allowNonAtomicConfig: false,
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(JSON.stringify(state.config), configBefore);
    assert.deepEqual(state.index, emptyIndex());
    assert.deepEqual(state.calls.filter((call) => call.method !== 'GET').map((call) => call.method), ['PUT']);
  });

  it('creates both missing pieces and preserves unrelated rows, sheets and metadata', async () => {
    const { state, options } = fixture();
    const before = structuredClone(state.config);
    const proposal = await inspectLibrarySetup(options);
    const outcome = await initializeBlockLibrary({ ...options, proposal });
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(state.config.apps, before.apps);
    assert.deepEqual(state.config.permissions, before.permissions);
    assert.deepEqual(state.config.library[':colWidths'], before.library[':colWidths']);
    assert.deepEqual(state.config.library.data.slice(0, 1), before.library.data);
    assert.equal(state.config.library.data.at(-1).title, 'Blocks');
    assert.equal(state.config.library.data.at(-1).path, `${contentRoot}/docs/library/blocks.json`);
    assert.deepEqual(state.config[':names'], before[':names']);
    assert.deepEqual(state.calls.filter((call) => call.method !== 'GET').map((call) => call.method), ['PUT', 'POST']);
    assert.ok(state.progress.some((receipt) => receipt.index === 'attempted'));
    assert.ok(state.progress.some((receipt) => receipt.registration === 'attempted'));
    assert.ok(state.progress.every((receipt) => !Object.hasOwn(receipt, 'configBefore')));
  });

  it('registers a valid existing index without rewriting it or its author data', async () => {
    const { state, options } = fixture({ indexed: true });
    state.index = {
      ...sheet([{ name: 'Existing', path: `${contentRoot}/docs/library/blocks/existing` }]),
      ':colWidths': [100, 300],
    };
    const indexBefore = JSON.stringify(state.index);
    const proposal = await inspectLibrarySetup(options);
    await initializeBlockLibrary({ ...options, proposal });
    assert.equal(JSON.stringify(state.index), indexBefore);
    assert.deepEqual(state.calls.filter((call) => call.method !== 'GET').map((call) => call.method), ['POST']);
  });

  it('adds a missing library sheet or site configuration without losing existing content', async () => {
    await Promise.all([false, true].map(async (missingConfig) => {
      const { state, options } = fixture();
      delete state.config.library;
      state.config[':names'] = ['apps', 'permissions'];
      const before = structuredClone(state.config);
      if (missingConfig) state.config = null;
      const proposal = await inspectLibrarySetup(options);
      await initializeBlockLibrary({ ...options, proposal });
      assert.ok(state.config[':names'].includes('library'));
      assert.equal(state.config.library.data[0].title, 'Blocks');
      if (!missingConfig) {
        assert.deepEqual(state.config.apps, before.apps);
        assert.deepEqual(state.config.permissions, before.permissions);
      }
    }));
  });

  it('requires explicit non-atomic configuration consent before any write', async () => {
    const { state, options } = fixture();
    const proposal = await inspectLibrarySetup(options);
    await assert.rejects(initializeBlockLibrary({
      ...options, proposal, allowNonAtomicConfig: false,
    }), /non-atomic|concurrent/);
    assert.ok(state.calls.every((call) => call.method === 'GET'));
  });

  it('refuses setup for authorization/server errors, malformed indexes or malformed configuration', async () => {
    await Promise.all([401, 403, 400, 500].map(async (status) => {
      const { state, options } = fixture();
      state.statuses.set(`GET ${state.indexURL}`, status);
      await assert.rejects(inspectLibrarySetup(options), new RegExp(String(status)));
      assert.ok(state.calls.every((call) => call.method === 'GET'));
    }));
    const invalid = fixture({ indexed: true });
    invalid.state.index = { data: [], total: 99 };
    await assert.rejects(inspectLibrarySetup(invalid.options), /index|sheet|complete/);
    const malformed = fixture();
    malformed.state.config.library = { data: 'not rows' };
    await assert.rejects(inspectLibrarySetup(malformed.options), /configuration/);
  });

  it('rejects duplicate/foreign registrations and partial sheets instead of treating them as missing', async () => {
    await Promise.all(['foreign', 'duplicate', 'partial', 'broken-names'].map(async (kind) => {
      const { state, options } = fixture({ registered: true });
      if (kind === 'foreign') state.config.library.data[1].path = 'https://untrusted.invalid/blocks.json';
      if (kind === 'duplicate') {
        state.config.library.data.push({ ...state.config.library.data[1] });
        state.config.library.total += 1;
        state.config.library.limit += 1;
      }
      if (kind === 'partial') state.config.library.total = 99;
      if (kind === 'broken-names') state.config[':names'] = ['permissions'];
      await assert.rejects(inspectLibrarySetup(options));
      assert.ok(state.calls.every((call) => call.url.startsWith(target.adminOrigin)));
    }));
  });

  it('rejects stale approvals, cross-site targets and a concurrently created index without config writes', async () => {
    await Promise.all(['config', 'index', 'target', 'race'].map(async (kind) => {
      const { state, options } = fixture();
      const proposal = await inspectLibrarySetup(options);
      if (kind === 'config') state.config.apps.data[0].title = 'Concurrent change';
      if (kind === 'index') state.index = emptyIndex();
      if (kind === 'target') proposal.target = getProbeTarget('prod', { org: 'msagolj', site: 'other' });
      if (kind === 'race') {
        state.statuses.set(`PUT ${state.indexURL}`, 412);
      }
      await assert.rejects(initializeBlockLibrary({ ...options, proposal }));
      assert.equal(state.calls.filter((call) => call.method === 'POST').length, 0);
    }));
  });

  it('rechecks config immediately before POST and reports a retained index on a late conflict', async () => {
    const { state, options, daFetch } = fixture();
    const proposal = await inspectLibrarySetup(options);
    options.daFetch = async (url, init) => {
      const response = await daFetch(url, init);
      if (init.method === 'PUT') state.config.apps.data[0].title = 'Author update';
      return response;
    };
    await assert.rejects(initializeBlockLibrary({ ...options, proposal }), (error) => {
      assert.equal(error.outcome.status, 'partial');
      assert.equal(error.outcome.index, 'verified');
      assert.equal(error.outcome.registration, 'not-attempted');
      return true;
    });
    assert.equal(state.config.apps.data[0].title, 'Author update');
    assert.equal(state.calls.filter((call) => call.method === 'POST').length, 0);
  });

  it('retains explicit partial progress, and a fresh approval can finish without recreating the index', async () => {
    const { state, options } = fixture();
    const proposal = await inspectLibrarySetup(options);
    state.statuses.set(`POST ${configURL}`, 403);
    await assert.rejects(initializeBlockLibrary({ ...options, proposal }), (error) => {
      assert.equal(error.outcome.status, 'partial');
      assert.equal(error.outcome.index, 'verified');
      return true;
    });
    state.statuses.delete(`POST ${configURL}`);
    const fresh = await inspectLibrarySetup(options);
    assert.equal(fresh.createIndex, false);
    await initializeBlockLibrary({ ...options, proposal: fresh });
    assert.equal(state.calls.filter((call) => call.method === 'PUT').length, 1);
    assert.equal((await inspectLibrarySetup(options)).status, 'ready');
  });

  it('refuses unverified readbacks and completed setup instead of returning success-shaped fallbacks', async () => {
    const { state, options, daFetch } = fixture();
    const proposal = await inspectLibrarySetup(options);
    options.daFetch = async (url, init) => {
      const response = await daFetch(url, init);
      if (init.method === 'PUT') state.index.extra = 'Unexpected readback';
      return response;
    };
    await assert.rejects(initializeBlockLibrary({ ...options, proposal }), /readback/);
    assert.equal(state.calls.filter((call) => call.method === 'POST').length, 0);
    const ready = fixture({ indexed: true, registered: true });
    await assert.rejects(initializeBlockLibrary({
      ...ready.options, proposal: await inspectLibrarySetup(ready.options),
    }), /already|ready/);
  });

  it('persists metadata-only receipts scoped to the site and branch', async () => {
    const { options } = fixture({ registered: true });
    const store = memory();
    const proposal = await inspectLibrarySetup(options);
    const outcome = await initializeBlockLibrary({
      ...options, proposal, onProgress: (receipt) => saveLibrarySetupReceipt(store, receipt),
    });
    assert.equal(loadLibrarySetupReceipt(store, target).status, 'completed');
    assert.equal(loadLibrarySetupReceipt(store, getProbeTarget('prod', { org: 'msagolj', site: 'other' })), null);
    assert.equal(loadLibrarySetupReceipt(store, getProbeTarget('prod', { org: 'msagolj', site: 'frescopa', branch: 'release' })), null);
    assert.ok(!JSON.stringify(outcome).includes('permissions'));
  });

  it('does not classify network, JSON, content-type or unsupported-config failures as absence', async () => {
    await Promise.all(['network', 'json', 'html', 'null-config', 'root-sheet'].map(async (kind) => {
      const { state, options, daFetch } = fixture();
      if (kind === 'null-config') state.config = 'not a configuration object';
      if (kind === 'root-sheet') state.config = sheet([]);
      options.daFetch = async (url, init) => {
        if (url === state.indexURL) {
          if (kind === 'network') throw new Error('Network unavailable');
          if (kind === 'json') return new Response('invalid json', { headers: { 'Content-Type': 'application/json' } });
          if (kind === 'html') return new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } });
        }
        return daFetch(url, init);
      };
      await assert.rejects(inspectLibrarySetup(options));
      assert.ok(state.calls.every((call) => call.method === 'GET'));
    }));
  });

  it('refuses tampered proposals, missing durable progress and cancellation before mutation', async () => {
    const { state, options } = fixture();
    const proposal = await inspectLibrarySetup(options);
    const tampered = structuredClone(proposal);
    tampered.configAfter.permissions.data = [];
    await assert.rejects(initializeBlockLibrary({ ...options, proposal: tampered }), /changed/);
    await assert.rejects(initializeBlockLibrary({
      ...options, proposal, onProgress: undefined,
    }), /progress/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(initializeBlockLibrary({
      ...options, proposal, signal: controller.signal,
    }), /abort/i);
    await assert.rejects(initializeBlockLibrary({
      ...options, proposal, onProgress: () => { throw new Error('Storage unavailable'); },
    }), /Storage unavailable/);
    assert.ok(state.calls.every((call) => call.method === 'GET'));
  });

  it('does not call configuration POST success completed until the complete preserved config reads back', async () => {
    const { state, options, daFetch } = fixture({ indexed: true });
    const proposal = await inspectLibrarySetup(options);
    options.daFetch = async (url, init) => {
      const response = await daFetch(url, init);
      if (init.method === 'POST') state.config.apps.data[0].title = 'Unexpected server value';
      return response;
    };
    await assert.rejects(initializeBlockLibrary({ ...options, proposal }), (error) => {
      assert.equal(error.outcome.status, 'partial');
      assert.equal(error.outcome.registration, 'written');
      return true;
    });
    assert.equal(state.calls.filter((call) => call.method !== 'GET').length, 1);
  });
});
