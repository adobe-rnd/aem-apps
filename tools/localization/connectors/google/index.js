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
import { googleCode, parseTag } from './languages.js';
import splitHtml from './split-html.js';

export const DA_TRANSLATE = 'https://translate.da.live';

const NAME = 'google';
const MAX_CHUNK = 5000;
const PAGE_SIZE = 20;
const MAX_BATCH_ITEMS = 500;
const MAX_BATCH_BYTES = 10485760;

const DESCRIPTOR = {
  apiVersion: 1,
  name: NAME,
  label: 'Google Translate',
  capabilities: {
    formats: ['html'],
    assets: false,
    context: false,
    cancel: true,
    maxBatchItems: MAX_BATCH_ITEMS,
    maxBatchBytes: MAX_BATCH_BYTES,
    sendConcurrency: 1,
    resultsConcurrency: 2,
  },
  options: [],
  hostServices: ['translateProxy'],
};

const failure = (code, message, extra = {}) => ({ error: { code, message, ...extra } });

const positive = (value, fallback) => (
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
);

function checkPair(src, dest) {
  const from = parseTag(src);
  const to = parseTag(dest);
  if (!from) return { ok: false, reason: `Invalid source language: ${src}` };
  if (!to) return { ok: false, reason: `Invalid target language: ${dest}` };
  if (from.tag === to.tag) return { ok: false, reason: 'Source and target languages are the same' };
  if (!googleCode(src)) return { ok: false, reason: `Google does not support ${src}` };
  if (!googleCode(dest)) return { ok: false, reason: `Google does not support ${dest}` };
  return { ok: true };
}

function langStatus(jobState, lang, now) {
  const total = jobState.items.length;
  const entry = jobState.langs[lang];
  if (entry.status === 'failed') {
    return {
      status: 'failed', done: 0, total, error: entry.error,
    };
  }
  if (entry.status === 'cancelled') return { status: 'cancelled', done: 0, total };
  const elapsed = now - jobState.sentAt;
  if (elapsed < jobState.delayMs) {
    const done = Math.min(total, Math.floor((total * Math.max(0, elapsed)) / jobState.delayMs));
    return { status: 'in-progress', done, total };
  }
  return { status: 'translated', done: total, total };
}

function allStatuses(jobState) {
  const now = Date.now();
  return Object.fromEntries(Object.keys(jobState.langs)
    .map((lang) => [lang, langStatus(jobState, lang, now)]));
}

function validJobState(jobState) {
  return Boolean(jobState && jobState.connector === NAME
    && Array.isArray(jobState.items) && jobState.langs && typeof jobState.langs === 'object');
}

function parseBody(body) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function proxyError(response) {
  const { status } = response;
  if (status === 401 || status === 403) return failure('not-connected', `Translate proxy returned ${status}`, { status });
  if (status === 429) return failure('rate-limited', 'Translate proxy rate limited the request', { status, retryable: true });
  return failure('vendor', `Translate proxy returned ${status}`, { status, retryable: status >= 500 || status === 0 });
}

async function translateChunk({ host, request, chunk }) {
  let response;
  try {
    response = await host.translateProxy({ ...request, body: { ...request.body, data: chunk } });
  } catch (e) {
    return failure('vendor', e?.message || 'Translate proxy failed', { retryable: true });
  }
  if (!response) return failure('vendor', 'Translate proxy returned no response', { retryable: true });
  if (response.error) {
    return failure('vendor', response.error.message || 'Translate proxy failed', {
      retryable: response.error.retryable ?? true,
    });
  }
  if (!(response.status >= 200 && response.status < 300)) return proxyError(response);
  const translated = parseBody(response.body)?.translated;
  if (typeof translated !== 'string') return failure('vendor', 'Translate proxy returned no translation');
  return { translated };
}

async function translateItem({
  host, request, item, lang,
}) {
  const result = await splitHtml(item.content, MAX_CHUNK).reduce(async (previous, chunk) => {
    const acc = await previous;
    if (acc.error) return acc;
    const part = await translateChunk({ host, request, chunk });
    if (part.error) return part;
    return { parts: [...acc.parts, part.translated] };
  }, Promise.resolve({ parts: [] }));
  if (result.error) return { id: item.id, error: { ...result.error, itemId: item.id, lang } };
  return { id: item.id, content: result.parts.join('') };
}

function proxyUrl(settings, jobState) {
  const origin = (settings?.translateOrigin || DA_TRANSLATE).replace(/\/+$/, '');
  const org = encodeURIComponent(jobState.org);
  const site = encodeURIComponent(jobState.site);
  return `${origin}/translate/google/${org}/${site}`;
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return failure('not-found', 'No items to translate');
  if (items.length > MAX_BATCH_ITEMS) return failure('too-large', `More than ${MAX_BATCH_ITEMS} items`);
  const bad = items.find((item) => !item?.id || typeof item.content !== 'string');
  if (bad) return failure('unknown', 'Each item needs an id and string content', { itemId: bad?.id });
  const wrongFormat = items.find((item) => (item.format || 'html') !== 'html');
  if (wrongFormat) {
    return failure('unsupported-format', `Format ${wrongFormat.format} is not supported`, { itemId: wrongFormat.id });
  }
  const bytes = items.reduce((sum, item) => sum + item.content.length, 0);
  if (bytes > MAX_BATCH_BYTES) return failure('too-large', `More than ${MAX_BATCH_BYTES} bytes`);
  return null;
}

export async function describe() {
  return structuredClone(DESCRIPTOR);
}

export async function supports({ src, dest } = {}) {
  return checkPair(src, dest);
}

export async function isConnected() {
  return { connected: true };
}

export async function connect() {
  return { connected: true };
}

export async function listOptions() {
  return { items: [] };
}

export async function send({ settings, job, items } = {}) {
  if (!job?.org || !job?.site) return { jobState: null, ...failure('unknown', 'Job needs org and site') };
  if (!googleCode(job.src)) {
    return { jobState: null, ...failure('unsupported-language', `Unsupported source language: ${job.src}`) };
  }
  const dests = Array.isArray(job.dests) ? [...new Set(job.dests)] : [];
  if (dests.length === 0) return { jobState: null, ...failure('unsupported-language', 'No target languages') };
  const itemError = validateItems(items);
  if (itemError) return { jobState: null, ...itemError };

  const langs = Object.fromEntries(dests.map((dest) => {
    const check = checkPair(job.src, dest);
    if (check.ok) return [dest, { code: googleCode(dest), status: 'in-progress' }];
    return [dest, {
      status: 'failed',
      error: { code: 'unsupported-language', message: check.reason, lang: dest },
    }];
  }));

  const jobState = {
    connector: NAME,
    apiVersion: 1,
    org: job.org,
    site: job.site,
    title: job.title || '',
    src: job.src,
    srcCode: googleCode(job.src),
    sentAt: Date.now(),
    delayMs: positive(settings?.simulatedDelayMs, 0),
    items: items.map(({ id, path, content }) => ({ id, path: path || '', content })),
    langs,
  };

  if (Object.values(langs).every((entry) => entry.status === 'failed')) {
    return { jobState, ...failure('unsupported-language', 'No supported target languages') };
  }
  return { jobState };
}

export async function getStatus({ jobState } = {}) {
  if (!validJobState(jobState)) return { jobState: jobState ?? null, langs: {}, ...failure('not-found', 'Unknown job state') };
  return { jobState, langs: allStatuses(jobState) };
}

export async function getResults({
  settings, jobState, lang, cursor,
} = {}, host = {}) {
  if (!validJobState(jobState)) return { items: [], jobState: jobState ?? null, ...failure('not-found', 'Unknown job state') };
  if (!jobState.langs[lang]) return { items: [], jobState, ...failure('not-found', `Language ${lang} is not in this job`, { lang }) };
  const status = langStatus(jobState, lang, Date.now());
  if (status.status === 'cancelled') return { items: [], jobState, ...failure('cancelled', `Language ${lang} was cancelled`, { lang }) };
  if (status.status === 'failed') return { items: [], jobState, error: { ...status.error, lang } };
  if (status.status !== 'translated') {
    return {
      items: [], jobState, ...failure('not-found', `Language ${lang} is not translated yet`, { lang, retryable: true }),
    };
  }
  if (typeof host?.translateProxy !== 'function') {
    return { items: [], jobState, ...failure('not-connected', 'Host service translateProxy is missing') };
  }

  const start = Math.max(0, Number.parseInt(cursor, 10) || 0);
  const end = start + positive(settings?.resultsPageSize, PAGE_SIZE);
  const page = jobState.items.slice(start, end);
  const request = {
    url: proxyUrl(settings, jobState),
    method: 'POST',
    headers: {},
    body: { fromlang: jobState.srcCode, tolang: jobState.langs[lang].code },
  };
  const results = await Promise.all(page.map((item) => translateItem({
    host, request, item, lang,
  })));

  const response = { items: results, jobState };
  if (end < jobState.items.length) response.cursor = String(end);
  const failed = results.filter((item) => item.error);
  if (failed.length && failed.length === results.length) response.error = failed[0].error;
  return response;
}

export async function cancel({ jobState, lang } = {}) {
  if (!validJobState(jobState)) return { jobState: jobState ?? null, langs: {}, ...failure('not-found', 'Unknown job state') };
  if (lang && !jobState.langs[lang]) {
    return { jobState, langs: allStatuses(jobState), ...failure('not-found', `Language ${lang} is not in this job`, { lang }) };
  }
  const targets = lang ? [lang] : Object.keys(jobState.langs);
  const langs = Object.fromEntries(Object.entries(jobState.langs).map(([code, entry]) => {
    if (!targets.includes(code) || entry.status === 'failed') return [code, entry];
    return [code, { ...entry, status: 'cancelled' }];
  }));
  const next = { ...jobState, langs };
  return { jobState: next, langs: allStatuses(next) };
}
