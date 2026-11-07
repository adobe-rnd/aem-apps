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
// DA codeblock documents: the texts of <pre><code> blocks, as the schema editor writes them.

const escapeHtml = (text) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const wrapCodeblocks = (texts) => `<body><header></header><main><div>${
  texts.map((text) => `<pre><code>${escapeHtml(text)}</code></pre>`).join('')
}</div></main><footer></footer></body>`;

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

// Matches the browser's `querySelectorAll('code')` texts without needing a DOM.
export const unwrapCodeblocks = (html) => [
  ...(html ?? '').matchAll(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi),
].map(([, content]) => toText(content));

export const unwrapCodeblock = (html) => unwrapCodeblocks(html)[0];
