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
import { getProbeTarget, assertBlockName } from './jobs.js';
import { discoverBlocks } from './discovery.js';
import { readLibraryText, readLibraryJSON } from './library-dry-run.js';
import { putLibrarySource, strongLibraryETag } from './library-creation.js';

const identifier = (value) => typeof value === 'string'
  && /^[a-z0-9][a-z0-9._-]*$/i.test(value) && !value.includes('..');

function cachedInventory(record, target) {
  const savedTarget = getProbeTarget(record?.target);
  if (record.schemaVersion !== 1 || record.kind !== 'block-inventory'
    || Object.keys(target).some((key) => savedTarget[key] !== target[key])
    || record.complete !== true || !['code-bus', 'github'].includes(record.provider)
    || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))
    || !Array.isArray(record.blocks) || record.coordinates?.ref !== target.branch) {
    throw new Error('Invalid saved block inventory for this site and branch.');
  }
  const coordinates = Object.fromEntries(
    ['owner', 'repo', 'ref', 'githubRepository']
      .filter((key) => Object.hasOwn(record.coordinates, key))
      .map((key) => [key, record.coordinates[key]]),
  );
  if ((record.provider === 'code-bus'
    && (!identifier(coordinates.owner) || !identifier(coordinates.repo)))
    || (coordinates.owner !== undefined && !identifier(coordinates.owner))
    || (coordinates.repo !== undefined && !identifier(coordinates.repo))
    || (coordinates.githubRepository != null && (typeof coordinates.githubRepository !== 'string'
      || coordinates.githubRepository.split('/').length !== 2
      || !coordinates.githubRepository.split('/').every(identifier)))
    || (record.provider === 'github' && !coordinates.githubRepository)
    || (record.revision !== undefined && typeof record.revision !== 'string')) {
    throw new Error('Invalid saved code-provider metadata.');
  }
  const names = new Set();
  const blocks = record.blocks.map((block) => {
    assertBlockName(block?.name);
    if (names.has(block.name) || !Array.isArray(block.files)
      || !block.files.length || block.files.length > 2) throw new Error('Invalid cached block entries.');
    names.add(block.name);
    const extensions = new Set();
    const files = block.files.map((file) => {
      if (!file || !['js', 'css'].includes(file.extension) || extensions.has(file.extension)
        || file.path !== `/blocks/${block.name}/${block.name}.${file.extension}`
        || (file.size !== undefined && (!Number.isSafeInteger(file.size) || file.size < 0))) {
        throw new Error('Invalid cached block entry-file path.');
      }
      extensions.add(file.extension);
      return {
        path: file.path,
        extension: file.extension,
        ...(file.size !== undefined ? { size: file.size } : {}),
      };
    });
    return { name: block.name, files };
  });
  return {
    provider: record.provider,
    complete: true,
    blocks,
    coordinates,
    diagnostics: [],
    ...(record.revision !== undefined ? { revision: record.revision } : {}),
  };
}

export default async function discoverCachedBlocks({
  target, daFetch, fetchPublic, githubRepository = '', signal, forceRefresh = false,
}) {
  const selected = getProbeTarget(target);
  if (selected.environment !== 'prod') throw new Error('Inventory caching supports Production DA only.');
  signal?.throwIfAborted();
  const options = {
    org: selected.org,
    site: selected.site,
    ref: selected.branch,
    daFetch,
    fetchPublic,
    githubRepository,
    signal,
  };
  if (githubRepository.trim()) return discoverBlocks(options);
  const path = `/.da/block-library-generator/cache/blocks-${selected.branch}.json`;
  const url = `${selected.adminOrigin}/source/${selected.org}/${selected.site}${path}`;
  let read;
  let cached;
  let saved;
  let warning = '';
  try {
    read = await readLibraryText(daFetch, url, signal, /application\/json/i, { allowMissing: true });
    if (!read.missing) {
      saved = JSON.parse(read.text);
      cached = cachedInventory(saved, selected);
    }
  } catch (error) {
    signal?.throwIfAborted();
    warning = `The saved block list could not be read or is invalid: ${error.message}`;
  }
  const fromCache = (cacheWarning = '') => ({
    ...cached,
    cache: { fromCache: true, updatedAt: saved.updatedAt, path },
    cacheWarning,
  });
  if (cached && !forceRefresh) return fromCache();
  const fresh = await discoverBlocks(options);
  signal?.throwIfAborted();
  if (!fresh.complete) {
    if (cached) {
      return {
        ...fromCache('Block discovery refresh failed. The previous saved block list is still shown.'),
        diagnostics: fresh.diagnostics,
      };
    }
    return { ...fresh, cacheWarning: warning };
  }
  const updatedAt = new Date().toISOString();
  if (read?.missing || (read && forceRefresh)) {
    try {
      const record = {
        schemaVersion: 1,
        kind: 'block-inventory',
        target: { ...selected },
        updatedAt,
        provider: fresh.provider,
        complete: true,
        blocks: fresh.blocks,
        coordinates: fresh.coordinates,
        ...(fresh.revision !== undefined ? { revision: fresh.revision } : {}),
      };
      const normalized = cachedInventory(record, selected);
      record.blocks = normalized.blocks;
      record.coordinates = normalized.coordinates;
      await putLibrarySource(
        daFetch,
        selected,
        path,
        JSON.stringify(record, null, 2),
        'application/json',
        read.missing ? { 'If-None-Match': '*' } : { 'If-Match': strongLibraryETag(read.etag) },
        signal,
      );
      const back = await readLibraryJSON(daFetch, url, signal);
      if (JSON.stringify(back.value) !== JSON.stringify(record)) {
        throw new Error('The saved inventory readback does not match the discovered list.');
      }
      warning = '';
    } catch (error) {
      signal?.throwIfAborted();
      warning = `The block list is fresh for this session, but saving its shared cache was not confirmed: ${error.message}`;
    }
  } else if (read && !cached) {
    warning += ' Click Refresh blocks to replace the invalid saved list.';
  }
  return {
    ...fresh,
    cache: { fromCache: false, updatedAt, path },
    cacheWarning: warning,
  };
}
