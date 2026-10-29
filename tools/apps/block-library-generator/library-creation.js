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
import { getProbeTarget, requestBlockName, assertBlockName } from './jobs.js';
import {
  getCardsLibraryPaths, prepareCardsLibraryDryRun, readLibraryJSON, readLibraryText,
} from './library-dry-run.js';

const STATUSES = new Set([
  'creating-page', 'verifying-page', 'checking-index', 'updating-index',
  'verifying-index', 'checking-existing', 'completed', 'failed', 'partial',
]);
const FILE_STATES = new Set(['not-attempted', 'attempted', 'written', 'verified', 'unknown', 'different']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sourceRoot = (target) => `${target.adminOrigin}/source/${target.org}/${target.site}`;
const configURL = (target) => `${target.adminOrigin}/config/${target.org}/${target.site}`;

export async function hashLibraryContent(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function strongLibraryETag(value) {
  // Cloudflare can weaken a storage ETag when compressing a GET response.
  const normalized = value?.replace(/^W\//, '');
  if (!normalized || !/^"[^"\r\n]+"$/.test(normalized)) {
    throw new Error('A specific index ETag is required; refusing an unguarded write.');
  }
  return normalized;
}

function validateReceipt(receipt, environment) {
  const target = getProbeTarget(environment);
  if (!receipt || receipt.schemaVersion !== 1 || receipt.kind !== 'library-creation'
    || !receipt.target || Object.keys(target).some((key) => receipt.target[key] !== target[key])
    || typeof receipt.jobId !== 'string'
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.jobId)
    || !STATUSES.has(receipt.status) || !FILE_STATES.has(receipt.page)
    || (receipt.starter !== undefined && receipt.starter !== true)
    || !FILE_STATES.has(receipt.index) || typeof receipt.error !== 'string'
    || !/^[a-f0-9]{64}$/.test(receipt.expected?.page || '')
    || !/^[a-f0-9]{64}$/.test(receipt.expected?.index || '')) {
    throw new Error('Invalid library creation receipt for the selected environment.');
  }
  const paths = getCardsLibraryPaths({
    library: { data: [{ title: 'Blocks', path: receipt.destinations?.indexURL }] },
  }, target, assertBlockName(receipt.blockName || 'cards'));
  if (!same(paths, receipt.destinations)) throw new Error('Invalid creation receipt destinations.');
  return receipt;
}

function receiptKey(environment, blockName = 'cards') {
  const target = getProbeTarget(environment);
  assertBlockName(blockName);
  return `block-library-generator:creation:v2:${target.environment}:${target.org}:${target.site}:${target.branch}:${blockName}`;
}

export function saveCreationReceipt(storage, receipt) {
  validateReceipt(receipt, receipt?.target);
  storage.setItem(receiptKey(receipt.target, receipt.blockName || 'cards'), JSON.stringify(receipt));
}

export function loadCreationReceipt(storage, environment = 'stage', blockName = 'cards') {
  const target = getProbeTarget(environment);
  let text = storage.getItem(receiptKey(target, blockName));
  if (text === null && target.org === 'msagolj' && target.site === 'ew' && target.branch === 'main') {
    const key = `block-library-generator:creation:${target.environment}:msagolj:ew`;
    text = storage.getItem(blockName === 'cards' ? key : `${key}:${blockName}`);
  }
  if (text === null) return null;
  let receipt;
  try {
    receipt = JSON.parse(text);
  } catch (cause) {
    throw new Error('The saved library creation receipt is not valid JSON.', { cause });
  }
  validateReceipt(receipt, target);
  if ((receipt.blockName || 'cards') !== blockName) throw new Error('Creation receipt belongs to a different block.');
  return receipt;
}

export class LibraryCreationError extends Error {
  constructor(error, outcome) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'LibraryCreationError';
    this.outcome = clone(outcome);
  }
}

export async function putLibrarySource(daFetch, target, path, text, contentType, headers, signal) {
  const timeout = AbortSignal.timeout(15000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  combined.throwIfAborted();
  const body = new FormData();
  body.append('data', new Blob([text], { type: contentType }));
  const response = await daFetch(`${sourceRoot(target)}${path}`, {
    method: 'PUT', body, headers, cache: 'no-store', redirect: 'error', signal: combined,
  });
  combined.throwIfAborted();
  if (!response.ok) {
    throw new Error(`Conditional source write failed (HTTP ${response.status}): ${path}. No automatic retry.`);
  }
  await response.body?.cancel();
  combined.throwIfAborted();
}

async function verifyPage(daFetch, outcome, signal) {
  const read = await readLibraryText(
    daFetch,
    `${sourceRoot(outcome.target)}${outcome.destinations.pagePath}`,
    signal,
    /text\/html/i,
  );
  if (await hashLibraryContent(read.text) !== outcome.expected.page) {
    outcome.page = 'different';
    throw new Error('Example page readback does not match the approved HTML.');
  }
  outcome.page = 'verified';
}

async function verifyIndex(daFetch, outcome, signal) {
  const read = await readLibraryJSON(
    daFetch,
    `${sourceRoot(outcome.target)}${outcome.destinations.indexPath}`,
    signal,
  );
  if (await hashLibraryContent(JSON.stringify(read.value)) !== outcome.expected.index) {
    outcome.index = 'different';
    throw new Error('Library index readback does not match the approved preserved index.');
  }
  outcome.index = 'verified';
}

async function checkRegistration(daFetch, outcome, signal) {
  const { value } = await readLibraryJSON(daFetch, configURL(outcome.target), signal);
  if (!same(getCardsLibraryPaths(value, outcome.target, outcome.blockName || 'cards'), outcome.destinations)) {
    throw new Error('The Blocks registration changed; stop and review the current library.');
  }
}

export async function createBlockLibrary({
  daFetch, request, analysis, proposal, parseHTML, signal, onProgress, allowRegistered = false,
  starter = false,
}) {
  let outcome;
  try {
    if (typeof onProgress !== 'function') throw new Error('A durable pre-write receipt handler is required.');
    const fresh = await prepareCardsLibraryDryRun({
      daFetch, request, analysis, parseHTML, signal, allowRegistered, starter,
    });
    if (!proposal || proposal.mode !== 'dry-run' || proposal.writesPerformed !== 0
      || !same(fresh.target, proposal.target) || fresh.jobId !== proposal.jobId
      || fresh.starter !== proposal.starter
      || !same(fresh.destinations, proposal.destinations)
      || !same(fresh.operations, proposal.operations)) {
      throw new Error('The approved proposal no longer matches the draft or current library. Generate and review a new dry run.');
    }
    const page = fresh.operations[0];
    const index = fresh.operations[1];
    const indexURL = `${sourceRoot(request.target)}${index.sourcePath}`;
    const initial = await readLibraryJSON(daFetch, indexURL, signal);
    if (!same(initial.value, index.before)) throw new Error('The index changed after review; no content was written.');
    strongLibraryETag(initial.etag);
    outcome = {
      schemaVersion: 1,
      kind: 'library-creation',
      ...(starter ? { starter: true } : {}),
      jobId: request.jobId,
      blockName: requestBlockName(request),
      target: clone(request.target),
      destinations: clone(fresh.destinations),
      expected: {
        page: await hashLibraryContent(page.content),
        index: await hashLibraryContent(JSON.stringify(index.after)),
      },
      status: 'creating-page',
      page: 'not-attempted',
      index: 'not-attempted',
      error: '',
    };
    const progress = (values) => {
      Object.assign(outcome, values, { updatedAt: new Date().toISOString() });
      onProgress(clone(outcome));
      signal?.throwIfAborted();
    };
    progress({ status: 'creating-page', page: 'attempted' });
    await putLibrarySource(
      daFetch,
      request.target,
      page.sourcePath,
      page.content,
      'text/html',
      { 'If-None-Match': '*' },
      signal,
    );
    progress({ status: 'verifying-page', page: 'written' });
    await verifyPage(daFetch, outcome, signal);
    progress({ status: 'checking-index' });
    await checkRegistration(daFetch, outcome, signal);
    const latest = await readLibraryJSON(daFetch, indexURL, signal);
    if (!same(latest.value, index.before)) {
      throw new Error('The index changed after the page was created. Page retained; no index update attempted.');
    }

    const etag = strongLibraryETag(latest.etag);
    if (!same(index.before, index.after)) {
      progress({ status: 'updating-index', index: 'attempted' });
      await putLibrarySource(
        daFetch,
        request.target,
        index.sourcePath,
        JSON.stringify(index.after, null, 2),
        'application/json',
        { 'If-Match': etag },
        signal,
      );
      progress({ status: 'verifying-index', index: 'written' });
    }
    await verifyIndex(daFetch, outcome, signal);
    await verifyPage(daFetch, outcome, signal);
    await checkRegistration(daFetch, outcome, signal);
    progress({ status: 'completed' });
    return clone(outcome);
  } catch (error) {
    if (!outcome) throw error;
    outcome.status = outcome.page === 'not-attempted' ? 'failed' : 'partial';
    outcome.error = error instanceof Error ? error.message : String(error);
    throw new LibraryCreationError(error, outcome);
  }
}

export { createBlockLibrary as createCardsLibrary };

export async function checkLibraryCreation({ daFetch, receipt, signal }) {
  validateReceipt(receipt, receipt?.target);
  const outcome = {
    ...clone(receipt), status: 'checking-existing', page: 'unknown', index: 'unknown', error: '',
  };
  try {
    await checkRegistration(daFetch, outcome, signal);
    await verifyPage(daFetch, outcome, signal);
    await verifyIndex(daFetch, outcome, signal);
    outcome.status = 'completed';
    outcome.updatedAt = new Date().toISOString();
    return outcome;
  } catch (error) {
    outcome.status = 'partial';
    outcome.error = error instanceof Error ? error.message : String(error);
    throw new LibraryCreationError(error, outcome);
  }
}
