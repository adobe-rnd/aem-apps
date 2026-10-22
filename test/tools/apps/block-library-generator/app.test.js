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
  return {
    files,
    calls,
    prompts,
    closed,
    storage: {
      getItem: (key) => pointers.get(key) ?? null,
      setItem: (key, value) => pointers.set(key, value),
    },
    actions: {
      async daFetch(url, options) {
        calls.push({ url, method: options.method });
        if (options.method === 'PUT') {
          files.set(url, JSON.parse(await options.body.get('data').text()));
          return new Response(null, { status: 201 });
        }
        return files.has(url)
          ? new Response(JSON.stringify(files.get(url)))
          : new Response(null, { status: 404 });
      },
      setPrompt: (text, options) => prompts.push({ text, options }),
      closeLibrary: () => closed.push(true),
    },
  };
}

async function harness(data, { embedded = true, sdkFails = false } = {}) {
  let App;
  let resolveSdk;
  const sdkPromise = new Promise((resolve) => { resolveSdk = resolve; });
  const timers = new Map();
  const window = {
    localStorage: data.storage,
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

describe('app connection regressions', () => {
  it('keeps standalone opening read-only and handles an unavailable SDK', async () => {
    const direct = await harness(fixtures(), { embedded: false });
    assert.equal(direct.app.connectionState, 'unavailable');
    assert.match(direct.app.probeBlockReason, /editor/i);
    const failed = await harness(fixtures(), { sdkFails: true });
    assert.equal(failed.app.connectionState, 'error');
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
    assert.equal(jobs.loadProbePointer(data.storage).jobId, h.app.probeRequest.jobId);
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
    const resultUrl = `${jobs.PROBE_TARGET.adminOrigin}/source/msagolj/ew${request.resultPath}`;
    data.files.set(resultUrl, {
      schemaVersion: 1,
      jobId: request.jobId,
      kind: 'probe',
      target: { ...jobs.PROBE_TARGET },
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
    const resultUrl = `${jobs.PROBE_TARGET.adminOrigin}/source/msagolj/ew${h.app.probeRequest.resultPath}`;
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
