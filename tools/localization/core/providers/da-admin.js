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

const CONTINUATION_HEADER = 'da-continuation-token';

export const requestFailed = (what, response) => new Error(`${what} failed with status ${response.status}`);

export async function listAll(fetch, url, description, continuationToken = null, collected = []) {
  const headers = continuationToken ? { [CONTINUATION_HEADER]: continuationToken } : {};
  const response = await fetch(url, { cache: 'no-store', headers });
  if (!response.ok) throw requestFailed(description, response);
  const items = [...collected, ...await response.json()];
  const nextToken = response.headers.get(CONTINUATION_HEADER);
  return nextToken ? listAll(fetch, url, description, nextToken, items) : items;
}
