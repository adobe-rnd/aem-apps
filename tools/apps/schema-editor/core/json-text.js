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
// JSON typed as text: where it breaks, and what Enter inserts. Pure, so it is unit-tested.

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function lineColumnAt(text, offset) {
  const lines = text.slice(0, offset).split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** The 1-based line / column engines report as a line and column, an offset, or the end. */
function locate(text, message) {
  const lineColumn = message.match(/line (\d+) column (\d+)/i);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  const position = message.match(/position (\d+)/i);
  if (position) return lineColumnAt(text, Number(position[1]));
  if (/end of (JSON )?(input|data)|\bEOF\b/i.test(message)) return lineColumnAt(text, text.length);
  return {};
}

/** An engine's message without its position wording (reported as line / column instead). */
function describe(message) {
  const text = message
    .replace(/^JSON(\.parse| Parse error):\s*/i, '')
    .replace(/\s+(in JSON )?at (position \d+|line \d+ column \d+).*$/is, '')
    .replace(/,\s+(\.\.\.)?".*"(\.\.\.)?\s+is not valid JSON$/s, '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A JSON.parse error `message` (V8, Firefox or Safari) as `{ error, line?, column? }`. */
export function jsonProblem(text, message) {
  return { error: `Not valid JSON: ${describe(message)}`, ...locate(text, message) };
}

/** `{ json }`, or `{ error, line?, column? }` (1-based) when `text` is not valid JSON. */
export function parseJsonText(text) {
  try {
    return { json: JSON.parse(text) };
  } catch (e) {
    return jsonProblem(text, e.message);
  }
}

/** As `parseJsonText`, and a schema file must be a JSON object. */
export function parseSchemaText(text) {
  const result = parseJsonText(text);
  if (result.error || isPlainObject(result.json)) return result;
  return { error: 'The schema must be a JSON object: { … }.' };
}

/** The offset of a 1-based `{ line, column }` in `text`, kept within the line and the text. */
export function offsetAt(text, { line, column } = {}) {
  if (!line) return 0;
  const lines = text.split('\n');
  const index = Math.min(line, lines.length) - 1;
  const start = lines.slice(0, index).reduce((sum, { length }) => sum + length + 1, 0);
  return start + Math.min(Math.max((column ?? 1) - 1, 0), lines[index].length);
}

/**
 * The error issue for Schema page text that is not a valid schema; `text` is where in the text
 * (`line` / `column` may be missing), and marks the issue as one of the text, not the model.
 */
export function textIssue({ error, line, column }) {
  return {
    code: 'invalid-json', severity: 'error', message: error, text: { line, column },
  };
}

const PAIRS = { '{': '}', '[': ']' };

/**
 * What Enter does to the selection `start`..`end`: a line break keeping the line's indent, one
 * level deeper after `{` or `[`, and between an empty pair the closing one on a line of its own.
 * @returns {{ from: number, to: number, text: string, caret: number }} `text` replaces
 *   `from`..`to`; `caret` is the new caret offset in the whole text.
 */
export function lineBreakAt(text, start, end = start, indentUnit = '  ') {
  const lineStart = start ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  const head = text.slice(lineStart, start);
  const indent = head.match(/^[ \t]*/)[0];
  const opener = head.trimEnd().slice(-1);
  const edit = (inserted, caret, to = end) => ({
    from: start, to, text: inserted, caret: start + caret,
  });
  if (!PAIRS[opener]) return edit(`\n${indent}`, 1 + indent.length);

  const inner = `\n${indent}${indentUnit}`;
  const spaces = text.slice(end).match(/^[ \t]*/)[0];
  if (text.charAt(end + spaces.length) !== PAIRS[opener]) return edit(inner, inner.length);
  return edit(`${inner}\n${indent}`, inner.length, end + spaces.length);
}
