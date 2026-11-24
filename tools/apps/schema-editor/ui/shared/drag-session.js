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
/**
 * The drag in progress. Browsers hide `dataTransfer` data until `drop` and the palette and the
 * canvas live in different shadow trees, so both share the drag here and announce it on
 * `dragState`. A drag is `{ source: 'palette', item: { type, id, label } }` or
 * `{ source: 'card', nodeId }`.
 */

const PALETTE_TYPE = 'application/x-se-element';
const NODE_TYPE = 'application/x-se-node';

let current = null;

export function startDrag(bus, drag, dataTransfer) {
  current = drag;
  if (dataTransfer) {
    const palette = drag.source === 'palette';
    const value = palette ? `${drag.item.type}:${drag.item.id}` : drag.nodeId;
    dataTransfer.setData(palette ? PALETTE_TYPE : NODE_TYPE, value);
    dataTransfer.effectAllowed = palette ? 'copy' : 'move';
  }
  bus?.dragState.emit({ active: true, ...drag });
}

export function currentDrag() {
  return current;
}

/** Ends the drag (drop, cancel or Esc). Safe to call more than once. */
export function endDrag(bus) {
  if (!current) return;
  current = null;
  bus?.dragState.emit({ active: false });
}
