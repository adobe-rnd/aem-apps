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
import { findNode, getNode, labelOf } from '../../core/model/query.js';
import { moveTo } from '../shared/actions.js';
import { insertPaletteItem } from '../shared/palette.js';
import { startDrag, currentDrag, endDrag } from '../shared/drag-session.js';
import {
  targetKey, toInsertTarget, canDrop, dropHint,
} from '../../core/dnd/targets.js';
import { targetFromPath, blockedUseFromPath } from './drop-target.js';
import { BusController } from '../shared/bus-controller.js';

/** What a target looks like on screen: a change of it needs a render. */
function signature(target) {
  if (!target) return '';
  if (target.blocked) return `blocked:${target.key}`;
  return `${targetKey(target)}|${target.scope ?? ''}|${target.ok}|${target.hint ?? ''}`;
}

/**
 * Drag & drop on the canvas, from cards and the Elements palette. The host renders
 * `markFor(key, scope)` on each zone and `blockedFor(key)` on each component use, and binds
 * `handlers` on the tree. Host contract: `store`, `model`, `requestUpdate()`, `announce(message)`.
 */
export class CanvasDropController {
  /** The hovered target with its verdict, or `{ blocked, key }` over a use's previewed fields. */
  target = null;

  /** Set from the bus, as palette drags start outside the canvas. */
  dragging = false;

  constructor(host) {
    this.host = host;
    this._subscriptions = new BusController(host, (bus) => [
      bus.dragState.subscribe(({ active }) => {
        this.dragging = active;
        if (!active) this._setTarget(null);
        host.requestUpdate();
      }),
    ]);
    this.handlers = {
      dragstart: (e) => this._onDragStart(e),
      dragover: (e) => this._onDragOver(e),
      dragleave: (e) => this._onDragLeave(e),
      drop: (e) => this._onDrop(e),
      dragend: () => this._finish(),
    };
  }

  /**
   * `is-target` with a hint, or `is-invalid` with a reason, for the zone `key` rendered in
   * `scope` (a component's zones repeat under each use).
   */
  markFor(key, scope = '') {
    if (!this.target || this.target.noop || this.target.blocked) return null;
    if (targetKey(this.target) !== key || (this.target.scope ?? '') !== scope) return null;
    return this.target.ok
      ? { className: 'is-target', hint: this.target.hint }
      : { className: 'is-invalid', reason: this.target.reason };
  }

  /** Whether the drag is over the previewed fields of the use with row `key`. */
  blockedFor(key) {
    return Boolean(this.target?.blocked) && this.target.key === key;
  }

  get _bus() {
    return this.host.store.bus;
  }

  _setTarget(target) {
    const same = signature(target) === signature(this.target);
    this.target = target;
    if (!same) this.host.requestUpdate();
  }

  _onDragStart(event) {
    const handle = event.composedPath().find((el) => el?.dataset?.dragNode);
    if (!handle) return;
    event.stopPropagation();
    startDrag(this._bus, { source: 'card', nodeId: handle.dataset.dragNode }, event.dataTransfer);
    const head = handle.closest('.card-head');
    if (head && event.dataTransfer?.setDragImage) {
      const { left, top } = head.getBoundingClientRect();
      event.dataTransfer.setDragImage(head, event.clientX - left, event.clientY - top);
    }
  }

  _onDragOver(event) {
    const drag = currentDrag();
    if (!drag) return;
    const { model } = this.host;
    const target = targetFromPath(model, event.composedPath(), event.clientY);
    const verdict = canDrop(model, drag, target);
    if (verdict.ok || verdict.noop) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = drag.source === 'card' ? 'move' : 'copy';
    } else if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none';
    }
    if (target) this._setTarget({ ...target, ...verdict, hint: dropHint(drag, verdict) });
    else {
      const use = blockedUseFromPath(event.composedPath());
      this._setTarget(use && { blocked: true, key: use.key });
    }
  }

  _onDragLeave(event) {
    const into = event.relatedTarget;
    if (into && event.currentTarget.contains(into)) return;
    this._setTarget(null);
  }

  async _onDrop(event) {
    const drag = currentDrag();
    if (!drag) return;
    event.preventDefault();
    const { model } = this.host;
    const target = targetFromPath(model, event.composedPath(), event.clientY);
    const verdict = canDrop(model, drag, target);
    this._finish();
    if (!verdict.ok) return;
    await this.drop(drag, target);
  }

  /** Performs a drop; public for tests and non-pointer callers. */
  async drop(drag, target) {
    const { store } = this.host;
    const parent = getNode(store.model, target.parentId);
    const where = labelOf(store.model, parent) || 'the schema';
    const position = target.slot ? 'as list item' : `at position ${target.index + 1}`;
    if (drag.source === 'card') {
      const label = labelOf(store.model, getNode(store.model, drag.nodeId));
      const result = await moveTo(store, drag.nodeId, toInsertTarget(target));
      if (result.ok) this.host.announce(`Moved ${label} to ${where} ${position}.`);
      return result;
    }
    const result = await insertPaletteItem(store, drag.item, toInsertTarget(target));
    if (result.ok) {
      const node = findNode(store.model, result.result?.nodeId)?.node;
      this.host.announce(`Added ${labelOf(store.model, node) || drag.item.label} to ${where} ${position}.`);
    }
    return result;
  }

  _finish() {
    endDrag(this._bus);
    this._setTarget(null);
  }
}
