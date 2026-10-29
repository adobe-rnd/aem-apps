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
import {
  getProbeTarget, createJobRequest, saveJobPointer, loadJobPointer,
  cleanupCompletedAnalysisJob, saveJobCleanupReceipt, loadJobCleanupReceipt,
} from '../../../../tools/apps/block-library-generator/jobs.js';

function fixture(kind = 'analysis') {
  const target = getProbeTarget('prod', { org: 'msagolj', site: 'frescopa' });
  const request = createJobRequest({ target, kind, input: { blockName: 'cards' } });
  const result = {
    schemaVersion: 1,
    jobId: request.jobId,
    kind,
    target,
    status: 'completed',
    payload: { analysis: { blockName: 'cards', generation: { status: 'ready' } } },
  };
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  saveJobPointer(storage, request, true);
  const root = `${target.adminOrigin}/source/${target.org}/${target.site}`;
  const files = new Map([
    [`${root}${request.requestPath}`, request],
    [`${root}${request.resultPath}`, result],
    [`${root}/docs/library/blocks/cards.html`, '<body>Library page</body>'],
  ]);
  const calls = [];
  const progress = [];
  const options = {
    request,
    completion: {
      kind: 'library-creation',
      jobId: request.jobId,
      blockName: 'cards',
      target,
      status: 'completed',
      page: 'verified',
      index: 'verified',
    },
    storage,
    onProgress: (receipt) => {
      saveJobCleanupReceipt(storage, receipt);
      progress.push(receipt);
    },
    daFetch: async (url, init) => {
      calls.push({ url, method: init.method });
      if (init.method === 'DELETE') {
        files.delete(url);
        return new Response(null, { status: 204 });
      }
      assert.equal(init.method, 'GET');
      return files.has(url) ? Response.json(files.get(url)) : new Response(null, { status: 404 });
    },
  };
  return {
    options, values, request, result, root, files, calls, progress,
  };
}

describe('Verified successful analysis-job cleanup', () => {
  it('removes only the completed job result/request, verifies absence and clears its matching pointer', async () => {
    const {
      options, root, request, calls, files, progress,
    } = fixture();
    const outcome = await cleanupCompletedAnalysisJob(options);
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.request, 'absent');
    assert.equal(outcome.result, 'absent');
    assert.deepEqual(calls.filter((call) => call.method === 'DELETE').map((call) => call.url), [
      `${root}${request.resultPath}`, `${root}${request.requestPath}`,
    ]);
    assert.ok(files.has(`${root}/docs/library/blocks/cards.html`));
    assert.equal(loadJobPointer(options.storage, request.target, 'analysis', 'cards'), null);
    assert.equal(loadJobCleanupReceipt(options.storage, request.target, request.jobId).status, 'completed');
    assert.ok(progress.some((receipt) => receipt.status === 'deleting-result'));
    assert.ok(progress.some((receipt) => receipt.result === 'absent' && receipt.request === 'pending'));
    assert.ok(!JSON.stringify(outcome).includes('"input"'));
    assert.ok(!JSON.stringify(outcome).includes('"payload"'));
  });

  it('accepts a verified recreation outcome or legacy Cards job, not just new Create jobs', async () => {
    await Promise.all(['analysis', 'cards'].map(async (kind) => {
      const { options } = fixture(kind);
      options.completion = {
        ...options.completion, kind: undefined, mode: 'recreate', name: 'cards',
      };
      assert.equal((await cleanupCompletedAnalysisJob(options)).status, 'completed');
    }));
  });

  it('rejects unsuccessful, unverified, wrong-job/site/block or delete outcomes before requests', async () => {
    await Promise.all(['failed', 'partial', 'page', 'index', 'job', 'target', 'block', 'delete'].map(async (change) => {
      const { options, calls } = fixture();
      if (['failed', 'partial'].includes(change)) options.completion.status = change;
      if (change === 'page') options.completion.page = 'written';
      if (change === 'index') options.completion.index = 'attempted';
      if (change === 'job') options.completion.jobId = crypto.randomUUID();
      if (change === 'target') options.completion.target = getProbeTarget('prod');
      if (change === 'block') options.completion.blockName = 'hero';
      if (change === 'delete') options.completion = { ...options.completion, kind: undefined, mode: 'delete' };
      await assert.rejects(cleanupCompletedAnalysisJob(options));
      assert.equal(calls.length, 0);
    }));
  });

  it('rejects tampered paths and storage probes without any request', async () => {
    await Promise.all(['request', 'result', 'probe'].map(async (change) => {
      const { options, calls } = fixture(change === 'probe' ? 'probe' : 'analysis');
      if (change === 'request') options.request.requestPath = '/docs/library/blocks/cards.html';
      if (change === 'result') options.request.resultPath = '/.da/another-job/result.json';
      await assert.rejects(cleanupCompletedAnalysisJob(options));
      assert.equal(calls.length, 0);
    }));
  });

  it('checks saved request/result identities before deleting either file', async () => {
    await Promise.all(['request', 'result-job', 'result-block', 'result-error'].map(async (change) => {
      const {
        options, files, root, request, result, calls,
      } = fixture();
      if (change === 'request') {
        files.set(`${root}${request.requestPath}`, { ...request, input: { blockName: 'hero' } });
      }
      if (change === 'result-job') result.jobId = crypto.randomUUID();
      if (change === 'result-block') result.payload.analysis.blockName = 'hero';
      if (change === 'result-error') {
        files.set(`${root}${request.resultPath}`, {
          ...result, status: 'error', payload: undefined, error: 'Analysis failed',
        });
      }
      await assert.rejects(cleanupCompletedAnalysisJob(options));
      assert.ok(calls.every((call) => call.method === 'GET'));
      assert.ok(loadJobPointer(options.storage, request.target, 'analysis', 'cards'));
    }));
  });

  it('treats already absent files idempotently without broad listing or deletion', async () => {
    const {
      options, files, root, request, calls,
    } = fixture();
    files.delete(`${root}${request.requestPath}`);
    files.delete(`${root}${request.resultPath}`);
    assert.equal((await cleanupCompletedAnalysisJob(options)).status, 'completed');
    assert.ok(calls.every((call) => call.method === 'GET'));
    const allowed = [request.requestPath, request.resultPath];
    assert.ok(calls.every((call) => allowed.some((path) => call.url.endsWith(path))));
  });

  it('does not interpret denied or failed preflight reads as missing files', async () => {
    await Promise.all([400, 401, 403, 500].map(async (status) => {
      const { options, calls } = fixture();
      options.daFetch = async (url, init) => {
        calls.push({ url, method: init.method });
        return new Response(null, { status });
      };
      await assert.rejects(cleanupCompletedAnalysisJob(options), new RegExp(String(status)));
      assert.ok(calls.every((call) => call.method === 'GET'));
    }));
  });

  it('reports a cleanup failure without clearing the pointer if a deletion is denied', async () => {
    const { options, request } = fixture();
    const original = options.daFetch;
    options.daFetch = (url, init) => (init.method === 'DELETE'
      ? new Response(null, { status: 403 }) : original(url, init));
    await assert.rejects(cleanupCompletedAnalysisJob(options), /403/);
    assert.equal(loadJobPointer(options.storage, request.target, 'analysis', 'cards').jobId, request.jobId);
    const saved = loadJobCleanupReceipt(options.storage, request.target, request.jobId);
    assert.equal(saved.status, 'failed');
    assert.match(saved.error, /403/);
  });

  it('requires404 after DELETE rather than assuming a204 means the file is gone', async () => {
    const { options, calls, request } = fixture();
    const original = options.daFetch;
    options.daFetch = (url, init) => (init.method === 'DELETE'
      ? new Response(null, { status: 204 }) : original(url, init));
    await assert.rejects(cleanupCompletedAnalysisJob(options), /absence|removed|exists/);
    assert.ok(!calls.some((call) => call.url.endsWith(request.requestPath) && call.method === 'DELETE'));
    assert.ok(loadJobPointer(options.storage, request.target, 'analysis', 'cards'));
  });

  it('keeps explicit partial cleanup metadata if the second deletion fails', async () => {
    const { options, request } = fixture();
    const original = options.daFetch;
    options.daFetch = (url, init) => (url.endsWith(request.requestPath) && init.method === 'DELETE'
      ? new Response(null, { status: 500 }) : original(url, init));
    await assert.rejects(cleanupCompletedAnalysisJob(options), /500/);
    const saved = loadJobCleanupReceipt(options.storage, request.target, request.jobId);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.result, 'absent');
    assert.equal(saved.request, 'attempted');
    assert.ok(loadJobPointer(options.storage, request.target, 'analysis', 'cards'));
  });

  it('never clears a newer pointer or another site/block pointer during late cleanup', async () => {
    const { options, request } = fixture();
    const newer = createJobRequest({ target: request.target, kind: 'analysis', input: { blockName: 'cards' } });
    const other = createJobRequest({ target: getProbeTarget('prod'), kind: 'analysis', input: { blockName: 'hero' } });
    saveJobPointer(options.storage, other);
    const original = options.daFetch;
    options.daFetch = async (url, init) => {
      const response = await original(url, init);
      if (init.method === 'DELETE') saveJobPointer(options.storage, newer);
      return response;
    };
    await cleanupCompletedAnalysisJob(options);
    assert.equal(loadJobPointer(options.storage, newer.target, 'analysis', 'cards').jobId, newer.jobId);
    assert.equal(loadJobPointer(options.storage, other.target, 'analysis', 'hero').jobId, other.jobId);
  });

  it('stops interrupted cleanup and retains the pointer and durable failure state', async () => {
    const { options, request } = fixture();
    const controller = new AbortController();
    const original = options.daFetch;
    options.signal = controller.signal;
    options.daFetch = async (url, init) => {
      const response = await original(url, init);
      if (init.method === 'DELETE') controller.abort();
      return response;
    };
    await assert.rejects(cleanupCompletedAnalysisJob(options), /abort/i);
    assert.ok(loadJobPointer(options.storage, request.target, 'analysis', 'cards'));
    assert.equal(loadJobCleanupReceipt(options.storage, request.target, request.jobId).status, 'failed');
  });

  it('surfaces local-pointer removal failures after remote cleanup rather than claiming full completion', async () => {
    const { options, request } = fixture();
    options.storage.removeItem = () => { throw new Error('Pointer storage unavailable'); };
    await assert.rejects(cleanupCompletedAnalysisJob(options), /Pointer storage unavailable/);
    const saved = loadJobCleanupReceipt(options.storage, request.target, request.jobId);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.request, 'absent');
    assert.equal(saved.result, 'absent');
    assert.ok(loadJobPointer(options.storage, request.target, 'analysis', 'cards'));
  });

  it('keeps metadata for different cleanup jobs isolated and rejects incomplete completed receipts', async () => {
    const { options, request } = fixture();
    await cleanupCompletedAnalysisJob(options);
    const receipt = loadJobCleanupReceipt(options.storage, request.target, request.jobId);
    assert.equal(loadJobCleanupReceipt(options.storage, request.target, crypto.randomUUID()), null);
    assert.equal(loadJobCleanupReceipt(options.storage, getProbeTarget('prod'), request.jobId), null);
    assert.throws(() => saveJobCleanupReceipt(options.storage, {
      ...receipt, request: 'pending',
    }), /cleanup outcome/);
    assert.throws(() => saveJobCleanupReceipt(options.storage, {
      ...receipt, input: { sources: ['Do not persist source snapshots'] },
    }), /cleanup outcome/);
  });

  it('does no cleanup if durable progress cannot be saved', async () => {
    const { options, calls } = fixture();
    options.onProgress = () => { throw new Error('Storage unavailable'); };
    await assert.rejects(cleanupCompletedAnalysisJob(options), /Storage unavailable/);
    assert.equal(calls.length, 0);
  });
});
