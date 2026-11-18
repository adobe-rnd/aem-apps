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
import { walk } from '../../../../tools/apps/schema-editor/core/model/query.js';

export const PERSON = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Person',
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    address: { $ref: '#/$defs/Address' },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
  },
  $defs: {
    Address: {
      type: 'object',
      title: 'Address',
      properties: { city: { type: 'string', title: 'City' } },
    },
  },
};

export const ARTICLE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Article',
  type: 'object',
  required: ['headline'],
  properties: {
    headline: {
      type: 'string', title: 'Headline', minLength: 3, maxLength: 80,
    },
    tags: { type: 'array', title: 'Tags', items: { type: 'string', title: 'Tag' } },
    author: {
      type: 'object',
      title: 'Author',
      properties: { name: { type: 'string', title: 'Name' } },
    },
    rating: {
      type: 'integer', title: 'Rating', minimum: 1, maximum: 5,
    },
  },
};

/** First node of the model with this key. */
export function nodeByKey(model, key) {
  return [...walk(model)].find(({ node }) => node.key === key)?.node ?? null;
}

/** An in-memory schema repository (the port adapters/schemas.js implements). */
export function memoryRepository(files = {}, { listError } = {}) {
  const store = { ...files };
  return {
    store,
    list: async () => (listError ?? {
      items: Object.keys(store).map((name, i) => ({ name, lastModified: Date.now() - i * 60_000 })),
    }),
    read: async ({ name }) => (store[name]
      ? { json: store[name], raw: JSON.stringify(store[name]) }
      : { error: 'Not found', status: 404 }),
    save: async ({ name, json }) => {
      store[name] = json;
      return { ok: true };
    },
    remove: async ({ name }) => {
      delete store[name];
      return { ok: true };
    },
  };
}
