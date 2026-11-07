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

export const requestFailed = (what, response) => Object.assign(
  new Error(`${what} failed with status ${response.status}`),
  { status: response.status },
);

export async function listAll(api, target, description, continuationToken = null, collected = []) {
  const result = await api.source.list({ ...target, continuationToken });
  if (!result.ok) throw requestFailed(description, result);
  const items = [...collected, ...result.items];
  return result.continuationToken
    ? listAll(api, target, description, result.continuationToken, items)
    : items;
}
