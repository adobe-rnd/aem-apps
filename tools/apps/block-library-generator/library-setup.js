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
import { getBlockLibraryPaths, readLibraryJSON, validateLibraryIndex } from './library-dry-run.js';
import { putLibrarySource } from './library-creation.js';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const copy = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const configURL = (target) => `${target.adminOrigin}/config/${target.org}/${target.site}`;
const sourceURL = (target, path) => `${target.adminOrigin}/source/${target.org}/${target.site}${path}`;
const sheet = (data) => ({
  ':type': 'sheet', total: data.length, limit: data.length, offset: 0, data,
});

function libraryRows(config) {
  if (!object(config)
    || (config[':type'] !== undefined && config[':type'] !== 'multi-sheet')) {
    throw new Error('Unsupported site configuration; existing data will not be rebuilt.');
  }
  const names = config[':names'];
  if ((config[':type'] === 'multi-sheet' && !Array.isArray(names))
    || (names !== undefined && (!Array.isArray(names) || new Set(names).size !== names.length
      || names.some((name) => typeof name !== 'string' || !Object.hasOwn(config, name)
        || !object(config[name]))
      || (Object.hasOwn(config, 'library') && !names.includes('library'))))) {
    throw new Error('The site configuration has an incomplete or invalid sheet list.');
  }
  if (!Object.hasOwn(config, 'library')) return [];
  const { library } = config;
  if (!object(library) || !Array.isArray(library.data)
    || (library[':type'] !== undefined && library[':type'] !== 'sheet')
    || (library.total !== undefined && library.total !== library.data.length)
    || (library.offset !== undefined && library.offset !== 0)
    || (library.limit !== undefined && (!Number.isInteger(library.limit)
      || library.limit < library.data.length))
    || library.data.some((row) => !object(row)
      || (row.title !== undefined && typeof row.title !== 'string')
      || (row.path !== undefined && typeof row.path !== 'string'))) {
    throw new Error('The library configuration is partial or invalid; it will not be reset.');
  }
  return library.data;
}

function withRegistration(config, row) {
  const after = copy(config);
  if (!Array.isArray(after[':names'])) {
    after[':names'] = Object.keys(after).filter((key) => (
      object(after[key]) && Array.isArray(after[key].data)
    ));
    after[':type'] = 'multi-sheet';
  }
  if (!after.library) {
    after.library = sheet([row]);
    after[':names'].push('library');
  } else {
    const data = [...after.library.data, row];
    after.library = { ...after.library, data };
    if (after.library.total !== undefined) after.library.total = data.length;
    if (after.library.limit !== undefined) {
      after.library.limit = Math.max(after.library.limit, data.length);
    }
  }
  return after;
}

export async function inspectLibrarySetup({ daFetch, target, signal }) {
  signal?.throwIfAborted();
  const selected = getProbeTarget(target);
  const configRead = await readLibraryJSON(
    daFetch,
    configURL(selected),
    signal,
    { allowMissing: true },
  );
  const config = configRead.missing ? {} : configRead.value;
  const rows = libraryRows(config);
  const registrations = rows.filter((row) => row.title?.trim().toLowerCase() === 'blocks');
  if (registrations.length > 1) {
    throw new Error('Multiple Blocks registrations exist; setup cannot choose between them.');
  }
  const contentOrigin = selected.environment === 'prod' ? 'https://content.da.live' : 'https://stage-content.da.live';
  const defaultRow = {
    title: 'Blocks',
    path: `${contentOrigin}/${selected.org}/${selected.site}/docs/library/blocks.json`,
    experience: '',
    ref: '',
  };
  const paths = getBlockLibraryPaths(
    registrations.length ? config : { library: { data: [defaultRow] } },
    selected,
  );
  const indexRead = await readLibraryJSON(
    daFetch,
    sourceURL(selected, paths.indexPath),
    signal,
    { allowMissing: true },
  );
  if (!indexRead.missing) validateLibraryIndex(indexRead.value);
  const registerLibrary = registrations.length === 0;
  const createIndex = indexRead.missing === true;
  return {
    status: registerLibrary || createIndex ? 'required' : 'ready',
    target: { ...selected },
    paths,
    examplesDirectory: paths.pagePath.slice(0, paths.pagePath.lastIndexOf('/')),
    registerLibrary,
    createIndex,
    configExists: !configRead.missing,
    configBefore: configRead.missing ? null : config,
    configAfter: registerLibrary ? withRegistration(config, defaultRow) : config,
    indexBefore: indexRead.missing ? null : indexRead.value,
    indexAfter: createIndex ? sheet([]) : indexRead.value,
  };
}

export class LibrarySetupError extends Error {
  constructor(error, outcome) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'LibrarySetupError';
    this.outcome = copy(outcome);
  }
}

async function verifySetupIndex(daFetch, proposal, signal) {
  const read = await readLibraryJSON(
    daFetch,
    sourceURL(proposal.target, proposal.paths.indexPath),
    signal,
  );
  if (!same(read.value, proposal.indexAfter)) {
    throw new Error('The library index readback changed or does not match the confirmed setup.');
  }
}

export async function initializeBlockLibrary({
  daFetch, target, proposal, signal, onProgress, allowNonAtomicConfig = false,
}) {
  let outcome;
  try {
    const selected = getProbeTarget(target);
    if (!proposal || !same(proposal.target, selected)) throw new Error('The setup target changed. Refresh and review it again.');
    if (proposal.status !== 'required') throw new Error('The library is already ready; no initialization is needed.');
    if (typeof onProgress !== 'function') throw new Error('A durable setup progress handler is required.');
    if (proposal.registerLibrary && allowNonAtomicConfig !== true) {
      throw new Error('Configuration registration requires explicit non-atomic confirmation. Avoid concurrent configuration edits.');
    }
    const fresh = await inspectLibrarySetup({ daFetch, target: selected, signal });
    if (!same(fresh, proposal)) throw new Error('The configuration or index changed since confirmation. Refresh and review the setup.');
    outcome = {
      schemaVersion: 1,
      kind: 'library-setup',
      target: { ...selected },
      paths: copy(proposal.paths),
      status: 'initializing',
      index: proposal.createIndex ? 'not-attempted' : 'preserved',
      registration: proposal.registerLibrary ? 'not-attempted' : 'preserved',
      nonAtomicConfig: proposal.registerLibrary,
      error: '',
    };
    const progress = (fields) => {
      Object.assign(outcome, fields, { updatedAt: new Date().toISOString() });
      onProgress(copy(outcome));
      signal?.throwIfAborted();
    };
    progress({});
    if (proposal.createIndex) {
      progress({ status: 'creating-index', index: 'attempted' });
      await putLibrarySource(
        daFetch,
        selected,
        proposal.paths.indexPath,
        JSON.stringify(proposal.indexAfter, null, 2),
        'application/json',
        { 'If-None-Match': '*' },
        signal,
      );
      progress({ status: 'verifying-index', index: 'written' });
      await verifySetupIndex(daFetch, proposal, signal);
      progress({ index: 'verified' });
    }
    if (proposal.registerLibrary) {
      await verifySetupIndex(daFetch, proposal, signal);
      const latest = await readLibraryJSON(
        daFetch,
        configURL(selected),
        signal,
        { allowMissing: true },
      );
      if ((!latest.missing) !== proposal.configExists
        || !same(latest.value, proposal.configBefore)) {
        throw new Error('Configuration changed immediately before registration. No config was written.');
      }
      progress({ status: 'registering', registration: 'attempted' });
      const body = new FormData();
      body.append('config', JSON.stringify(proposal.configAfter));
      const timeout = AbortSignal.timeout(15000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      combined.throwIfAborted();
      const response = await daFetch(configURL(selected), {
        method: 'POST', body, cache: 'no-store', redirect: 'error', signal: combined,
      });
      await response.body?.cancel();
      combined.throwIfAborted();
      if (!response.ok) throw new Error(`Saving the Blocks registration failed (HTTP ${response.status}). No automatic retry.`);
      progress({ status: 'verifying', registration: 'written' });
    }
    const final = await inspectLibrarySetup({ daFetch, target: selected, signal });
    if (final.status !== 'ready' || !same(final.paths, proposal.paths)
      || !same(final.indexBefore, proposal.indexAfter)
      || (proposal.registerLibrary && !same(final.configBefore, proposal.configAfter))) {
      throw new Error('Setup readback did not match the confirmed configuration/index. Inspect the retained outcome before retrying.');
    }
    progress({
      status: 'completed',
      index: proposal.createIndex ? 'verified' : 'preserved',
      registration: proposal.registerLibrary ? 'verified' : 'preserved',
    });
    return copy(outcome);
  } catch (error) {
    if (!outcome) throw error;
    outcome.status = [outcome.index, outcome.registration].includes('attempted')
      || ['written', 'verified'].some((state) => [outcome.index, outcome.registration].includes(state))
      ? 'partial' : 'failed';
    outcome.error = error instanceof Error ? error.message : String(error);
    throw new LibrarySetupError(error, outcome);
  }
}

function receiptKey(target) {
  const selected = getProbeTarget(target);
  return `block-library-generator:setup:v1:${selected.environment}:${selected.org}:${selected.site}:${selected.branch}`;
}

function validateReceipt(receipt, target) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.kind !== 'library-setup'
    || !same(receipt.target, getProbeTarget(target))
    || !['initializing', 'creating-index', 'verifying-index', 'registering', 'verifying',
      'completed', 'partial', 'failed'].includes(receipt.status)
    || !['preserved', 'not-attempted', 'attempted', 'written', 'verified'].includes(receipt.index)
    || !['preserved', 'not-attempted', 'attempted', 'written', 'verified'].includes(receipt.registration)
    || typeof receipt.error !== 'string' || typeof receipt.nonAtomicConfig !== 'boolean') {
    throw new Error('Invalid saved library setup outcome.');
  }
  const paths = getBlockLibraryPaths({
    library: { data: [{ title: 'Blocks', path: receipt.paths?.indexURL }] },
  }, target);
  if (!same(paths, receipt.paths)) throw new Error('Invalid saved library setup paths.');
}

export function saveLibrarySetupReceipt(storage, receipt) {
  validateReceipt(receipt, receipt?.target);
  storage.setItem(receiptKey(receipt.target), JSON.stringify(receipt));
}

export function loadLibrarySetupReceipt(storage, target) {
  const text = storage.getItem(receiptKey(target));
  if (text === null) return null;
  const receipt = JSON.parse(text);
  validateReceipt(receipt, target);
  return receipt;
}
