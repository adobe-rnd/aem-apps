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

/*
 * Pure, dependency-free helpers for interpreting publish-requests-worker
 * responses. Kept separate from api.js (which imports https:// modules that
 * node --test cannot resolve) so the read-outcome logic — the source of the
 * "empty inbox with no error" bug — is unit-testable.
 */

/**
 * Build a human-readable error from a non-ok worker response, preferring the
 * worker's `{ error }` body and falling back to the status code.
 * @param {Response} resp - A non-ok fetch Response
 * @param {string} fallback - Prefix used when the body has no error message
 * @returns {Promise<string>} The error message
 */
export async function errorMessage(resp, fallback) {
  let detail = '';
  try {
    detail = (await resp.json())?.error || '';
  } catch {
    /* body was not JSON — fall back to the status code */
  }
  return detail || `${fallback} (${resp.status}). Please reload and try again.`;
}

/**
 * Read the `{ requests }` payload from a worker list response.
 * A non-ok response is a real failure (expired token, 5xx, rate limit) and
 * throws, so the caller surfaces an error instead of a false-empty inbox.
 * The worker returns 200 with `{ requests: [] }` for a genuinely empty queue.
 * @param {Response} resp - The fetch Response from GET /api/requests
 * @returns {Promise<Object[]>} The pending requests (possibly empty)
 */
export async function requestsFromResponse(resp) {
  if (!resp.ok) {
    throw new Error(await errorMessage(resp, 'Couldn\'t load publish requests'));
  }
  const { requests = [] } = await resp.json();
  return requests;
}
