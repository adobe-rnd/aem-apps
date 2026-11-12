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
// Editing rules for the value list (`enum`) of a Choice element.

export function nextChoice(list) {
  let n = list.length + 1;
  while (list.includes(`Option ${n}`)) n += 1;
  return `Option ${n}`;
}

export function parseChoices(text) {
  return [...new Set(String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

/** Moves entry `from` to index `to`; returns the same array when it doesn't move. */
export function moveChoice(list, from, to) {
  if (to === from || to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Returns an `updateNode` patch that keeps the default pointing at the renamed choice. */
export function renameChoice(node, index, value) {
  const list = [...node.enum];
  const previous = list[index];
  list[index] = value;
  return { enum: list, default: node.default === previous ? value : node.default };
}
