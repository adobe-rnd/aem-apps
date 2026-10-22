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
export const PROBE_TARGET = Object.freeze({
  environment: 'stage',
  org: 'msagolj',
  site: 'ew',
  branch: 'main',
  adminOrigin: 'https://stage-admin.da.live',
});

export const PROBE_MARKER = 'block-library-round-trip-ok';

const RESUME_KEY = 'block-library-generator:probe:v1:stage:msagolj:ew:main';
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) {
    throw new Error('Invalid probe job ID.');
  }
}

function hasTarget(target) {
  return target && Object.keys(target).length === Object.keys(PROBE_TARGET).length
    && Object.entries(PROBE_TARGET).every(([key, value]) => target[key] === value);
}

export function getProbeBlockReason({
  context = {}, actions = {}, embedded = false, hasToken = false,
}) {
  if (!embedded || !['edit', 'canvas'].includes(context.view) || !context.path?.startsWith('/')) {
    return 'Open this app from the Stage editor to use the probe. Direct and Apps launches are read-only.';
  }
  if (context.org !== PROBE_TARGET.org || context.site !== PROBE_TARGET.site) {
    return 'This proof is restricted to the Stage msagolj/ew target.';
  }
  if (context.branch && context.branch !== PROBE_TARGET.branch) {
    return 'The supplied site code branch is not main.';
  }
  if (context.daOrigin && context.daOrigin !== PROBE_TARGET.adminOrigin) {
    return 'The supplied DA origin is not Stage. No production fallback is allowed.';
  }
  if (!hasToken) return 'No session token was supplied. The probe requires an authenticated editor.';
  if (['daFetch', 'setPrompt', 'closeLibrary'].some((name) => typeof actions[name] !== 'function')) {
    return 'The required SDK actions are unavailable.';
  }
  return '';
}

export function createProbeRequest({
  jobId = crypto.randomUUID(), createdAt = new Date().toISOString(),
} = {}) {
  assertJobId(jobId);
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error('Invalid probe request creation time.');
  }
  const root = `/.da/block-library-generator/jobs/${jobId}`;
  return {
    schemaVersion: 1,
    jobId,
    kind: 'probe',
    target: { ...PROBE_TARGET },
    createdAt,
    requestPath: `${root}/request.json`,
    resultPath: `${root}/result.json`,
    input: { message: PROBE_MARKER },
  };
}

function validateProbeRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid probe request.');
  }
  const expected = createProbeRequest({ jobId: value.jobId, createdAt: value.createdAt });
  if (value.schemaVersion !== 1 || value.kind !== 'probe'
    || !hasTarget(value.target) || value.createdAt !== expected.createdAt
    || value.requestPath !== expected.requestPath || value.resultPath !== expected.resultPath
    || value.input?.message !== PROBE_MARKER) {
    throw new Error('Probe request identity, target, or path does not match this proof.');
  }
  return value;
}

async function fetchSource(daFetch, path, { signal, ...options } = {}) {
  const timeout = AbortSignal.timeout(15000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  requestSignal.throwIfAborted();
  const url = `${PROBE_TARGET.adminOrigin}/source/${PROBE_TARGET.org}/${PROBE_TARGET.site}${path}`;
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
    throw new Error(`${operation} failed (HTTP ${response.status}). Check Stage access and connectivity.`);
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
    throw new Error('The Stage source response is not valid JSON.', { cause });
  }
}

export async function readProbeRequest(daFetch, jobId, options = {}) {
  const { requestPath } = createProbeRequest({ jobId });
  const response = await fetchSource(daFetch, requestPath, options);
  assertResponse(response, 'Reading the probe request');
  const value = validateProbeRequest(await readJSON(response));
  if (value.jobId !== jobId) throw new Error('Probe request job identity does not match.');
  return value;
}

export async function persistProbeRequest(daFetch, request, options = {}) {
  validateProbeRequest(request);
  const existing = await fetchSource(daFetch, request.requestPath, options);
  if (existing.ok) throw new Error('This probe request already exists; refusing to overwrite it.');
  if (existing.status !== 404) assertResponse(existing, 'Checking the probe request destination');

  const body = new FormData();
  body.append('data', new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
  const response = await fetchSource(daFetch, request.requestPath, {
    ...options, method: 'PUT', body,
  });
  assertResponse(response, 'Writing the probe request');
  const stored = await readProbeRequest(daFetch, request.jobId, options);
  if (stored.createdAt !== request.createdAt) {
    throw new Error('Probe request readback does not match the written request.');
  }
  return stored;
}

export async function readProbeResult(daFetch, request, options = {}) {
  validateProbeRequest(request);
  const response = await fetchSource(daFetch, request.resultPath, options);
  if (response.status === 404) return null;
  assertResponse(response, 'Reading the probe result');
  const value = await readJSON(response);
  if (value?.schemaVersion !== 1 || value.jobId !== request.jobId || value.kind !== 'probe'
    || !hasTarget(value.target)) {
    throw new Error('Probe result identity or target does not match the saved request.');
  }
  if (value.status === 'completed') {
    if (value.payload?.message !== PROBE_MARKER || value.error !== undefined) {
      throw new Error('The completed probe result has an invalid marker or unexpected error.');
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

export function loadProbePointer(storage) {
  const text = storage.getItem(RESUME_KEY);
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

export function saveProbePointer(storage, request, handoffRequested = false) {
  validateProbeRequest(request);
  if (typeof handoffRequested !== 'boolean') throw new Error('Invalid probe handoff flag.');
  storage.setItem(RESUME_KEY, JSON.stringify({ jobId: request.jobId, handoffRequested }));
}

export function createProbePrompt(request) {
  validateProbeRequest(request);
  const result = {
    schemaVersion: 1,
    jobId: request.jobId,
    kind: 'probe',
    target: { ...PROBE_TARGET },
    status: 'completed',
    payload: { message: PROBE_MARKER },
  };
  return `Perform one small Block Library Generator storage probe, not block analysis.

Target: Stage DA, organization msagolj, site ew, site code branch main.
DA admin origin: ${PROBE_TARGET.adminOrigin}
Result path relative to this site: ${request.resultPath}
Exact source endpoint: ${PROBE_TARGET.adminOrigin}/source/msagolj/ew${request.resultPath}

First verify that your content-writing tool can explicitly address Stage.
If it cannot target Stage, STOP and explain the blocker in chat without writing anything.
Do not use a production endpoint or silently fall back to another environment.
Do not edit the current editor document, any other file, library configuration or code.
Do not publish, preview, delete, or synchronize code.
Do not modify the request file.

Use a real content-writing tool to create ONLY the result file above as application/json.
Write the complete final JSON below in one write, without Markdown fences:

${JSON.stringify(result, null, 2)}

Only confirm success in chat after the write succeeds. Printing JSON in chat is not the result.
If the write fails, report the failure; do not substitute another path or output format.`;
}
