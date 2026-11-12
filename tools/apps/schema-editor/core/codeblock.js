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
// Each schema is stored as the DA document `.da/forms/schemas/{name}.html`, with the JSON
// inside one `<pre><code>` block. The da.live form editor and the GraphQL app read the same
// documents, so the shape must not change.

const SCHEMAS_DIR = '.da/forms/schemas';

export const schemasFolder = (org, site) => `/${org}/${site}/${SCHEMAS_DIR}`;

export const schemaPath = (org, site, name) => `${schemasFolder(org, site)}/${name}.html`;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

const escapeHtml = (text) => text
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const decodeEntities = (text) => text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
  if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? match;
  const code = entity[1].toLowerCase() === 'x'
    ? parseInt(entity.slice(2), 16)
    : parseInt(entity.slice(1), 10);
  return Number.isNaN(code) ? match : String.fromCodePoint(code);
});

export function wrapSchemaHtml(json) {
  const code = escapeHtml(JSON.stringify(json, null, 2));
  return `<body><header></header><main><div><pre><code>${code}</code></pre></div></main><footer></footer></body>`;
}

/** Returns `{ json, raw }`, or `{ raw?, error }` when the block is not a JSON object. */
export function unwrapSchemaHtml(html) {
  const match = /<code\b[^>]*>([\s\S]*?)<\/code>/i.exec(html ?? '');
  const raw = match ? decodeEntities(match[1].replace(/<[^>]+>/g, '')) : '';
  if (!raw.trim()) return { error: 'The schema document has no JSON.' };
  try {
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { raw, error: 'The schema is not a JSON object.' };
    }
    return { json, raw };
  } catch (e) {
    return { raw, error: `The schema is not valid JSON: ${e.message}` };
  }
}
