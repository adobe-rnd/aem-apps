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
/* eslint-disable no-console */
const MISSING_IMS = /missing ims client id/i;

function describeRequest(input, options) {
  const raw = typeof input === 'string' ? input : input?.url ?? String(input);
  const method = (options?.method ?? input?.method ?? 'GET').toUpperCase();
  try {
    const { origin, host, pathname } = new URL(raw);
    return { method, url: `${origin}${pathname}`, label: `${host}${pathname}` };
  } catch {
    const bare = raw.split(/[?#]/)[0];
    return { method, url: bare, label: bare };
  }
}

export default function guardFetch(fetch) {
  if (typeof fetch !== 'function') return fetch;
  const warned = new Set();
  return async (input, options) => {
    try {
      return await fetch(input, options);
    } catch (error) {
      if (!MISSING_IMS.test(error?.message ?? '')) throw error;
      const { method, url, label } = describeRequest(input, options);
      if (!warned.has(url)) {
        warned.add(url);
        console.warn(`Request not authorized (401): ${method} ${url}`);
      }
      throw Object.assign(new Error(`Request not authorized (401): ${method} ${label}`), {
        status: 401, url, cause: error,
      });
    }
  };
}
