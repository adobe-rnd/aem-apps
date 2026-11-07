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
const OPEN_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
const CLOSE_TAG = /<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/g;
const TRANSLATE_NO = /translate\s*=\s*["']no["']/i;

function closingEnd(html, tag, from) {
  const tokens = [...html.slice(from).matchAll(new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, 'gi'))];
  let depth = 1;
  const hit = tokens.find((token) => {
    depth += token[1] ? -1 : 1;
    return depth === 0;
  });
  return hit ? from + hit.index + hit[0].length : -1;
}

function noSplitZones(html) {
  return [...html.matchAll(OPEN_TAG)]
    .filter((match) => TRANSLATE_NO.test(match[2] || ''))
    .map((match) => ({
      start: match.index,
      end: closingEnd(html, match[1], match.index + match[0].length),
    }))
    .filter((zone) => zone.end !== -1);
}

export default function splitHtml(html, maxLength = 5000) {
  if (html.length <= maxLength) return [html];
  const zones = noSplitZones(html);
  const points = [...html.matchAll(CLOSE_TAG)]
    .map((match) => match.index + match[0].length)
    .filter((pos) => !zones.some((zone) => pos > zone.start && pos < zone.end));
  const { chunks, start } = [...points, html.length].reduce((acc, point) => {
    if (point - acc.start > maxLength && acc.last > acc.start) {
      acc.chunks.push(html.slice(acc.start, acc.last));
      acc.start = acc.last;
    }
    acc.last = point;
    return acc;
  }, { chunks: [], start: 0, last: 0 });
  if (start < html.length) chunks.push(html.slice(start));
  return chunks;
}
