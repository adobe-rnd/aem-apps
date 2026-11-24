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
// Splits JSON text into the runs the JSON view colours. Pure, so it is unit-tested.

// A string (a key when a colon follows), a literal or a number; the text between is punctuation.
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** `[{ text, type }]` covering all of `json`; `type` is key, string, number, literal or null. */
export function jsonTokens(json) {
  const tokens = [];
  const plain = (text) => { if (text) tokens.push({ text, type: null }); };
  let at = 0;
  [...json.matchAll(TOKEN)].forEach((match) => {
    const [whole, string, colon] = match;
    plain(json.slice(at, match.index));
    if (colon) {
      tokens.push({ text: string, type: 'key' });
      plain(colon);
    } else if (string) {
      tokens.push({ text: whole, type: 'string' });
    } else {
      tokens.push({ text: whole, type: /^[tfn]/.test(whole) ? 'literal' : 'number' });
    }
    at = match.index + whole.length;
  });
  plain(json.slice(at));
  return tokens;
}
