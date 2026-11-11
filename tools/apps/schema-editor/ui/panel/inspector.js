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
// Which inspector sections a node gets. Pure, so the layout is unit-tested without rendering.

import { elementFor } from '../../core/model/elements.js';

function headOf(entry) {
  if (!entry || entry.parent) return null;
  return entry.def ? 'component' : 'root';
}

/** Ordered section ids for a `findNode` entry. */
export function sectionsFor(entry) {
  if (!entry) return [];
  const { node, parent } = entry;
  if (node.kind === 'unsupported') return ['unsupported', 'advanced'];

  const head = headOf(entry);
  const top = head ? [head] : [];
  const behavior = parent ? ['behavior'] : [];
  if (node.kind === 'ref') return [...top, 'reference', 'general', ...behavior, 'advanced'];

  const [general, ...rest] = elementFor(node)?.sections ?? ['general'];
  return [...top, general, ...behavior, ...rest, 'advanced'];
}

/** Whether the node sits directly in a Group, i.e. has a key and can be required. */
export function isGroupField(entry) {
  return entry?.parent?.kind === 'object';
}
