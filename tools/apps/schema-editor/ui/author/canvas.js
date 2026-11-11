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
import { LitElement, html, nothing } from 'da-lit';
import { icon, iconFile } from '../shared/icons.js';
import { detachRef } from '../../core/model/commands.js';
import { issuesByNode, worstSeverity } from '../../core/model/lint.js';
import {
  findNode, getDef, labelOf, refUsages,
} from '../../core/model/query.js';
import {
  moveBy, duplicate, remove, makeReusable, deleteComponent, newComponent, editComponent,
} from '../shared/actions.js';
import { usageLabel, usedTimes } from '../shared/format.js';
import { paletteMenuItems, parseMenuId, insertPaletteItem } from '../shared/palette.js';
import { buttons, shared, loadStyle } from '../shared/styles.js';
import {
  kindLabel, constraintChips, compactChips, cardIcon, isContainer,
} from './card-info.js';
import {
  visibleRows, treeKey, opening, ancestorKeys, rowKey, inPreview, outerUse,
  NO_FOLDS, isFolded, withOpen, foldableKeys, allOpen,
} from './navigation.js';
import { CanvasDropController } from './canvas-drop.js';
import { BusController } from '../shared/bus-controller.js';
import './component-head.js';

await Promise.all([
  import('https://da.live/nx2/blocks/shared/menu/menu.js'),
  import('https://da.live/nx2/blocks/shared/switch/switch.js'),
]);

const style = await loadStyle(import.meta.url);

/**
 * `<se-canvas>`: the card tree of the schema (Build) or of the page's component (Components).
 * Uses preview their component read-only; editable rows are keyed by node id, so `selection` names
 * its row. Only view state lives here; edits go through `ui/shared/actions.js` or the store.
 */
class SeCanvas extends LitElement {
  static properties = {
    store: { attribute: false },
    model: { attribute: false },
    issues: { attribute: false },
    selection: { type: String },
    view: { type: String },
    _componentId: { state: true },
    _folds: { state: true },
  };

  constructor() {
    super();
    this.view = 'schema';
    this._folds = NO_FOLDS;
    this._dnd = new CanvasDropController(this);
    this._subscriptions = new BusController(this, (bus) => [
      // Before revealRequest: a reveal after a page change needs the new `_componentId`.
      bus.pageState.subscribe(({ componentId }) => { this._componentId = componentId; }),
      bus.revealRequest.subscribe(({ nodeId }) => this.reveal(nodeId)),
    ]);
  }

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [buttons, shared, style];
  }

  willUpdate(changed) {
    if (changed.has('issues')) this._issues = issuesByNode(this.issues ?? []);
    const rows = this._rows();
    this._selKey = rows.some((row) => row.key === this.selection) ? this.selection : null;
    // Arrow keys can rest on a preview row while its use is selected.
    const focus = rows.find((row) => row.key === this._focusKey);
    const onPreview = focus && inPreview(focus.scope) && outerUse(focus.scope) === this._selKey;
    this._tabKey = onPreview ? focus.key : (this._selKey ?? rows[0]?.key);
  }

  firstUpdated() {
    // The selection survives a view switch: reveal it, but leave focus on the switch.
    if (this.store.selection) this.reveal(this.store.selection, { focus: false });
  }

  updated() {
    if (!this._pendingFocus) return;
    const { key, id, focus } = this._pendingFocus;
    const card = this._card(key);
    // A node revealed right after an edit renders once the new model arrives.
    if (!card && !findNode(this.model, id)) return;
    this._pendingFocus = null;
    if (!card) return;
    if (focus) card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  _def(model = this.model) {
    return this.view === 'components' && model ? getDef(model, this._componentId) : null;
  }

  _tops(model = this.model) {
    if (!model) return [];
    if (this.view !== 'components') return [{ node: model.root, def: null }];
    const def = this._def(model);
    return def ? [{ node: def.node, def }] : [];
  }

  _rows({ all = false, model = this.model } = {}) {
    const folded = all ? undefined : (key, open) => isFolded(this._folds, key, open);
    return this._tops(model).flatMap(({ node, def }) => visibleRows(model, node, folded, def));
  }

  _card(key) {
    return this.shadowRoot.querySelector(`[role="treeitem"][data-key="${CSS.escape(key)}"]`);
  }

  /**
   * Opens a node's ancestors, scrolls to its card and optionally focuses it. Only top-level rows
   * are revealed: the store shows a component's fields on its own page (see modes.js).
   */
  reveal(nodeId, { focus = true } = {}) {
    const rows = this._rows({ all: true, model: this.store.model });
    const row = rows.find((r) => r.key === nodeId);
    if (!row) return;
    this._setOpen(ancestorKeys(rows, row.key), true);
    this._focusRow(row.key, nodeId, { focus });
  }

  _setOpen(keys, open) {
    if (keys.length) this._folds = withOpen(this._folds, keys, open);
  }

  _focusRow(key, id, { focus = true } = {}) {
    this._focusKey = key;
    this._pendingFocus = { key, id, focus };
    this.requestUpdate();
  }

  announce(message) {
    const region = this.shadowRoot.querySelector('.live');
    if (region) region.textContent = message;
  }

  /** Brings Properties to the front of the tool panel; `open` also reopens a closed panel. */
  _showProperties({ tab, open = false } = {}) {
    this.store.bus.panelRequest.emit({ view: 'properties', tab, open });
  }

  _select(nodeId) {
    if (nodeId !== this.store.selection) this.store.select(nodeId);
    else this.requestUpdate();
  }

  /** Clicking or focusing a row selects it; a preview row selects its component use. */
  _activate({ key, id, scope }) {
    this._focusKey = key;
    this._select(inPreview(scope) ? outerUse(scope) : id);
  }

  /** A use opens its component's page; a preview row opens it with that field selected. */
  _openComponent({ id, scope }) {
    if (inPreview(scope)) this.store.select(id, { reveal: true });
    else editComponent(this.store, { nodeId: id });
    this._showProperties();
  }

  _onCardClick(row) {
    this._activate(row);
    this._showProperties();
  }

  _onDoubleClick(node, row) {
    if (inPreview(row.scope) || node.kind === 'ref') this._openComponent(row);
  }

  /** Opens every row, component uses included, or folds all but the top. */
  _setAllOpen(open) {
    this._folds = withOpen(NO_FOLDS, foldableKeys(this._rows({ all: true })), open);
  }

  _openProperties(nodeId, tab) {
    this._select(nodeId);
    this._showProperties({ tab, open: true });
  }

  _onAdd(parentId, index, menuId) {
    return insertPaletteItem(this.store, parseMenuId(menuId), { parentId, index });
  }

  _remove(node) {
    const label = labelOf(this.model, node);
    if (remove(this.store, node.id).ok) this.announce(`Deleted ${label}.`);
  }

  _onCardAction(node, row, id) {
    const actions = {
      properties: () => this._openProperties(node.id, 'settings'),
      json: () => this._openProperties(node.id, 'json'),
      up: () => moveBy(this.store, node.id, -1),
      down: () => moveBy(this.store, node.id, 1),
      duplicate: () => duplicate(this.store, node.id),
      component: () => makeReusable(this.store, node.id),
      edit: () => this._openComponent(row),
      detach: () => this.store.dispatch(detachRef, { nodeId: node.id }),
      delete: () => this._remove(node),
      deleteDef: () => deleteComponent(this.store, findNode(this.model, node.id)?.def?.id),
    };
    actions[id]?.();
  }

  _onKeyDown(event) {
    if (event.target.closest?.('input, textarea, nx-menu')) return;
    const card = event.target.closest?.('[role="treeitem"]');
    const id = card?.dataset.nodeId;
    const key = card?.dataset.key;
    const scope = card?.dataset.scope ?? '';
    const entry = findNode(this.model, id);
    if (!entry) return;
    const mod = event.metaKey || event.ctrlKey;
    const top = !entry.parent;
    const row = { key, id, scope };

    const run = (fn) => {
      event.preventDefault();
      fn();
    };
    // A preview row only opens its component, where it can be edited.
    const locked = inPreview(scope);
    if (locked && event.key === 'Enter') {
      run(() => this._openComponent(row));
      return;
    }
    if (!locked && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      run(() => moveBy(this.store, id, event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (!locked && mod && event.key.toLowerCase() === 'd') {
      run(() => duplicate(this.store, id));
      return;
    }
    if (!locked && !mod && !top && (event.key === 'Delete' || event.key === 'Backspace')) {
      run(() => this._remove(entry.node));
      return;
    }
    if (event.key === 'Enter') {
      run(() => {
        this._activate(row);
        this._showProperties();
      });
      return;
    }
    if (event.key === 'Escape' && this.selection) {
      run(() => this.store.select(null));
      return;
    }
    const rows = this._rows();
    const move = treeKey(rows, key, event.key);
    if (move) run(() => this._navigate(rows, move));
  }

  _navigate(rows, move) {
    if (move.expand) this._setOpen([move.expand], true);
    if (move.collapse) this._setOpen([move.collapse], false);
    if (move.focus) {
      const target = rows.find((row) => row.key === move.focus);
      this._activate(target);
      this._focusRow(target.key, target.id);
    }
  }

  _menuItems(node, parent) {
    const inGroup = parent?.kind === 'object';
    const siblings = inGroup ? parent.children : [];
    const index = siblings.indexOf(node);
    const items = [
      { id: 'properties', label: 'Properties', icon: iconFile('properties') },
    ];
    if (inGroup) {
      items.push({ divider: true });
      if (index > 0) items.push({ id: 'up', label: 'Move up' });
      if (index < siblings.length - 1) items.push({ id: 'down', label: 'Move down' });
      items.push({ id: 'duplicate', label: 'Duplicate', icon: iconFile('duplicate') });
    }
    if (node.kind === 'ref') {
      items.push({ divider: true });
      items.push({ id: 'edit', label: 'Edit component', icon: iconFile('component') });
      items.push({ id: 'detach', label: 'Detach from component' });
    } else if (isContainer(node) && parent) {
      items.push({ divider: true });
      items.push({ id: 'component', label: 'Make reusable component', icon: iconFile('component') });
    }
    items.push({ divider: true });
    items.push({ id: 'json', label: 'View JSON', icon: iconFile('code') });
    if (parent) items.push({ id: 'delete', label: 'Delete', icon: iconFile('delete') });
    else items.push({ id: 'deleteDef', label: 'Delete component', icon: iconFile('delete') });
    return items;
  }

  _renderAdd(parentId, index, label) {
    return html`
      <nx-menu placement="below-end" .items=${paletteMenuItems(this.model, parentId)}
        @select=${(e) => this._onAdd(parentId, index, e.detail.id)}>
        <button slot="trigger" type="button" class="nx-action-btn-quiet add-btn"
          @click=${(e) => e.stopPropagation()}>${icon('add')} ${label}</button>
      </nx-menu>
    `;
  }

  _renderTitle(node, parent, def) {
    const title = labelOf(this.model, node) || 'Untitled';
    return html`
      <span class="card-title">${title}</span>
      ${def && def.name !== title ? html`<span class="card-key muted">${def.name}</span>` : nothing}
      ${parent?.kind === 'object' ? html`<span class="card-key muted">${node.key}</span>` : nothing}
      ${parent?.kind === 'array' ? html`<span class="card-key muted">(item)</span>` : nothing}
    `;
  }

  _renderIssue(node) {
    const issues = this._issues?.get(node.id);
    const severity = worstSeverity(issues);
    if (!severity || severity === 'info') return nothing;
    const text = issues.filter((i) => i.severity === severity).map((i) => i.message).join('\n');
    return html`<span class="card-issue is-${severity}" title=${text}>
      ${icon('alert')}<span class="sr-only">${severity}: ${text}</span></span>`;
  }

  _renderActions(node, parent, row, def, partOf) {
    // The schema has no actions; keep their column so its kind lines up.
    if (!parent && !def) return html`<span class="card-actions-space" aria-hidden="true"></span>`;
    // In place of the actions, so preview rows read as locked, not just grey.
    if (partOf) {
      return html`<span class="card-lock" aria-hidden="true"
        title=${`Part of the ${partOf.name} component`}>${icon('lock')}</span>`;
    }
    return html`
      <span class="card-actions" @click=${(e) => e.stopPropagation()}>
        <nx-menu placement="below-end" .items=${this._menuItems(node, parent)}
          @select=${(e) => this._onCardAction(node, row, e.detail.id)}>
          <button slot="trigger" type="button" class="nx-action-btn-quiet nx-action-btn-icon"
            tabindex="-1" title="Item actions" aria-label="Item actions">${icon('more')}</button>
        </nx-menu>
      </span>
    `;
  }

  /**
   * Classes and note (hint or refusal reason) of a drop zone while a drag hovers it. Zones
   * match on `scope` too, as a component's zones repeat under each use.
   */
  _zone(key, scope, classes) {
    const mark = this._dnd.markFor(key, scope);
    let note = nothing;
    if (mark?.reason) note = html`<span class="drop-reason" role="status">${mark.reason}</span>`;
    else if (mark?.hint) note = html`<span class="drop-hint">${mark.hint}</span>`;
    return { className: [classes, mark?.className].filter(Boolean).join(' '), note };
  }

  _zoneText(zone, text) {
    return zone.note === nothing ? html`<span class="muted">${text}</span>` : zone.note;
  }

  _renderGap(parentId, index, scope) {
    const zone = this._zone(`${parentId}:${index}`, scope, 'gap');
    return html`<div class=${zone.className} data-parent-id=${parentId} data-index=${index}
      data-scope=${scope}>${zone.note}</div>`;
  }

  /**
   * The rows under a card. `open` (see `opening`) owns them: the card's Group or List, or a use's
   * component node, previewed here. Preview rows take no drops, so spacers replace their gaps.
   * `partOf` is the component the card previews; `note` (a drop refusal) shows over the rows.
   */
  _renderBody(open, level, partOf, note = nothing) {
    const { owner, scope, seen } = open;
    const ctx = {
      scope, seen, locked: inPreview(scope), partOf: open.def ?? partOf, note,
    };
    if (owner.kind === 'object') return this._renderGroupBody(owner, level, ctx);
    if (owner.kind === 'array') return this._renderListBody(owner, level, ctx);
    return nothing;
  }

  /** A narrow canvas hides the usage count (`.card-kind-more`). */
  _renderUseKind(def) {
    const used = refUsages(this.model, def.id).length;
    return html`<span class="card-kind is-use-kind muted">Component: ${def.name}<span class="card-kind-more"> · used ${usedTimes(used)}</span></span>`;
  }

  _renderGroupBody(node, level, ctx) {
    const children = node.children ?? [];
    const gap = (index) => (ctx.locked
      ? html`<div class="spacer"></div>`
      : this._renderGap(node.id, index, ctx.scope));
    return html`
      <div role="group" class="children" data-locked=${ctx.locked ? '' : nothing}>
        ${ctx.note ?? nothing}
        ${children.map((child, index) => html`
          ${gap(index)}
          ${this._renderCard(child, node, index, level + 1, ctx)}
        `)}
        ${children.length ? gap(children.length) : this._renderEmptyZone(node, ctx)}
      </div>
    `;
  }

  /** An empty group's only drop target; filled groups take drops on gaps and heads. */
  _renderEmptyZone(node, { scope, locked }) {
    if (locked) return html`<div class="drop-zone is-static"><span class="muted">No fields yet</span></div>`;
    const zone = this._zone(`${node.id}:0`, scope, 'drop-zone');
    return html`
      <div class=${zone.className} data-parent-id=${node.id} data-index="0" data-scope=${scope}>
        ${this._zoneText(zone, 'Drop elements here')}
        ${this._renderAdd(node.id, 0, 'Add')}
      </div>
    `;
  }

  _renderListBody(node, level, ctx) {
    if (ctx.locked) {
      return html`
        <div role="group" class="children is-slot" data-locked>
          ${ctx.note ?? nothing}
          ${node.item ? html`<div class="slot">${this._renderCard(node.item, node, 0, level + 1, ctx)}</div>`
    : html`<div class="drop-zone is-static"><span class="muted">No item type yet</span></div>`}
        </div>
      `;
    }
    const slot = this._zone(`${node.id}:slot`, ctx.scope, node.item ? 'slot' : 'drop-zone');
    return html`
      <div role="group" class="children is-slot">
        ${node.item ? html`
          <div class=${slot.className} data-parent-id=${node.id} data-slot data-scope=${ctx.scope}>
            ${this._renderCard(node.item, node, 0, level + 1, ctx)}
            ${slot.note}
          </div>
        ` : html`
          <div class=${slot.className} data-parent-id=${node.id} data-slot data-scope=${ctx.scope}>
            ${this._zoneText(slot, 'Drop the element each list entry should be')}
            ${this._renderAdd(node.id, undefined, 'Choose')}
          </div>
        `}
      </div>
    `;
  }

  _headTitle(open, partOf) {
    if (partOf) return `Part of the ${partOf.name} component. Double-click to edit it on the Components page.`;
    if (open?.def) return `Uses the ${open.def.name} component. Double-click to edit it on the Components page.`;
    return nothing;
  }

  /**
   * @param {object} ctx - `scope` (the uses the card shows under), `seen` (their components),
   *   `partOf` (the component a preview row is part of), `def` (when `node` is a component's top).
   */
  _renderCard(node, parent, index, level, ctx) {
    const { scope, seen, def } = ctx;
    const key = rowKey(scope, node.id);
    const open = opening(this.model, node, scope, seen);
    const expanded = Boolean(open) && !isFolded(this._folds, key, open);
    const selected = key === this._selKey;
    const chips = constraintChips(node);
    const partOf = inPreview(scope) ? ctx.partOf : null;
    const movable = Boolean(parent) && !partOf;
    const blocked = Boolean(open?.def) && this._dnd.blockedFor(key);
    const row = { key, id: node.id, scope };
    const classes = [
      'card',
      parent ? '' : 'is-top',
      def ? 'is-def' : '',
      selected ? 'is-selected' : '',
      node.kind === 'unsupported' ? 'is-unsupported' : '',
      node.kind === 'ref' ? 'is-ref' : '',
      partOf ? 'is-locked' : '',
      open?.def ? 'is-use' : '',
      blocked ? 'is-drop-blocked' : '',
    ].filter(Boolean).join(' ');
    const name = [labelOf(this.model, node) || 'Untitled', kindLabel(this.model, node), ...chips]
      .join(', ');

    return html`
      <div class=${classes} role="treeitem" data-node-id=${node.id} data-key=${key}
        data-scope=${scope} data-index=${index} data-kind=${node.kind}
        data-locked=${partOf ? '' : nothing}
        aria-level=${level} aria-selected=${selected ? 'true' : 'false'}
        aria-expanded=${open ? String(expanded) : nothing}
        aria-label=${partOf ? `${name}, part of ${partOf.name}, read-only` : name}
        tabindex=${key === this._tabKey ? '0' : '-1'}
        @focus=${(e) => { if (e.target === e.currentTarget) this._activate(row); }}>
        <div class="card-head" @click=${() => this._onCardClick(row)}
          @dblclick=${() => this._onDoubleClick(node, row)}
          title=${this._headTitle(open, partOf)}
          draggable=${movable ? 'true' : 'false'}
          data-drag-node=${movable ? node.id : nothing}>
          <div class="card-row">
            <span class="card-icon">${icon(cardIcon(node, { def }))}</span>
            ${open ? this._renderToggle(key, expanded) : nothing}
            <span class="card-names">${this._renderTitle(node, parent, def)}</span>
            ${open?.def ? this._renderUseKind(open.def)
    : html`<span class="card-kind muted">${kindLabel(this.model, node)}${!parent && def ? ` · ${this._usage(def)}` : ''}</span>`}
            ${chips.length ? this._renderChips(node, chips) : nothing}
            ${this._renderIssue(node)}
            ${this._renderActions(node, parent, row, def, partOf)}
          </div>
        </div>
        ${expanded ? this._renderBody(open, level, partOf, blocked
    ? this._renderBlockedNote(open.def) : nothing) : nothing}
        ${node.kind === 'unsupported' ? html`<p class="unsupported-note muted">
          This part of the schema can't be edited visually. It is kept as is.</p>` : nothing}
      </div>
    `;
  }

  /** The title repeats the text, as the pill truncates it. */
  _renderBlockedNote(def) {
    const text = `${def.name} is a component. Edit it on the Components page.`;
    return html`<span class="drop-reason" role="status" title=${text}>${text}</span>`;
  }

  /** All the chips, and the compact set a narrow canvas shows instead. */
  _renderChips(node, chips) {
    const chip = (text) => html`<span class="chip">${text}</span>`;
    return html`
      <span class="card-chips">${chips.map(chip)}</span>
      <span class="card-chips is-compact" title=${chips.join(' · ')}>
        ${compactChips(node).map(chip)}</span>
    `;
  }

  _renderToggle(key, expanded) {
    const label = expanded ? 'Collapse' : 'Expand';
    return html`
      <button type="button" class=${`tree-toggle${expanded ? ' is-expanded' : ''}`} tabindex="-1"
        aria-label=${label} title=${label}
        @click=${(e) => { e.stopPropagation(); this._setOpen([key], !expanded); }}>
        ${icon('chevronRight')}</button>
    `;
  }

  _usage(def) {
    const used = refUsages(this.model, def.id).length;
    return usageLabel(used);
  }

  _renderTrees() {
    return this._tops().map(({ node, def }) => this._renderCard(node, null, 0, 1, {
      scope: '', seen: new Set(def ? [def.id] : []), def,
    }));
  }

  /** Shown if anything below the top folds; on only while every row is open. */
  _renderFoldSwitch() {
    if (!foldableKeys(this._rows({ all: true })).length) return nothing;
    return html`
      <div class="tree-tools">
        <nx-switch label="Expand all" .checked=${allOpen(this._rows())}
          @change=${(e) => this._setAllOpen(e.detail.checked)}></nx-switch>
      </div>
    `;
  }

  _renderNoComponents() {
    return html`
      <div class="empty no-components">
        ${icon('component', 'empty-icon')}
        <h2>No components yet</h2>
        <p>Define a set of fields once, like an address, and reuse it across the schema.</p>
        <button type="button" class="nx-btn-accent" @click=${() => newComponent(this.store)}>
          ${icon('add')} New component</button>
      </div>
    `;
  }

  render() {
    if (!this.model) return nothing;
    const components = this.view === 'components';
    if (components && !this.model.defs.length) return this._renderNoComponents();
    const shown = this._def();
    return html`
      <div class="canvas">
        ${components ? html`
          <se-component-head .store=${this.store} .model=${this.model}
            .componentId=${shown?.id ?? null}></se-component-head>
        ` : nothing}
        ${this._renderFoldSwitch()}
        <div role="tree" class="tree ${this._dnd.dragging ? 'is-dragging' : ''}"
          aria-label=${components ? `Component ${shown?.name ?? ''}`.trim() : 'Schema structure'}
          @keydown=${this._onKeyDown}
          @dragstart=${this._dnd.handlers.dragstart} @dragover=${this._dnd.handlers.dragover}
          @dragleave=${this._dnd.handlers.dragleave} @drop=${this._dnd.handlers.drop}
          @dragend=${this._dnd.handlers.dragend}>
          ${this._renderTrees()}
        </div>
        <div class="live sr-only" aria-live="polite"></div>
      </div>
    `;
  }
}

if (!customElements.get('se-canvas')) customElements.define('se-canvas', SeCanvas);
