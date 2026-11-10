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
import { getProbeTarget } from './jobs.js';
import { readLibraryResource } from './library-dry-run.js';
import { putLibrarySource } from './library-creation.js';

export const PLACEHOLDER_IMAGES = Object.freeze([
  { file: 'placeholder-blue-v1.png', alt: 'Abstract blue mountain landscape with a sun' },
  { file: 'placeholder-green-v1.png', alt: 'Abstract green mountain landscape with a sun' },
  { file: 'placeholder-orange-v1.png', alt: 'Abstract orange mountain landscape with a sun' },
]);
const DIRECTORY = '/docs/library/media/block-library-generator';
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const same = (left, right) => left.length === right.length
  && left.every((value, index) => value === right[index]);

async function readPNG(read, url) {
  if (!read.response.ok) throw new Error(`Placeholder image read failed (HTTP ${read.response.status}): ${url}`);
  if (!/^image\/png(?:;|$)/i.test(read.response.headers.get('content-type') || '')) {
    throw new Error(`Placeholder image returned an unexpected content type; PNG required: ${url}`);
  }
  const bytes = new Uint8Array(await read.response.arrayBuffer());
  read.signal.throwIfAborted();
  if (bytes.length > 1024 * 1024 || bytes.length < 33
    || !same(bytes.slice(0, 8), signature)) {
    throw new Error(`Placeholder asset is not a bounded PNG image: ${url}`);
  }
  return bytes;
}

export async function ensurePlaceholderImages({
  target, daFetch, fetchLocal, signal,
}) {
  signal?.throwIfAborted();
  const selected = getProbeTarget(target);
  const sourceRoot = `${selected.adminOrigin}/source/${selected.org}/${selected.site}`;
  const origin = selected.environment === 'prod' ? 'https://content.da.live' : 'https://stage-content.da.live';
  const prepared = await Promise.all(PLACEHOLDER_IMAGES.map(async (asset) => {
    const localURL = new URL(`./assets/${asset.file}`, import.meta.url);
    const bytes = await readPNG(
      await readLibraryResource(fetchLocal, localURL, signal),
      localURL.href,
    );
    const path = `${DIRECTORY}/${asset.file}`;
    const url = `${sourceRoot}${path}`;
    const remote = await readLibraryResource(daFetch, url, signal);
    const missing = remote.response.status === 404;
    if (missing) {
      await remote.response.body?.cancel();
      remote.signal.throwIfAborted();
    } else if (!same(await readPNG(remote, url), bytes)) {
      throw new Error(`Placeholder path already exists with different content; no overwrite is allowed: ${path}`);
    }
    return {
      ...asset, path, url, bytes, missing,
    };
  }));
  return prepared.reduce(async (previous, asset) => {
    const images = await previous;
    signal?.throwIfAborted();
    if (asset.missing) {
      await putLibrarySource(
        daFetch,
        selected,
        asset.path,
        asset.bytes,
        'image/png',
        { 'If-None-Match': '*' },
        signal,
      );
      const readback = await readPNG(
        await readLibraryResource(daFetch, asset.url, signal),
        asset.url,
      );
      if (!same(readback, asset.bytes)) throw new Error(`Placeholder image readback does not match: ${asset.path}`);
    }
    return [...images, {
      src: `${origin}/${selected.org}/${selected.site}${asset.path}`,
      alt: asset.alt,
    }];
  }, Promise.resolve([]));
}
