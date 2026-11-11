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
// Bounded undo/redo of model snapshots (cheap: commands share untouched subtrees).
// Edits with the same `coalesceKey` within `coalesceMs` merge into one step (typing).

// eslint-disable-next-line import/prefer-default-export
export function createHistory({ limit = 200, coalesceMs = 1000, now = () => Date.now() } = {}) {
  let undoStack = [];
  let redoStack = [];

  return {
    push(before, after, { label = '', coalesceKey } = {}) {
      if (before === after) return;
      const top = undoStack[undoStack.length - 1];
      const time = now();
      if (top && coalesceKey && top.coalesceKey === coalesceKey && time - top.at < coalesceMs) {
        top.after = after;
        top.at = time;
      } else {
        undoStack.push({
          before, after, label, coalesceKey, at: time,
        });
        if (undoStack.length > limit) undoStack = undoStack.slice(-limit);
      }
      redoStack = [];
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return null;
      redoStack.push(entry);
      return { model: entry.before, label: entry.label };
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry) return null;
      undoStack.push({ ...entry, coalesceKey: undefined });
      return { model: entry.after, label: entry.label };
    },

    clear() {
      undoStack = [];
      redoStack = [];
    },

    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoLabel() { return undoStack[undoStack.length - 1]?.label ?? ''; },
    get redoLabel() { return redoStack[redoStack.length - 1]?.label ?? ''; },
  };
}
