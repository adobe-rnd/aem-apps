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
// Lets node tests import modules that load https://da.live/nx/utils/daFetch.js.
// Node can't import https: URLs, so this maps it to a stub that forwards to
// `globalThis.daFetchStub`. Import this file first, then load the module under
// test with a dynamic import(): static imports are resolved before this runs.
import { registerHooks } from 'node:module';

const DA_FETCH = 'https://da.live/nx/utils/daFetch.js';
const STUB = 'data:text/javascript,export const daFetch = (...args) => globalThis.daFetchStub(...args);';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === DA_FETCH) return { url: STUB, shortCircuit: true };
    return next(specifier, context);
  },
});

/**
 * Records every daFetch call and answers it with `respond(url, opts)`.
 * @param {Function} respond
 * @returns {Array<{url: string, opts: object}>} the recorded calls
 */
export function stubDaFetch(respond) {
  const calls = [];
  global.daFetchStub = async (url, opts = {}) => {
    calls.push({ url, opts });
    return respond(url, opts);
  };
  return calls;
}

/**
 * Answers the admin.hlx.page ping like a Helix 6 site for the given site names
 * and like a legacy site for all others. Other URLs fail the test.
 * @param {string[]} hlx6Sites - `org/site` names that run on Helix 6
 * @returns {Function} a fetch replacement
 */
export function pingFetch(hlx6Sites = []) {
  return async (url) => {
    const match = /^https:\/\/admin\.hlx\.page\/ping\/([^/]+\/[^/]+)$/.exec(url);
    if (!match) throw new Error(`unexpected fetch ${url}`);
    const headers = hlx6Sites.includes(match[1]) ? { 'x-api-upgrade-available': 'true' } : {};
    return new Response(null, { status: 200, headers });
  };
}
