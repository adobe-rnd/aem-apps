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
  getCardsLibraryPaths, readLibraryJSON, readLibraryText, readLibraryResource, validateLibraryIndex,
} from './library-dry-run.js';
import { librarySourcePath } from './library-inventory.js';
import {
  hashLibraryContent, strongLibraryETag, putLibrarySource,
} from './library-creation.js';
import { getProbeTarget } from './jobs.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (value) => JSON.parse(JSON.stringify(value));
const root = (target) => `${target.adminOrigin}/source/${target.org}/${target.site}`;

export async function prepareLibraryAction({
  daFetch, target, name, pagePath, signal, expectedPaths,
}) {
  const expected = getProbeTarget(target);
  if (!target || Object.keys(expected).some((key) => target[key] !== expected[key])) {
    throw new Error('Library action target does not match the supported site/environment.');
  }
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Invalid library block name.');
  }
  const config = await readLibraryJSON(
    daFetch,
    `${target.adminOrigin}/config/${target.org}/${target.site}`,
    signal,
  );
  const paths = getCardsLibraryPaths(config.value, target);
  if (expectedPaths && !same(paths, expectedPaths)) throw new Error('The library registration changed.');
  const base = `${new URL(paths.indexURL).origin}/${target.org}/${target.site}`;
  if (typeof pagePath !== 'string' || !pagePath.endsWith('.html')
    || librarySourcePath(`${base}${pagePath}`, paths, target) !== pagePath) {
    throw new Error('Invalid example page destination.');
  }
  const [index, page] = await Promise.all([
    readLibraryJSON(daFetch, `${root(target)}${paths.indexPath}`, signal),
    readLibraryText(daFetch, `${root(target)}${pagePath}`, signal, /text\/html/i),
  ]);
  validateLibraryIndex(index.value);
  const matches = index.value.data.filter((row) => (
    librarySourcePath(row.path, paths, target) === pagePath
  ));
  if (index.value.data.some((row) => row.name.trim().toLowerCase() === name
    && librarySourcePath(row.path, paths, target) !== pagePath)) {
    throw new Error('This block name is already registered at another destination.');
  }
  const conventional = `${paths.pagePath.slice(0, paths.pagePath.lastIndexOf('/'))}/${name}.html`;
  if (matches.length > 1 || (!matches.length && pagePath !== conventional)) {
    throw new Error('The example page is ambiguous or not a registered/conventional library destination.');
  }
  return {
    target: copy(target),
    name,
    pagePath,
    paths,
    registered: matches.length === 1,
    index: index.value,
    indexETag: strongLibraryETag(index.etag),
    pageETag: page.etag ? strongLibraryETag(page.etag) : null,
    pageHash: await hashLibraryContent(page.text),
  };
}

async function freshSnapshot(options) {
  const { snapshot } = options;
  if (!snapshot) throw new Error('A confirmed current page snapshot is required.');
  const fresh = await prepareLibraryAction({
    ...options,
    target: snapshot.target,
    name: snapshot.name,
    pagePath: snapshot.pagePath,
    expectedPaths: snapshot.paths,
  });
  if (!same(fresh, snapshot)) throw new Error('The page, index or registration changed. Review the action again.');
  return fresh;
}

async function runAction(options, mode) {
  let outcome;
  try {
    if (typeof options.onProgress !== 'function') throw new Error('A durable action receipt handler is required.');
    const snapshot = await freshSnapshot(options);
    if (mode === 'recreate' && !snapshot.pageETag && options.allowNonAtomicReplace !== true) {
      throw new Error('Replacement without a page ETag requires explicit non-atomic confirmation.');
    }
    const { target, pagePath, paths } = snapshot;
    const progress = (fields) => {
      Object.assign(outcome, fields, { updatedAt: new Date().toISOString() });
      options.onProgress(copy(outcome));
      options.signal?.throwIfAborted();
    };
    outcome = {
      mode,
      target,
      name: snapshot.name,
      pagePath,
      indexPath: paths.indexPath,
      status: 'running',
      page: 'not-attempted',
      index: 'not-attempted',
      error: '',
    };
    progress({ page: 'attempted' });
    if (mode === 'delete') {
      // DA DELETE currently has no atomic If-Match support; this is the final conflict check.
      const latest = await readLibraryText(
        options.daFetch,
        `${root(target)}${pagePath}`,
        options.signal,
        /text\/html/i,
      );
      if (await hashLibraryContent(latest.text) !== snapshot.pageHash
        || (snapshot.pageETag && (!latest.etag
          || strongLibraryETag(latest.etag) !== snapshot.pageETag))) {
        throw new Error('The page changed immediately before deletion; nothing was deleted.');
      }
      const timeout = AbortSignal.timeout(15000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      signal.throwIfAborted();
      const response = await options.daFetch(`${root(target)}${pagePath}`, {
        method: 'DELETE', cache: 'no-store', redirect: 'error', signal,
      });
      signal.throwIfAborted();
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Example deletion failed (HTTP ${response.status}).`);
      const readback = await readLibraryResource(options.daFetch, `${root(target)}${pagePath}`, options.signal);
      await readback.response.body?.cancel();
      if (readback.response.status !== 404) throw new Error('The example still exists or deletion could not be verified.');
      progress({ page: 'deleted' });
    } else {
      if (typeof options.html !== 'string' || !options.html.trim()) throw new Error('Replacement HTML is required.');
      const latest = await readLibraryText(
        options.daFetch,
        `${root(target)}${pagePath}`,
        options.signal,
        /text\/html/i,
      );
      if (await hashLibraryContent(latest.text) !== snapshot.pageHash) {
        throw new Error('The page changed immediately before replacement; nothing was replaced.');
      }
      // Some DA HTML reads omit ETags. The UI explicitly confirms the non-atomic hash-check mode.
      const headers = snapshot.pageETag ? { 'If-Match': snapshot.pageETag } : {};
      await putLibrarySource(
        options.daFetch,
        target,
        pagePath,
        options.html,
        'text/html',
        headers,
        options.signal,
      );
      const page = await readLibraryText(options.daFetch, `${root(target)}${pagePath}`, options.signal, /text\/html/i);
      if (page.text !== options.html) throw new Error('Replacement page readback does not match.');
      progress({ page: 'verified' });
    }
    const config = await readLibraryJSON(
      options.daFetch,
      `${target.adminOrigin}/config/${target.org}/${target.site}`,
      options.signal,
    );
    if (!same(getCardsLibraryPaths(config.value, target), paths)) {
      throw new Error('Library registration changed after the page action; index was not changed.');
    }
    const current = await readLibraryJSON(options.daFetch, `${root(target)}${paths.indexPath}`, options.signal);
    if (!same(current.value, snapshot.index)) throw new Error('The index changed after the page action; manual reconciliation is required.');
    const data = mode === 'delete'
      ? current.value.data.filter((row) => librarySourcePath(row.path, paths, target) !== pagePath)
      : [...current.value.data];
    if (mode === 'recreate' && !snapshot.registered) {
      if (data.some((row) => row.name.trim().toLowerCase() === snapshot.name)) {
        throw new Error('An index name conflict prevents registering the replacement.');
      }
      data.push({
        name: snapshot.name.charAt(0).toUpperCase() + snapshot.name.slice(1),
        path: `${new URL(paths.indexURL).origin}/${target.org}/${target.site}${pagePath.slice(0, -5)}`,
      });
    }
    const after = {
      ...current.value, data, total: data.length, limit: Math.max(data.length, current.value.limit),
    };
    if (!same(after, current.value)) {
      progress({ index: 'attempted' });
      await putLibrarySource(
        options.daFetch,
        target,
        paths.indexPath,
        JSON.stringify(after, null, 2),
        'application/json',
        { 'If-Match': strongLibraryETag(current.etag) },
        options.signal,
      );
    }
    const indexReadback = await readLibraryJSON(options.daFetch, `${root(target)}${paths.indexPath}`, options.signal);
    if (!same(indexReadback.value, after)) throw new Error('Index readback does not match the preserved index.');
    if (mode === 'delete') {
      const finalPage = await readLibraryResource(options.daFetch, `${root(target)}${pagePath}`, options.signal);
      await finalPage.response.body?.cancel();
      if (finalPage.response.status !== 404) {
        throw new Error('The deleted page reappeared or final absence could not be verified.');
      }
    } else {
      const finalPage = await readLibraryText(
        options.daFetch,
        `${root(target)}${pagePath}`,
        options.signal,
        /text\/html/i,
      );
      if (finalPage.text !== options.html) {
        throw new Error('The replacement page changed before final verification.');
      }
    }
    progress({ status: 'completed', index: 'verified' });
    return copy(outcome);
  } catch (cause) {
    if (!outcome) throw cause;
    outcome.status = 'partial';
    outcome.error = cause instanceof Error ? cause.message : String(cause);
    const error = new Error(outcome.error, { cause });
    error.outcome = copy(outcome);
    throw error;
  }
}

export function deleteLibraryPage(options) {
  return runAction(options, 'delete');
}

export function replaceLibraryPage(options) {
  return runAction(options, 'recreate');
}
