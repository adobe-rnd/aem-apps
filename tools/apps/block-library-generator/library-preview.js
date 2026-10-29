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
import { getBlockLibraryPaths } from './library-dry-run.js';
import { librarySourcePath } from './library-inventory.js';

const AEM_ADMIN = 'https://admin.hlx.page';
const copy = (value) => JSON.parse(JSON.stringify(value));

function libraryPaths(target, indexURL) {
  return getBlockLibraryPaths({ library: { data: [{ title: 'Blocks', path: indexURL }] } }, target);
}

function validateReceipt(receipt) {
  const target = getProbeTarget(receipt?.target);
  if (target.environment !== 'prod' || receipt.schemaVersion !== 1
    || receipt.kind !== 'library-preview'
    || !['pending', 'completed', 'failed'].includes(receipt.status)
    || typeof receipt.error !== 'string' || typeof receipt.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(receipt.updatedAt))) {
    throw new Error('Invalid Production library Preview outcome.');
  }
  const paths = libraryPaths(target, receipt.indexURL);
  if (receipt.blockName === null) {
    if (receipt.sourcePath !== paths.indexPath) throw new Error('Invalid index Preview destination.');
  } else {
    assertBlockName(receipt.blockName);
    const url = `${new URL(paths.indexURL).origin}/${target.org}/${target.site}${receipt.sourcePath}`;
    if (librarySourcePath(url, paths, target) !== receipt.sourcePath) {
      throw new Error('Invalid page Preview destination.');
    }
  }
}

function receiptKey(target, blockName) {
  const selected = getProbeTarget(target);
  if (blockName !== null) assertBlockName(blockName);
  const scope = blockName === null ? 'index' : `block:${blockName}`;
  return `block-library-generator:preview:v1:${selected.environment}:${selected.org}:${selected.site}:${selected.branch}:${scope}`;
}

export function saveLibraryPreviewReceipt(storage, receipt) {
  validateReceipt(receipt);
  storage.setItem(receiptKey(receipt.target, receipt.blockName), JSON.stringify(receipt));
}

export function clearLibraryPagePreviewReceipt(storage, target, blockName) {
  storage.removeItem(receiptKey(target, assertBlockName(blockName)));
}

export function loadLibraryPreviewReceipts(storage, target, blockName) {
  const scopes = blockName ? [null, assertBlockName(blockName)] : [null];
  return scopes.flatMap((scope) => {
    const text = storage.getItem(receiptKey(target, scope));
    if (text === null) return [];
    const receipt = JSON.parse(text);
    validateReceipt(receipt);
    if (JSON.stringify(receipt.target) !== JSON.stringify(getProbeTarget(target))
      || receipt.blockName !== scope) throw new Error('Preview outcome belongs to another target or block.');
    return [receipt];
  });
}

function previewFiles(completion) {
  if (completion?.status !== 'completed') throw new Error('Preview requires completed source verification.');
  const target = getProbeTarget(completion.target);
  if (target.environment !== 'prod') throw new Error('Automatic Preview supports Production DA only.');
  let pagePath;
  let blockName;
  let indexURL;
  if (completion.kind === 'library-setup') {
    if (!['verified', 'preserved'].includes(completion.index)
      || !['verified', 'preserved'].includes(completion.registration)) {
      throw new Error('Preview requires verified library setup.');
    }
    indexURL = completion.paths?.indexURL;
    if (libraryPaths(target, indexURL).indexPath !== completion.paths?.indexPath) {
      throw new Error('Index Preview does not match the verified setup.');
    }
  } else {
    if (completion.index !== 'verified') throw new Error('Preview requires a verified index.');
    if (completion.kind === 'library-creation') {
      indexURL = completion.destinations?.indexURL;
      blockName = assertBlockName(completion.blockName);
      const expected = getBlockLibraryPaths({
        library: { data: [{ title: 'Blocks', path: indexURL }] },
      }, target, blockName);
      if (JSON.stringify(expected) !== JSON.stringify(completion.destinations)) {
        throw new Error('Preview destinations differ from the verified creation.');
      }
      pagePath = completion.destinations.pagePath;
    } else if (['recreate', 'delete'].includes(completion.mode)) {
      indexURL = `https://content.da.live/${target.org}/${target.site}${completion.indexPath}`;
      if (libraryPaths(target, indexURL).indexPath !== completion.indexPath) {
        throw new Error('Invalid verified index Preview path.');
      }
      blockName = assertBlockName(completion.name);
      if (completion.mode === 'delete') {
        if (completion.page !== 'deleted') throw new Error('Preview requires verified page deletion.');
      } else {
        pagePath = completion.pagePath;
      }
    } else {
      throw new Error('Unsupported source operation for library Preview.');
    }
    if (pagePath && completion.page !== 'verified') throw new Error('Preview requires a verified saved page.');
    if (!pagePath && completion.mode !== 'delete') throw new Error('A verified page Preview path is required.');
  }
  const paths = libraryPaths(target, indexURL);
  const files = [
    ...(pagePath ? [{ blockName, sourcePath: pagePath }] : []),
    { blockName: null, sourcePath: paths.indexPath },
  ].map((file) => ({
    schemaVersion: 1,
    kind: 'library-preview',
    target: { ...target },
    indexURL,
    ...file,
    status: 'pending',
    error: '',
    updatedAt: new Date().toISOString(),
  }));
  files.forEach(validateReceipt);
  return files;
}

async function previewFile(daFetch, receipt, signal) {
  const { org, site, branch } = receipt.target;
  const path = receipt.sourcePath.replace(/\.html$/, '');
  const timeout = AbortSignal.timeout(15000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  combined.throwIfAborted();
  const options = { cache: 'no-store', redirect: 'error', signal: combined };
  const response = await daFetch(`${AEM_ADMIN}/preview/${org}/${site}/${branch}${path}`, {
    ...options, method: 'POST',
  });
  await response.body?.cancel();
  combined.throwIfAborted();
  if (!response.ok) throw new Error(`Preview failed (HTTP ${response.status}).`);
  if (response.status === 202) {
    throw new Error('Preview was accepted, but completion is not confirmed. Check its status in DA.');
  }
  const status = await daFetch(`${AEM_ADMIN}/status/${org}/${site}/${branch}${path}?editUrl=auto`, {
    ...options, method: 'GET',
  });
  if (!status.ok) {
    await status.body?.cancel();
    throw new Error(`Checking Preview failed (HTTP ${status.status}).`);
  }
  const data = await status.json();
  combined.throwIfAborted();
  if (data?.preview?.status !== 200) {
    throw new Error('The saved file does not have a successful Preview status.');
  }
}

export async function previewLibraryContent({
  daFetch, completion, signal, onProgress,
}) {
  const receipts = previewFiles(completion);
  if (typeof onProgress !== 'function') throw new Error('Durable Preview progress is required.');
  receipts.forEach((receipt) => onProgress(copy(receipt)));
  await receipts.reduce(async (previous, receipt) => {
    await previous;
    if (signal?.aborted) return;
    try {
      await previewFile(daFetch, receipt, signal);
      receipt.status = 'completed';
    } catch (error) {
      receipt.status = 'failed';
      receipt.error = error instanceof Error ? error.message : String(error);
    }
    receipt.updatedAt = new Date().toISOString();
    onProgress(copy(receipt));
  }, Promise.resolve());
  return receipts;
}
