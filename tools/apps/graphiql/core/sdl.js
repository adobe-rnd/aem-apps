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

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

const toCharacter = (code) => (code <= 0x10ffff ? String.fromCodePoint(code) : undefined);

const decodeEntity = (match, entity) => {
  const lower = entity.toLowerCase();
  if (lower.startsWith('#x')) return toCharacter(parseInt(lower.slice(2), 16)) ?? match;
  if (lower.startsWith('#')) return toCharacter(parseInt(lower.slice(1), 10)) ?? match;
  return ENTITIES[entity] ?? match;
};

const toText = (content) => content
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<\/?[a-z][^>]*>/gi, '')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity);

/**
 * The SDL of an `endpoint.html` the GraphQL Endpoints app saves: the text of its second code
 * block (the first is the endpoint config), or undefined.
 */
export function extractSdl(html) {
  const blocks = [...(html ?? '').matchAll(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi)];
  const sdl = blocks[1] && toText(blocks[1][1]);
  return sdl?.trim() ? sdl : undefined;
}

/** The `@contentType` document types of an SDL, in order. */
export const contentTypes = (sdl) => [
  ...(sdl ?? '').matchAll(/^\s*type\s+([_A-Za-z][_0-9A-Za-z]*)\s+@contentType\b/gm),
].map(([, name]) => name);

export const listField = (type) => `${type[0].toLowerCase()}${type.slice(1)}List`;

const declares = (sdl, kind, name) => new RegExp(`^\\s*${kind}\\s+@?${name}\\b`, 'm').test(sdl);

/**
 * The saved SDL plus what Content AI adds when it serves it: the `@contentType` and `@source`
 * directives, `PageInfo`, a `{Type}Page` and a `{type}List` query per document type. The
 * generated filter and sort inputs are typed as `JSON`, so any object literal validates.
 */
export function toServedSdl(sdl) {
  const types = contentTypes(sdl);
  const parts = [sdl.trim()];
  if (!declares(sdl, 'directive', 'contentType')) parts.push('directive @contentType(id: String!) on OBJECT');
  if (!declares(sdl, 'directive', 'source')) parts.push('directive @source(key: String!) on FIELD_DEFINITION');
  if (!declares(sdl, 'scalar', 'JSON')) parts.push('scalar JSON');
  parts.push('type PageInfo {\n  endCursor: String\n  hasNextPage: Boolean!\n  total: Int\n}');
  types.forEach((type) => parts.push(`type ${type}Page {\n  items: [${type}!]!\n  pageInfo: PageInfo!\n}`));
  const args = '(search: String, filter: JSON, orderBy: [JSON!], first: Int, after: String)';
  const fields = types.map((type) => `  ${listField(type)}${args}: ${type}Page`);
  parts.push(`type Query {\n${fields.length ? fields.join('\n') : '  _empty: Boolean'}\n}`);
  return `${parts.join('\n\n')}\n`;
}

/** A first query for GraphiQL: the first page of the first document type. */
export function starterQuery(sdl) {
  const [type] = contentTypes(sdl);
  if (!type) return '{\n  \n}\n';
  return `{
  ${listField(type)}(first: 10) {
    items {
      path
      title
    }
    pageInfo {
      hasNextPage
      endCursor
      total
    }
  }
}
`;
}
