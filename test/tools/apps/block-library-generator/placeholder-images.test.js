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
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { getProbeTarget } from '../../../../tools/apps/block-library-generator/jobs.js';
import { PLACEHOLDER_IMAGES, ensurePlaceholderImages } from '../../../../tools/apps/block-library-generator/placeholder-images.js';

const target = getProbeTarget('prod', { org: 'msagolj', site: 'frescopa' });
const directory = '/docs/library/media/block-library-generator';
const sourceRoot = `${target.adminOrigin}/source/${target.org}/${target.site}`;
const png = (bytes) => new Response(bytes, { headers: { 'Content-Type': 'image/png' } });

function fixture() {
  const files = new Map();
  const calls = [];
  const options = {
    target,
    fetchLocal: async (url) => png(await readFile(url)),
    daFetch: async (url, init) => {
      calls.push({ url, method: init.method });
      if (init.method === 'GET') return files.has(url) ? png(files.get(url)) : new Response(null, { status: 404 });
      assert.equal(init.method, 'PUT');
      assert.equal(init.headers['If-None-Match'], '*');
      if (files.has(url)) return new Response(null, { status: 412 });
      const blob = init.body.get('data');
      assert.equal(blob.type, 'image/png');
      files.set(url, new Uint8Array(await blob.arrayBuffer()));
      return new Response(null, { status: 201 });
    },
  };
  return { files, calls, options };
}

describe('Packaged same-site placeholder images', () => {
  it('creates three real PNGs only if missing, then reuses verified files without writes', async () => {
    const { files, calls, options } = fixture();
    const images = await ensurePlaceholderImages(options);
    assert.equal(images.length, 3);
    assert.ok(images.every((image) => image.src.startsWith(`https://content.da.live/msagolj/frescopa${directory}/`)));
    assert.ok(images.every((image) => image.alt && !image.src.includes('localhost')));
    assert.equal(calls.filter((call) => call.method === 'PUT').length, 3);
    files.forEach((bytes) => {
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.equal(header.getUint32(16), 640);
      assert.equal(header.getUint32(20), 360);
      assert.ok(bytes.length < 4096);
    });
    const count = calls.length;
    assert.deepEqual(await ensurePlaceholderImages(options), images);
    assert.ok(calls.slice(count).every((call) => call.method === 'GET'));
  });

  it('refuses existing conflicting files rather than overwriting or silently adopting them', async () => {
    const { files, calls, options } = fixture();
    files.set(
      `${sourceRoot}${directory}/${PLACEHOLDER_IMAGES[0].file}`,
      new Uint8Array(await readFile(new URL(`../../../../tools/apps/block-library-generator/assets/${PLACEHOLDER_IMAGES[1].file}`, import.meta.url))),
    );
    await assert.rejects(ensurePlaceholderImages(options), /different content|conflict/);
    assert.ok(calls.every((call) => call.method === 'GET'));
  });

  it('does not treat access or network failures as permission to create assets', async () => {
    await Promise.all([403, 500].map(async (status) => {
      const { calls, options } = fixture();
      options.daFetch = async (url, init) => {
        calls.push({ url, method: init.method });
        return new Response(null, { status });
      };
      await assert.rejects(ensurePlaceholderImages(options), new RegExp(String(status)));
      assert.ok(calls.every((call) => call.method === 'GET'));
    }));
    const { options } = fixture();
    options.daFetch = async () => { throw new Error('Network unavailable'); };
    await assert.rejects(ensurePlaceholderImages(options), /Network unavailable/);
  });

  it('keeps create-only races and write failures explicit without unguarded retries', async () => {
    await Promise.all([403, 412].map(async (status) => {
      const { options, calls } = fixture();
      const fetcher = options.daFetch;
      options.daFetch = async (url, init) => {
        if (init.method === 'PUT') {
          calls.push({ url, method: 'PUT' });
          return new Response(null, { status });
        }
        return fetcher(url, init);
      };
      await assert.rejects(ensurePlaceholderImages(options), new RegExp(String(status)));
      assert.equal(calls.filter((call) => call.method === 'PUT').length, 1);
    }));
  });

  it('requires exact PNG readback before supplying image URLs to analysis', async () => {
    const { options, files } = fixture();
    const fetcher = options.daFetch;
    options.daFetch = async (url, init) => {
      const response = await fetcher(url, init);
      if (init.method === 'PUT') files.set(url, new Uint8Array([0, 1, 2]));
      return response;
    };
    await assert.rejects(ensurePlaceholderImages(options), /PNG|readback/);
  });

  it('rejects broken local assets and unsafe targets before any content writes', async () => {
    const { options, calls } = fixture();
    options.fetchLocal = async () => new Response('<html>Missing</html>', { headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(ensurePlaceholderImages(options), /PNG|content type/);
    assert.ok(calls.every((call) => call.method === 'GET'));
    await assert.rejects(ensurePlaceholderImages({
      ...options, target: { ...target, adminOrigin: 'https://untrusted.invalid' },
    }), /target/i);
  });

  it('stops cancelled preparation without creating anything', async () => {
    const { options, calls } = fixture();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(ensurePlaceholderImages({ ...options, signal: controller.signal }), /abort/i);
    assert.equal(calls.length, 0);
  });
});
