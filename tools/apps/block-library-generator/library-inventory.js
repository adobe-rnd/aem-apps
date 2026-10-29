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
import {
  readLibraryResource,
} from './library-dry-run.js';
import { getProbeTarget } from './jobs.js';
import { inspectLibrarySetup } from './library-setup.js';

export function librarySourcePath(value, paths, target) {
  const url = new URL(value, paths.indexURL);
  const root = `/${target.org}/${target.site}`;
  if (url.origin !== new URL(paths.indexURL).origin || !url.pathname.startsWith(`${root}/`)
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Library example must belong to the selected site and environment.');
  }
  let path = url.pathname.slice(root.length).replace(/\/$/, '');
  if (!/^\/[a-z0-9/_-]+(?:\.html)?$/i.test(path) || path.includes('//')) {
    throw new Error('Unsupported library example source path.');
  }
  if (!path.endsWith('.html')) path += '.html';
  return path;
}

export default async function inspectBlockLibrary({
  daFetch, target, blockNames, codeComplete = false, signal,
}) {
  signal?.throwIfAborted();
  const expected = getProbeTarget(target);
  if (!target || Object.keys(expected).some((key) => target[key] !== expected[key])) {
    throw new Error('Library status target does not match the supported test site.');
  }
  if (!Array.isArray(blockNames)
    || blockNames.some((name) => typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))) {
    throw new Error('Invalid block names for library inspection.');
  }
  const setup = await inspectLibrarySetup({ daFetch, target, signal });
  const { paths } = setup;
  if (setup.status === 'required') {
    return {
      paths,
      setup,
      blocks: Object.fromEntries(blockNames.map((name) => [name, {
        name, displayName: name, status: 'setup-required', codeStatus: 'present',
      }])),
    };
  }
  const root = `${target.adminOrigin}/source/${target.org}/${target.site}`;
  const index = setup.indexBefore;
  const directory = paths.pagePath.slice(0, paths.pagePath.lastIndexOf('/'));
  const rows = index.data.map((row) => {
    let path;
    let error;
    try {
      path = librarySourcePath(row.path, paths, target);
    } catch (cause) {
      error = cause.message;
    }
    const labelName = row.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fileName = path?.split('/').at(-1).replace(/\.html$/, '');
    const name = blockNames.includes(labelName) ? labelName : fileName || labelName;
    return {
      name, row, path, error,
    };
  });
  const names = [...new Set([...blockNames, ...rows.map((row) => row.name)])].sort();
  const entries = await Promise.all(names.map(async (name) => {
    const hasCode = blockNames.includes(name);
    let codeStatus = hasCode ? 'present' : 'unknown';
    if (!hasCode && codeComplete) codeStatus = 'missing';
    const matches = rows.filter((row) => row.name === name);
    try {
      if (matches.length > 1) throw new Error('Multiple library entries match this block.');
      if (matches[0]?.error) throw new Error(matches[0].error);
      const path = matches.length ? matches[0].path : `${directory}/${name}.html`;
      const read = await readLibraryResource(daFetch, `${root}${path}`, signal);
      await read.response.body?.cancel();
      read.signal.throwIfAborted();
      const exists = read.response.ok;
      if (!exists && read.response.status !== 404) {
        throw new Error(`Library page check failed (HTTP ${read.response.status}).`);
      }
      let status = exists ? 'unregistered' : 'absent';
      if (matches.length) status = exists ? 'existing' : 'missing-page';
      const environment = target.environment === 'prod' ? 'prod' : 'stage';
      return [name, {
        status,
        registered: Boolean(matches.length),
        pagePath: path,
        pageStatus: read.response.status,
        codeStatus,
        name,
        displayName: matches[0]?.row.name || name,
        editorURL: `https://da.live/canvas?da-admin=${environment}&da-collab=${environment}#/${target.org}/${target.site}${path.slice(0, -5)}`,
      }];
    } catch (error) {
      signal?.throwIfAborted();
      return [name, {
        name,
        codeStatus,
        displayName: matches[0]?.row.name || name,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }];
    }
  }));
  signal?.throwIfAborted();
  return { paths, setup, blocks: Object.fromEntries(entries) };
}
