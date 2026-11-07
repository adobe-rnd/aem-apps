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
export const levelKey = (name) => String(name ?? '').trim().toLowerCase();

export function orderLevels(entries) {
  if (!entries.length || entries.some((entry) => !levelKey(entry.level))) return null;
  const info = new Map();
  const after = new Map();
  const before = new Map();
  entries.forEach((entry, index) => {
    const key = levelKey(entry.level);
    if (!info.has(key)) {
      info.set(key, { depth: entry.depth, first: index });
      after.set(key, new Set());
      before.set(key, 0);
    }
    const known = info.get(key);
    known.depth = Math.min(known.depth, entry.depth);
  });
  entries.forEach((entry) => {
    if (entry.parent === null || entry.parent === undefined) return;
    const from = levelKey(entry.parent);
    const to = levelKey(entry.level);
    if (!after.get(from).has(to)) {
      after.get(from).add(to);
      before.set(to, before.get(to) + 1);
    }
  });
  const rank = new Map();
  const remaining = new Set(info.keys());
  while (remaining.size) {
    const ready = [...remaining].filter((key) => before.get(key) === 0)
      .sort((a, b) => info.get(a).depth - info.get(b).depth
        || info.get(a).first - info.get(b).first);
    if (!ready.length) return null;
    const [next] = ready;
    rank.set(next, rank.size);
    remaining.delete(next);
    after.get(next).forEach((to) => before.set(to, before.get(to) - 1));
  }
  return rank;
}
