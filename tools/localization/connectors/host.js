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
export const DA_TRANSLATE_ORIGIN = 'https://translate.da.live';

const failed = (code, message, retryable) => ({
  status: 0, headers: {}, body: null, error: { code, message, retryable },
});

function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function encodeBody(body) {
  if (!isPlainObject(body)) return body ?? undefined;
  const form = new FormData();
  Object.entries(body)
    .filter(([, value]) => value !== undefined && value !== null)
    .forEach(([key, value]) => form.append(key, value instanceof Blob ? value : String(value)));
  return form;
}

async function readBody(response) {
  const text = await response.text();
  if (!(response.headers.get('content-type') || '').includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createTranslateProxy({ fetch, origin = DA_TRANSLATE_ORIGIN } = {}) {
  return async function translateProxy({
    url, method = 'POST', headers = {}, body,
  } = {}) {
    if (typeof fetch !== 'function') return failed('not-connected', 'No fetch for translateProxy', false);
    if (!sameOrigin(url, origin)) return failed('not-allowed', `URL is not on ${origin}`, false);
    try {
      const response = await fetch(url, { method, headers, body: encodeBody(body) });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await readBody(response),
      };
    } catch (e) {
      return failed('network', e?.message || 'Network error', true);
    }
  };
}
