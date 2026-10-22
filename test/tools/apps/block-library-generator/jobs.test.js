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
import {
  PROBE_TARGET,
  PROBE_MARKER,
  createProbeRequest,
  getProbeBlockReason,
  persistProbeRequest,
  readProbeRequest,
  readProbeResult,
  createProbePrompt,
  loadProbePointer,
  saveProbePointer,
} from '../../../../tools/apps/block-library-generator/jobs.js';

const jobId = 'c564c3f9-f55e-4e5b-b4be-c5c054677f7f';
const createdAt = '2026-10-21T16:30:00.000Z';
const request = () => createProbeRequest({ jobId, createdAt });
const result = () => ({
  schemaVersion: 1,
  jobId,
  kind: 'probe',
  target: { ...PROBE_TARGET },
  status: 'completed',
  payload: { message: PROBE_MARKER },
});
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const storage = () => {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
};
const host = () => ({
  embedded: true,
  hasToken: true,
  context: {
    org: 'msagolj', site: 'ew', path: '/index', view: 'edit',
  },
  actions: { daFetch() {}, setPrompt() {}, closeLibrary() {} },
});

describe('probe host eligibility', () => {
  it('accepts the agreed editor target, with confirmation handled by the UI', () => {
    assert.equal(getProbeBlockReason(host()), '');
  });

  it('blocks direct opening, the Apps shell, missing tokens and missing actions', () => {
    assert.match(getProbeBlockReason({ ...host(), embedded: false }), /editor/i);
    assert.match(getProbeBlockReason({ ...host(), context: { ...host().context, view: 'fullscreen' } }), /editor/i);
    assert.match(getProbeBlockReason({ ...host(), hasToken: false }), /token/i);
    assert.match(getProbeBlockReason({ ...host(), actions: {} }), /SDK/i);
  });

  it('blocks a different target, supplied non-main branch or production origin', () => {
    [
      { ...host().context, site: 'boiler' },
      { ...host().context, branch: 'feature' },
      { ...host().context, daOrigin: 'https://admin.da.live' },
    ].forEach((context) => assert.notEqual(getProbeBlockReason({ ...host(), context }), ''));
  });
});

describe('probe request and persistence', () => {
  it('creates only fixed Stage scratch paths with an explicit target', () => {
    const value = request();
    assert.deepEqual(value.target, PROBE_TARGET);
    assert.equal(value.requestPath, `/.da/block-library-generator/jobs/${jobId}/request.json`);
    assert.equal(value.resultPath, `/.da/block-library-generator/jobs/${jobId}/result.json`);
    assert.equal(value.createdAt, createdAt);
    assert.equal(value.kind, 'probe');
  });

  it('rejects invalid IDs rather than constructing arbitrary paths', () => {
    ['../index', 'https://admin.da.live', '', 'not-a-uuid'].forEach((id) => {
      assert.throws(() => createProbeRequest({ jobId: id, createdAt }), /job ID/i);
    });
  });

  it('checks absence, writes multipart JSON, and verifies the request readback', async () => {
    const value = request();
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return new Response(null, { status: 404 });
      if (options.method === 'PUT') {
        assert.ok(options.body instanceof FormData);
        assert.deepEqual(JSON.parse(await options.body.get('data').text()), value);
        return new Response(null, { status: 201 });
      }
      return jsonResponse(value);
    };
    assert.deepEqual(await persistProbeRequest(fetcher, value), value);
    assert.deepEqual(calls.map(({ options }) => options.method), ['GET', 'PUT', 'GET']);
    assert.ok(calls.every(({ url }) => url === `https://stage-admin.da.live/source/msagolj/ew${value.requestPath}`));
    assert.ok(calls.every(({ options }) => options.cache === 'no-store'));
  });

  it('does not overwrite an existing request', async () => {
    let calls = 0;
    await assert.rejects(persistProbeRequest(async () => {
      calls += 1;
      return jsonResponse(request());
    }, request()), /already exists/i);
    assert.equal(calls, 1);
  });

  it('surfaces write authorization errors', async () => {
    let calls = 0;
    await assert.rejects(persistProbeRequest(async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 404 : 403 });
    }, request()), /403/);
  });

  it('does not accept a mismatching request readback', async () => {
    let calls = 0;
    await assert.rejects(persistProbeRequest(async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 404 });
      if (calls === 2) return new Response(null, { status: 201 });
      return jsonResponse({ ...request(), createdAt: '2026-10-22T00:00:00.000Z' });
    }, request()), /readback/i);
  });

  it('rejects stored requests with another target or redirected result path', async () => {
    await Promise.all([
      { ...request(), target: { ...PROBE_TARGET, site: 'boiler' } },
      { ...request(), resultPath: '/index.html' },
    ].map(async (value) => {
      await assert.rejects(readProbeRequest(async () => jsonResponse(value), jobId), /request|target|path/i);
    }));
  });

  it('rejects missing requests and malformed JSON explicitly', async () => {
    await assert.rejects(readProbeRequest(async () => new Response(null, { status: 404 }), jobId), /404/);
    await assert.rejects(readProbeRequest(async () => new Response('not json'), jobId), /JSON/i);
  });

  it('propagates network failures and supplies an abort signal', async () => {
    await assert.rejects(readProbeRequest(async (url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      throw new Error('Network unavailable');
    }, jobId), /Network unavailable/);
  });
});

describe('probe results', () => {
  it('returns null only for a result that does not exist yet', async () => {
    const value = await readProbeResult(async () => new Response(null, { status: 404 }), request());
    assert.equal(value, null);
  });

  it('accepts the exact completed probe marker', async () => {
    const value = await readProbeResult(async () => jsonResponse(result()), request());
    assert.deepEqual(value, result());
  });

  it('accepts an explicitly reported agent error, not as a completed result', async () => {
    const value = { ...result(), status: 'error', error: 'Stage tool unavailable' };
    delete value.payload;
    assert.deepEqual(await readProbeResult(async () => jsonResponse(value), request()), value);
  });

  it('rejects wrong-job, wrong-target, wrong-kind and unsupported-version results', async () => {
    await Promise.all([
      { ...result(), jobId: 'a564c3f9-f55e-4e5b-b4be-c5c054677f7f' },
      { ...result(), target: { ...PROBE_TARGET, adminOrigin: 'https://admin.da.live' } },
      { ...result(), kind: 'cards' },
      { ...result(), schemaVersion: 2 },
    ].map(async (value) => {
      await assert.rejects(readProbeResult(async () => jsonResponse(value), request()), /identity|target/i);
    }));
  });

  it('rejects incomplete statuses, incorrect markers and empty errors', async () => {
    await Promise.all([
      { ...result(), status: 'running' },
      { ...result(), payload: { message: 'different' } },
      { ...result(), status: 'error', error: '' },
    ].map(async (value) => {
      await assert.rejects(readProbeResult(async () => jsonResponse(value), request()), /status|marker|error/i);
    }));
  });

  it('does not treat access or server errors as pending', async () => {
    await Promise.all([401, 403, 500].map(async (status) => {
      await assert.rejects(readProbeResult(async () => new Response(null, { status }), request()), new RegExp(`${status}`));
    }));
  });

  it('limits result size in UTF-8 bytes, not JavaScript character count', async () => {
    const value = { ...result(), extra: '\u00e9'.repeat(524288) };
    await assert.rejects(
      readProbeResult(async () => jsonResponse(value), request()),
      /1 MiB/,
    );
  });

  it('honors an aborted caller signal before issuing a request', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await assert.rejects(readProbeResult(async () => {
      called = true;
      return jsonResponse(result());
    }, request(), { signal: controller.signal }), /abort/i);
    assert.equal(called, false);
  });
});

describe('probe resume and chat prompt', () => {
  it('stores only the job identity and handoff flag, and restores without dispatch', () => {
    const local = storage();
    assert.equal(loadProbePointer(local), null);
    saveProbePointer(local, request());
    assert.deepEqual(loadProbePointer(local), { jobId, handoffRequested: false });
    saveProbePointer(local, request(), true);
    assert.deepEqual(loadProbePointer(local), { jobId, handoffRequested: true });
  });

  it('surfaces unavailable or corrupt resume storage', () => {
    assert.throws(() => loadProbePointer({ getItem() { throw new Error('Storage denied'); } }), /Storage denied/);
    assert.throws(() => loadProbePointer({ getItem() { return 'broken'; } }), /resume/i);
    assert.throws(() => loadProbePointer({ getItem() { return '{"jobId":"../index","handoffRequested":false}'; } }), /job ID/i);
    assert.throws(() => saveProbePointer({ setItem() { throw new Error('Storage denied'); } }, request()), /Storage denied/);
  });

  it('instructs a Stage-only real write to the exact result file without Cards analysis', () => {
    const prompt = createProbePrompt(request());
    assert.ok(prompt.includes(`https://stage-admin.da.live/source/msagolj/ew${request().resultPath}`));
    assert.ok(prompt.includes(jobId));
    assert.ok(prompt.includes(PROBE_MARKER));
    assert.match(prompt, /do not.*production/i);
    assert.match(prompt, /current.*document/i);
    assert.match(prompt, /cannot.*Stage/i);
    assert.doesNotMatch(prompt, /Bearer|accessToken|analyse.*cards/i);
  });
});
