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
  getProbeTarget, createJobRequest, readJobRequest, readJobResult,
  saveJobPointer, loadJobPointer, persistJobRequest,
} from '../../../../tools/apps/block-library-generator/jobs.js';
import { getBlockLibraryPaths } from '../../../../tools/apps/block-library-generator/library-dry-run.js';
import { saveCreationReceipt, loadCreationReceipt } from '../../../../tools/apps/block-library-generator/library-creation.js';
import { prepareLibraryAction } from '../../../../tools/apps/block-library-generator/library-lifecycle.js';

const target = (site = 'demo', branch = 'main') => getProbeTarget('prod', {
  org: 'example-org', site, branch,
});
const request = (value) => createJobRequest({ target: value, kind: 'analysis', input: { blockName: 'hero' } });
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};
const config = (value) => ({
  library: { data: [{ title: 'Blocks', path: `https://content.da.live/${value.org}/${value.site}/docs/library/blocks.json` }] },
});
const receipt = (value) => ({
  schemaVersion: 1,
  kind: 'library-creation',
  jobId: crypto.randomUUID(),
  blockName: 'hero',
  target: value,
  destinations: getBlockLibraryPaths(config(value), value, 'hero'),
  expected: { page: 'a'.repeat(64), index: 'b'.repeat(64) },
  status: 'completed',
  page: 'verified',
  index: 'verified',
  error: '',
});

describe('Explicit site targets', () => {
  it('resolves another site and code branch without changing legacy target defaults', () => {
    assert.deepEqual(target('demo', 'release'), {
      environment: 'prod',
      org: 'example-org',
      site: 'demo',
      branch: 'release',
      adminOrigin: 'https://admin.da.live',
    });
    assert.equal(getProbeTarget('prod').org, 'msagolj');
    assert.deepEqual(getProbeTarget(target()), target());
    assert.throws(() => getProbeTarget('prod', { org: '../other', site: 'demo' }), /target/i);
    assert.throws(() => getProbeTarget('prod', { org: 'example-org', site: 'demo', branch: '../main' }), /target/i);
    assert.throws(() => getProbeTarget({ ...target(), adminOrigin: 'https://untrusted.invalid' }), /target/i);
  });

  it('correlates request/result readback to the explicit selected site', async () => {
    const value = request(target());
    const urls = [];
    const saved = await readJobRequest(async (url) => {
      urls.push(url);
      return Response.json(value);
    }, value.jobId, { target: value.target, kind: 'analysis' });
    assert.equal(saved.target.site, 'demo');
    assert.equal(urls[0], `https://admin.da.live/source/example-org/demo${value.requestPath}`);
    const result = {
      schemaVersion: 1,
      jobId: value.jobId,
      kind: value.kind,
      target: value.target,
      status: 'completed',
      payload: { analysis: {} },
    };
    await readJobResult(async () => Response.json(result), value);
    await assert.rejects(readJobResult(async () => Response.json({
      ...result, target: target('other'),
    }), value), /identity|target/);
    await assert.rejects(readJobRequest(async () => Response.json({
      ...value, target: target('other'),
    }), value.jobId, { target: value.target, kind: 'analysis' }), /target/);
  });

  it('writes only the requested site and preserves request identity on readback', async () => {
    const value = request(target());
    let stored;
    const urls = [];
    await persistJobRequest(async (url, options) => {
      urls.push(url);
      if (options.method === 'PUT') {
        stored = JSON.parse(await options.body.get('data').text());
        return new Response(null, { status: 201 });
      }
      return stored ? Response.json(stored) : new Response(null, { status: 404 });
    }, value);
    assert.ok(urls.every((url) => url.startsWith('https://admin.da.live/source/example-org/demo/')));
  });

  it('isolates pointers by site, branch, block and environment', () => {
    const store = storage();
    const values = [target(), target('other'), target('demo', 'release')].map(request);
    values.forEach((value) => saveJobPointer(store, value));
    values.forEach((value) => {
      assert.equal(loadJobPointer(store, value.target, 'analysis', 'hero').jobId, value.jobId);
    });
    assert.equal(loadJobPointer(store, 'prod', 'analysis', 'hero'), null);
    assert.equal(loadJobPointer(store, target(), 'analysis', 'columns'), null);
    assert.equal(loadJobPointer(store, { ...target(), environment: 'stage', adminOrigin: 'https://stage-admin.da.live' }, 'analysis', 'hero'), null);
  });

  it('resolves library destinations only inside the selected site', () => {
    const value = target();
    const paths = getBlockLibraryPaths(config(value), value, 'hero');
    assert.equal(paths.pageURL, 'https://content.da.live/example-org/demo/docs/library/blocks/hero');
    assert.throws(() => getBlockLibraryPaths(config(target('other')), value, 'hero'), /site|environment/);
  });

  it('isolates new receipts by site and branch while retaining old EW receipts', () => {
    const store = storage();
    const first = receipt(target());
    const second = receipt(target('demo', 'release'));
    saveCreationReceipt(store, first);
    saveCreationReceipt(store, second);
    assert.equal(loadCreationReceipt(store, first.target, 'hero').jobId, first.jobId);
    assert.equal(loadCreationReceipt(store, second.target, 'hero').jobId, second.jobId);
    assert.equal(loadCreationReceipt(store, target('other'), 'hero'), null);
    const legacy = receipt(getProbeTarget('prod'));
    store.setItem('block-library-generator:creation:prod:msagolj:ew:hero', JSON.stringify(legacy));
    assert.equal(loadCreationReceipt(store, getProbeTarget('prod'), 'hero').jobId, legacy.jobId);
  });

  it('prepares exact page actions for another configured site without mutating anything', async () => {
    const value = target();
    const calls = [];
    const snapshot = await prepareLibraryAction({
      target: value,
      name: 'hero',
      pagePath: '/docs/library/blocks/hero.html',
      daFetch: async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.includes('/config/')) return Response.json(config(value));
        if (url.endsWith('/blocks.json')) {
          return Response.json({
            ':type': 'sheet',
            offset: 0,
            total: 1,
            limit: 1,
            data: [{ name: 'Hero', path: 'https://content.da.live/example-org/demo/docs/library/blocks/hero' }],
          }, { headers: { ETag: '"index"' } });
        }
        return new Response('<body><main>Author content</main></body>', { headers: { 'Content-Type': 'text/html' } });
      },
    });
    assert.equal(snapshot.target.site, 'demo');
    assert.ok(calls.every((call) => call.method === 'GET' && call.url.includes('/example-org/demo')));
  });
});
