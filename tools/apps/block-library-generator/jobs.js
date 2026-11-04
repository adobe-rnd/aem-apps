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
export const PROBE_TARGETS = Object.freeze({
  stage: Object.freeze({
    environment: 'stage',
    org: 'msagolj',
    site: 'ew',
    branch: 'main',
    adminOrigin: 'https://stage-admin.da.live',
  }),
  prod: Object.freeze({
    environment: 'prod',
    org: 'msagolj',
    site: 'ew',
    branch: 'main',
    adminOrigin: 'https://admin.da.live',
  }),
});

export const PROBE_MARKER = 'block-library-round-trip-ok';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasTarget(target, expected) {
  return target && Object.keys(target).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => target[key] === value);
}

export function getProbeTarget(environment, coordinates) {
  if (environment && typeof environment === 'object') {
    const expected = getProbeTarget(environment.environment, environment);
    if (!hasTarget(environment, expected)) throw new Error('Invalid site target or DA service origin.');
    return expected;
  }
  if (typeof environment !== 'string' || !Object.hasOwn(PROBE_TARGETS, environment)) {
    throw new Error('Unsupported probe environment. Choose Stage or Production explicitly.');
  }
  if (coordinates === undefined) return PROBE_TARGETS[environment];
  const { org, site, branch = 'main' } = coordinates;
  if ([org, site].some((value) => typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    || typeof branch !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(branch)) {
    throw new Error('Invalid site target. Use organization, site and a URL-safe code branch.');
  }
  return {
    environment, org, site, branch, adminOrigin: PROBE_TARGETS[environment].adminOrigin,
  };
}

export function assertBlockName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Invalid block name.');
  }
  return name;
}

export function requestBlockName(request) {
  if (request?.kind === 'cards') return 'cards';
  if (request?.kind !== 'analysis') throw new Error('Expected a block analysis request.');
  return assertBlockName(request.input?.blockName);
}

function resumeKey(environment, kind, blockName) {
  const target = getProbeTarget(environment);
  if (!['probe', 'cards', 'analysis'].includes(kind)) throw new Error('Invalid job kind.');
  const base = `block-library-generator:${kind}:v1:${target.environment}:${target.org}:${target.site}:${target.branch}`;
  return kind === 'analysis' ? `${base}:${assertBlockName(blockName)}` : base;
}

function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) {
    throw new Error('Invalid probe job ID.');
  }
}

export function getProbeBlockReason({
  context = {}, actions = {}, embedded = false, hasToken = false, environment = 'stage',
}) {
  const target = getProbeTarget(environment);
  const label = environment === 'prod' ? 'Production' : 'Stage';
  if (!embedded || !['edit', 'canvas'].includes(context.view) || !context.path?.startsWith('/')) {
    return `Open this app from the ${label} editor to use the probe. Direct and Apps launches are read-only.`;
  }
  if (context.org !== target.org || context.site !== target.site) {
    return `This proof is restricted to the ${label} msagolj/ew target.`;
  }
  if (context.branch && context.branch !== target.branch) {
    return 'The supplied site code branch is not main.';
  }
  if (context.daOrigin && context.daOrigin !== target.adminOrigin) {
    return `The supplied DA origin does not match ${label}. No environment fallback is allowed.`;
  }
  if (!hasToken) return 'No session token was supplied. The probe requires an authenticated editor.';
  if (['daFetch', 'setPrompt', 'closeLibrary'].some((name) => typeof actions[name] !== 'function')) {
    return 'The required SDK actions are unavailable.';
  }
  return '';
}

export function createJobRequest({
  jobId = crypto.randomUUID(), createdAt = new Date().toISOString(), target,
  environment = target?.environment || 'stage',
  kind, input,
} = {}) {
  const resolved = target ? getProbeTarget(target) : getProbeTarget(environment);
  if (resolved.environment !== environment) throw new Error('The target environment does not match.');
  if (!['probe', 'cards', 'analysis'].includes(kind)) throw new Error('Invalid job kind.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid job input.');
  if (kind === 'analysis' && input.blockName !== undefined) assertBlockName(input.blockName);
  assertJobId(jobId);
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error('Invalid probe request creation time.');
  }
  const root = `/.da/block-library-generator/jobs/${jobId}`;
  return {
    schemaVersion: 1,
    jobId,
    kind,
    target: { ...resolved },
    createdAt,
    requestPath: `${root}/request.json`,
    resultPath: `${root}/result.json`,
    input,
  };
}

export function createProbeRequest(options = {}) {
  return createJobRequest({ ...options, kind: 'probe', input: { message: PROBE_MARKER } });
}

export function validateJobRequest(value, environment, kind, target) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid probe request.');
  }
  assertJobId(value.jobId);
  const expectedEnvironment = environment ?? value.target?.environment;
  const expectedKind = kind ?? value.kind;
  const expected = createJobRequest({
    jobId: value.jobId,
    createdAt: value.createdAt,
    environment: expectedEnvironment,
    target: target || value.target,
    kind: expectedKind,
    input: value.input,
  });
  if (value.schemaVersion !== 1 || value.kind !== expectedKind
    || !hasTarget(value.target, expected.target) || value.createdAt !== expected.createdAt
    || value.requestPath !== expected.requestPath || value.resultPath !== expected.resultPath) {
    throw new Error('Probe request identity, target, or path does not match this proof.');
  }
  return value;
}

function validateProbeRequest(value) {
  validateJobRequest(value, value?.target?.environment, 'probe');
  if (value.input.message !== PROBE_MARKER) throw new Error('Invalid probe request marker.');
  return value;
}

async function fetchSource(daFetch, target, path, { signal, ...options } = {}) {
  const timeout = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  requestSignal.throwIfAborted();
  const url = `${target.adminOrigin}/source/${target.org}/${target.site}${path}`;
  const response = await daFetch(url, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'error',
    ...options,
    signal: requestSignal,
  });
  requestSignal.throwIfAborted();
  return response;
}

function assertResponse(response, operation) {
  if (!response.ok) {
    throw new Error(`${operation} failed (HTTP ${response.status}). Check the selected environment's access and connectivity.`);
  }
}

async function readJSON(response) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
    throw new Error('Probe JSON exceeds the 1 MiB limit.');
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error('The source response is not valid JSON.', { cause });
  }
}

export async function readJobRequest(daFetch, jobId, {
  target: selectedTarget, environment = selectedTarget?.environment || 'stage', kind = 'probe', ...options
} = {}) {
  const { requestPath, target } = createJobRequest({
    jobId, environment, target: selectedTarget, kind, input: {},
  });
  const response = await fetchSource(daFetch, target, requestPath, options);
  assertResponse(response, 'Reading the probe request');
  const value = validateJobRequest(await readJSON(response), environment, kind, target);
  if (value.jobId !== jobId) throw new Error('Probe request job identity does not match.');
  return value;
}

export async function readProbeRequest(daFetch, jobId, options = {}) {
  return validateProbeRequest(await readJobRequest(daFetch, jobId, options));
}

export async function persistJobRequest(daFetch, request, options = {}) {
  validateJobRequest(request);
  const target = getProbeTarget(request.target);
  const existing = await fetchSource(daFetch, target, request.requestPath, options);
  if (existing.ok) throw new Error('This probe request already exists; refusing to overwrite it.');
  if (existing.status !== 404) assertResponse(existing, 'Checking the probe request destination');

  const body = new FormData();
  body.append('data', new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
  const response = await fetchSource(daFetch, target, request.requestPath, {
    ...options, method: 'PUT', body,
  });
  assertResponse(response, 'Writing the probe request');
  const stored = await readJobRequest(daFetch, request.jobId, {
    ...options, target, environment: target.environment, kind: request.kind,
  });
  if (JSON.stringify(stored) !== JSON.stringify(request)) {
    throw new Error('Probe request readback does not match the written request.');
  }
  return stored;
}

export async function persistProbeRequest(daFetch, request, options = {}) {
  validateProbeRequest(request);
  return persistJobRequest(daFetch, request, options);
}

export async function readJobResult(daFetch, request, options = {}) {
  validateJobRequest(request);
  const target = getProbeTarget(request.target);
  const response = await fetchSource(daFetch, target, request.resultPath, options);
  if (response.status === 404) return null;
  assertResponse(response, 'Reading the probe result');
  const value = await readJSON(response);
  if (value?.schemaVersion !== 1 || value.jobId !== request.jobId || value.kind !== request.kind
    || !hasTarget(value.target, target)) {
    throw new Error('Probe result identity or target does not match the saved request.');
  }
  if (value.status === 'completed') {
    if (!value.payload || typeof value.payload !== 'object'
      || Array.isArray(value.payload) || value.error !== undefined) {
      throw new Error('The completed result has an invalid payload or unexpected error.');
    }
  } else if (value.status === 'error') {
    if (typeof value.error !== 'string' || !value.error.trim() || value.payload !== undefined) {
      throw new Error('The probe error result must contain an error, not a success payload.');
    }
  } else {
    throw new Error('The probe result has no supported final status.');
  }
  return value;
}

export async function readProbeResult(daFetch, request, options = {}) {
  validateProbeRequest(request);
  const value = await readJobResult(daFetch, request, options);
  if (value?.status === 'completed' && value.payload.message !== PROBE_MARKER) {
    throw new Error('The completed probe result has an invalid marker.');
  }
  return value;
}

export function loadJobPointer(storage, environment = 'stage', kind = 'probe', blockName = null) {
  const text = storage.getItem(resumeKey(environment, kind, blockName));
  if (text === null) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error('The saved probe resume pointer is not valid JSON.', { cause });
  }
  assertJobId(value?.jobId);
  if (typeof value.handoffRequested !== 'boolean') {
    throw new Error('The saved probe resume pointer has an invalid handoff flag.');
  }
  return { jobId: value.jobId, handoffRequested: value.handoffRequested };
}

export function loadProbePointer(storage, environment = 'stage') {
  return loadJobPointer(storage, environment, 'probe');
}

export function saveJobPointer(storage, request, handoffRequested = false) {
  validateJobRequest(request);
  if (typeof handoffRequested !== 'boolean') throw new Error('Invalid probe handoff flag.');
  storage.setItem(
    resumeKey(
      request.target,
      request.kind,
      request.kind === 'analysis' ? requestBlockName(request) : undefined,
    ),
    JSON.stringify({ jobId: request.jobId, handoffRequested }),
  );
}

export function saveProbePointer(storage, request, handoffRequested = false) {
  validateProbeRequest(request);
  saveJobPointer(storage, request, handoffRequested);
}

function cleanupKey(target, jobId) {
  const selected = getProbeTarget(target);
  assertJobId(jobId);
  return `block-library-generator:cleanup:v1:${selected.environment}:${selected.org}:${selected.site}:${selected.branch}:${jobId}`;
}

function validateCleanupReceipt(receipt, target, jobId) {
  const fields = ['schemaVersion', 'kind', 'target', 'jobId', 'jobKind', 'blockName',
    'status', 'request', 'result', 'error', 'updatedAt'];
  if (!receipt || receipt.schemaVersion !== 1 || receipt.kind !== 'job-cleanup'
    || !hasTarget(receipt.target, getProbeTarget(target)) || receipt.jobId !== jobId
    || !['analysis', 'cards'].includes(receipt.jobKind)
    || !['checking', 'deleting-result', 'deleting-request', 'completed', 'failed'].includes(receipt.status)
    || !['pending', 'attempted', 'absent'].includes(receipt.request)
    || !['pending', 'attempted', 'absent'].includes(receipt.result)
    || (receipt.status === 'completed' && (receipt.request !== 'absent' || receipt.result !== 'absent'))
    || typeof receipt.error !== 'string' || !Number.isFinite(Date.parse(receipt.updatedAt))
    || Object.keys(receipt).some((field) => !fields.includes(field))) {
    throw new Error('Invalid saved analysis cleanup outcome.');
  }
  assertBlockName(receipt.blockName);
  if (receipt.jobKind === 'cards' && receipt.blockName !== 'cards') {
    throw new Error('The saved cleanup outcome belongs to a different block.');
  }
}

export function saveJobCleanupReceipt(storage, receipt) {
  validateCleanupReceipt(receipt, receipt?.target, receipt?.jobId);
  storage.setItem(cleanupKey(receipt.target, receipt.jobId), JSON.stringify(receipt));
}

export function loadJobCleanupReceipt(storage, target, jobId) {
  const text = storage.getItem(cleanupKey(target, jobId));
  if (text === null) return null;
  const receipt = JSON.parse(text);
  validateCleanupReceipt(receipt, target, jobId);
  return receipt;
}

export class JobCleanupError extends Error {
  constructor(error, outcome) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = 'JobCleanupError';
    this.outcome = JSON.parse(JSON.stringify(outcome));
  }
}

export async function cleanupCompletedAnalysisJob({
  daFetch, request, completion, storage, onProgress, signal,
}) {
  let outcome;
  try {
    validateJobRequest(request);
    const blockName = requestBlockName(request);
    const create = completion?.kind === 'library-creation' && !completion.mode;
    const recreate = completion?.mode === 'recreate' && !completion.kind;
    if ((!create && !recreate) || completion.status !== 'completed'
      || completion.page !== 'verified' || completion.index !== 'verified'
      || completion.jobId !== request.jobId || !hasTarget(completion.target, request.target)
      || (completion.blockName || completion.name || 'cards') !== blockName) {
      throw new Error('Analysis cleanup requires this job\'s verified successful page and index outcome.');
    }
    if (typeof onProgress !== 'function' || typeof storage?.removeItem !== 'function') {
      throw new Error('Durable cleanup progress and matching-pointer storage are required.');
    }
    outcome = {
      schemaVersion: 1,
      kind: 'job-cleanup',
      target: { ...request.target },
      jobId: request.jobId,
      jobKind: request.kind,
      blockName,
      status: 'checking',
      request: 'pending',
      result: 'pending',
      error: '',
    };
    const progress = (fields) => {
      Object.assign(outcome, fields, { updatedAt: new Date().toISOString() });
      onProgress(JSON.parse(JSON.stringify(outcome)));
      signal?.throwIfAborted();
    };
    progress({});
    const savedRequest = await fetchSource(
      daFetch,
      request.target,
      request.requestPath,
      { signal },
    );
    if (savedRequest.status === 404) {
      await savedRequest.body?.cancel();
      outcome.request = 'absent';
    } else {
      assertResponse(savedRequest, 'Checking the completed analysis request');
      const value = validateJobRequest(
        await readJSON(savedRequest),
        request.target.environment,
        request.kind,
        request.target,
      );
      if (JSON.stringify(value) !== JSON.stringify(request)) {
        throw new Error('The saved analysis request changed. No job files were removed.');
      }
    }
    const savedResult = await readJobResult(daFetch, request, { signal });
    if (!savedResult) outcome.result = 'absent';
    else if (savedResult.status !== 'completed'
      || savedResult.payload.analysis?.blockName !== blockName
      || savedResult.payload.analysis?.generation?.status === 'blocked') {
      throw new Error('The saved analysis result is not this block\'s completed usable output.');
    }
    const removeFile = async (name, path) => {
      if (outcome[name] === 'absent') return;
      progress({ status: `deleting-${name}`, [name]: 'attempted' });
      const response = await fetchSource(daFetch, request.target, path, { method: 'DELETE', signal });
      await response.body?.cancel();
      if (response.status !== 404) assertResponse(response, `Removing the completed analysis ${name}`);
      const readback = await fetchSource(daFetch, request.target, path, { signal });
      await readback.body?.cancel();
      if (readback.status !== 404) {
        throw new Error(`The analysis ${name} still exists or its absence could not be verified (HTTP ${readback.status}).`);
      }
      progress({ [name]: 'absent' });
    };
    await removeFile('result', request.resultPath);
    await removeFile('request', request.requestPath);
    const pointer = loadJobPointer(
      storage,
      request.target,
      request.kind,
      request.kind === 'analysis' ? blockName : null,
    );
    if (pointer?.jobId === request.jobId) {
      storage.removeItem(resumeKey(
        request.target,
        request.kind,
        request.kind === 'analysis' ? blockName : null,
      ));
    }
    progress({ status: 'completed' });
    return JSON.parse(JSON.stringify(outcome));
  } catch (error) {
    if (!outcome) throw error;
    outcome.status = 'failed';
    outcome.error = error instanceof Error ? error.message : String(error);
    outcome.updatedAt = new Date().toISOString();
    try {
      onProgress(JSON.parse(JSON.stringify(outcome)));
    } catch (storageError) {
      outcome.error += ` Cleanup status could not be saved: ${storageError.message}`;
    }
    throw new JobCleanupError(error, outcome);
  }
}

export function createProbePrompt(request) {
  validateProbeRequest(request);
  const target = getProbeTarget(request.target);
  const label = target.environment === 'prod' ? 'Production' : 'Stage';
  const toolPath = request.resultPath.slice(1);
  const environmentInstructions = target.environment === 'prod'
    ? `Production-bound content tools are appropriate for this explicit Production probe.
They do not need an environment selector if their binding is already production.
Do not write to Stage. If the binding is unknown or points elsewhere, STOP without writing.`
    : `First verify that your content-writing tool can explicitly address Stage.
If it cannot target Stage, STOP and explain the blocker in chat without writing anything.
Do not use a production endpoint.`;
  const result = {
    schemaVersion: 1,
    jobId: request.jobId,
    kind: 'probe',
    target: { ...target },
    status: 'completed',
    payload: { message: PROBE_MARKER },
  };
  return `Perform one small Block Library Generator storage probe, not block analysis.

Target: ${label} DA, organization ${target.org}, site ${target.site}, site code branch main.
DA admin origin: ${target.adminOrigin}
Site-relative result path (display only): ${request.resultPath}
Exact source endpoint: ${target.adminOrigin}/source/${target.org}/${target.site}${request.resultPath}

Content tool arguments for BOTH reading and creation:
org: ${target.org}
repo: ${target.site}
path: ${toolPath}
contentType: application/json

IMPORTANT: the content tool path above has NO leading slash, URL or org/repo prefix.
The client adds the source URL prefix; a leading slash produces an invalid double slash.

${environmentInstructions}
Never silently fall back to another environment.
Do not edit the current editor document, any other file, library configuration or code.
Do not publish, preview, delete, or synchronize code.
Do not modify the request file.

First read the exact destination. Proceed only on an explicit 404/not-found response.
A 400 Bad Request is not evidence of absence. If the file exists or the check fails, STOP.
Use a real content-writing tool to create ONLY this result file as application/json.
Follow the normal approval flow. Write the complete final JSON below in one write.
Do not wrap it in Markdown fences, a sheet, or HTML.
After writing, read it back and compare all fields.

Only confirm success in chat after both write and readback succeed.
Printing JSON in chat is not the result. If anything fails, report the exact failure;
do not substitute another path, environment or output format.

RESULT JSON

${JSON.stringify(result, null, 2)}`;
}
