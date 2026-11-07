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
/* eslint-disable import/no-unresolved */
import { html, nothing } from 'da-lit';
import { pageType, primarySync, SYNC_DISPLAY } from '../data/display.js';
import { langBadge, badge, pageLabel } from './common.js';

function cardBadge(result) {
  if (!result) return html`<span class="muted small-text">Checking…</span>`;
  const sync = primarySync(result);
  if (sync) {
    const display = SYNC_DISPLAY[sync] ?? { label: sync, tone: 'neutral' };
    return badge(display.label, display.tone);
  }
  return badge(pageType(result).label, 'neutral');
}

function renderCard(entry, layout, ctx) {
  const { node } = entry;
  const result = ctx.results.get(node.key);
  const type = result ? pageType(result) : null;
  const selected = node.key === ctx.selectedKey;
  const classes = [
    'map-card',
    type?.group === 'inherited' ? 'inherited' : '',
    entry.independent ? 'independent' : '',
    type?.group === 'missing' ? 'missing' : '',
    selected ? 'selected' : '',
  ].join(' ');
  const { cardWidth, cardHeight } = layout.sizes;
  return html`
    <div class=${classes} data-key=${node.key}
      style="left: ${entry.x}px; top: ${entry.y}px; width: ${cardWidth}px; height: ${cardHeight}px">
      <button type="button" class="map-card-main" aria-pressed=${String(selected)}
        aria-label="${pageLabel(node)}, ${node.site}:${node.path}"
        @click=${() => ctx.onSelect(node)}>
        <span class="map-card-line">
          ${langBadge(node.location)}
          <span class="map-card-title">${node.parent ? node.location.label : node.title}</span>
        </span>
        <span class="map-card-line">${cardBadge(result)}${result?.status?.overridden ? html`<span class="badge outline">Overridden</span>` : nothing}</span>
      </button>
      ${entry.hasChildren ? html`
        <button type="button" class="map-collapse" aria-expanded=${String(!entry.collapsed)}
          aria-label="${entry.collapsed ? 'Expand' : 'Collapse'} ${pageLabel(node)}"
          @click=${() => ctx.onCollapse(entry)}>${entry.collapsed ? `+${entry.hidden}` : '−'}</button>` : nothing}
    </div>`;
}

function renderControls(ctx) {
  const { mapState } = ctx;
  return html`
    <div class="map-toolbar">
      <label class="map-select">
        <span>Show</span>
        <select @change=${(event) => ctx.onRoot(event.target.value)}>
          <option value="all" ?selected=${mapState.root === 'all'}>All source pages</option>
          ${ctx.roots.map((node) => html`
            <option value=${node.key} ?selected=${mapState.root === node.key}>${node.title} (${node.path})</option>`)}
        </select>
      </label>
      <label class="switch"><input type="checkbox" .checked=${ctx.needsActionOnly}
        @change=${(event) => ctx.onOption('needsActionOnly', event.target.checked)}> Needs action only</label>
      <label class="switch"><input type="checkbox" .checked=${mapState.collapseLocales}
        @change=${(event) => ctx.onOption('collapseLocales', event.target.checked)}> Collapse deepest level</label>
      <label class="switch"><input type="checkbox" .checked=${mapState.showIndependent}
        @change=${(event) => ctx.onOption('showIndependent', event.target.checked)}> Show independent</label>
      <span class="spacer"></span>
      <div class="zoom-group" role="group" aria-label="Zoom">
        <button type="button" class="btn small" aria-label="Zoom out" @click=${() => ctx.onZoom(1 / 1.25)}>−</button>
        <span class="zoom-value">${Math.round((mapState.view?.scale ?? 1) * 100)}%</span>
        <button type="button" class="btn small" aria-label="Zoom in" @click=${() => ctx.onZoom(1.25)}>+</button>
        <button type="button" class="btn small" @click=${ctx.onFit}>Fit</button>
      </div>
    </div>`;
}

export default function renderMapView(layout, ctx) {
  const view = ctx.mapState.view ?? { x: 0, y: 0, scale: 1 };
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  const edges = layout.edges.map((edge) => edge.path).join(' ');
  const selectedEdges = layout.edges
    .filter((edge) => edge.to === ctx.selectedKey || edge.from === ctx.selectedKey)
    .map((edge) => edge.path).join(' ');
  const { cardWidth } = layout.sizes;
  return html`
    <section class="map-panel" aria-label="Map view">
      ${renderControls(ctx)}
      <div class="map-columns" aria-hidden="true">
        ${layout.columns.map((column) => html`
          <span class="map-column-label" style="left: ${view.x + column.x * view.scale}px; width: ${cardWidth * view.scale}px">${column.label}</span>`)}
      </div>
      <div class="map-viewport"
        @pointerdown=${ctx.onPointerDown}
        @pointermove=${ctx.onPointerMove}
        @pointerup=${ctx.onPointerUp}
        @pointercancel=${ctx.onPointerUp}
        @wheel=${ctx.onWheel}>
        <div class="map-canvas" style="width: ${layout.width}px; height: ${layout.height}px; transform: ${transform}">
          <svg class="map-edges" width=${layout.width} height=${layout.height} aria-hidden="true">
            <path class="edge" d=${edges || 'M0,0'}></path>
            <path class="edge selected" d=${selectedEdges || 'M0,0'}></path>
          </svg>
          ${layout.nodes.map((entry) => renderCard(entry, layout, ctx))}
        </div>
        ${!layout.nodes.length ? html`<div class="map-empty">No pages match.</div>` : nothing}
        <span class="map-hint">Drag empty space to pan · Ctrl + scroll to zoom</span>
      </div>
      <p class="map-legend">Lines connect each page to its source. Dashed border = inherited (no own file). Independent pages have no line; updates never reach them.</p>
    </section>`;
}
