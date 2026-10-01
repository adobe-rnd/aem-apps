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
/* eslint-disable import/no-unresolved */
import { source, asText } from 'https://da.live/nx2/utils/api.js';

// The core store port over DA's source API.

const failure = (status) => ({ error: 'Request failed.', status });

async function listAll({ path, continuationToken, items = [] }) {
  const result = await source.list(path, { continuationToken }).catch(() => undefined);
  if (!result) return failure();
  // nx2 drops the status of a failed listing; the expected one is hlx6's for a missing folder.
  if (!result.ok) return failure(result.status ?? 404);
  const all = [...items, ...result.items];
  if (!result.continuationToken) return { items: all, permissions: result.permissions };
  return listAll({ path, continuationToken: result.continuationToken, items: all });
}

export const list = ({ path }) => listAll({ path });

export async function read({ path }) {
  const { ok, data, status } = await asText(source.get(path)).catch(() => ({}));
  return ok ? { text: data } : failure(status);
}

async function send(request) {
  try {
    const resp = await request();
    return resp.ok ? { ok: true } : failure(resp.status);
  } catch {
    return failure();
  }
}

export const write = ({ path, text }) => send(() => source.save(path, { body: text }));

export const remove = ({ path }) => send(() => source.delete(path));
