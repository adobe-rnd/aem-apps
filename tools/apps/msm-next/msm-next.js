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
/* eslint-disable import/no-unresolved, no-console */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { LitElement, html, nothing } from 'da-lit';
import createLoader from './data/loader.js';
import createMockLocalization from './data/mock/mock-localization.js';
import { MOCK_ORG, MOCK_SITE } from './data/mock/fixture.js';
import {
  flattenRows, visibleSet, matchesKind, matchesQuery, matchesType, countPages, ancestors,
  attentionList, nodeKey,
} from './data/tree.js';
import {
  needsAction, editUrl, reasonText, ACTION_LABELS,
} from './data/display.js';
import { buildTargetTree, toggleTarget, setMany } from './data/targets.js';
import {
  layoutMap, fitView, fitWidth, zoomView, toggleCollapse,
} from './data/map-layout.js';
import { mergeRuns, translatingItems, runStatus } from './data/run-view.js';
import renderTreeTable from './views/tree-table.js';
import renderDetailPanel from './views/detail-panel.js';
import renderActionDrawer from './views/action-drawer.js';
import renderRunsView from './views/runs-view.js';
import renderMapView from './views/map-view.js';
import { pageLabel } from './views/common.js';

const NX = 'https://da.live/nx';
const SDK_TIMEOUT = 5000;
let styles = null;
try {
  const { default: getStyle } = await import(`${NX}/utils/styles.js`);
  styles = await getStyle(import.meta.url);
} catch (e) {
  console.warn('Failed to load styles:', e);
}

const CARDS = [
  { type: 'all', label: 'All pages' },
  { type: 'source', label: 'Sources' },
  { type: 'copies', label: 'Local copies & translations' },
  { type: 'inherited', label: 'Inherited' },
  { type: 'independent', label: 'Independent' },
];

const KINDS = [
  { kind: 'all', label: 'All' },
  { kind: 'localization', label: 'Localization' },
  { kind: 'variation', label: 'Variations' },
];

const ERROR_LABELS = {
  'action-unavailable': 'This action is not available for the page',
  'action-disabled': 'This action is disabled',
  'option-not-allowed': 'This option is not allowed here',
  'target-unreadable': 'The written page could not be read back',
  'remove-failed': 'The local copy could not be deleted',
};

const RUN_LIST_LIMIT = 15;
const JOB_CHECK_DELAY = 400;

const pageRef = ({ site, path }) => ({ site, path });

const describeFailure = (result) => {
  const reasons = reasonText(result?.reasons);
  const base = ERROR_LABELS[result?.error] ?? result?.error ?? 'Something went wrong';
  return reasons ? `${base}: ${reasons}` : base;
};

class MsmNextApp extends LitElement {
  static properties = {
    localization: { attribute: false },
    org: { attribute: false },
    site: { attribute: false },
    mode: { attribute: false },
    notice: { attribute: false },
    phase: { state: true },
    error: { state: true },
    tick: { state: true },
    query: { state: true },
    needsActionOnly: { state: true },
    kind: { state: true },
    type: { state: true },
    expanded: { state: true },
    selectedKey: { state: true },
    focusKey: { state: true },
    busy: { state: true },
    toast: { state: true },
    confirm: { state: true },
    view: { state: true },
    tab: { state: true },
    picked: { state: true },
    drawer: { state: true },
    runs: { state: true },
    activeRunId: { state: true },
    runBusy: { state: true },
    runsLoading: { state: true },
    runsError: { state: true },
    starting: { state: true },
    jobInfo: { state: true },
    checking: { state: true },
    mapState: { state: true },
  };

  constructor() {
    super();
    this.phase = 'loading';
    this.tick = 0;
    this.query = '';
    this.needsActionOnly = false;
    this.kind = 'all';
    this.type = 'all';
    this.expanded = new Set();
    this.busy = new Set();
    this.view = 'tree';
    this.tab = 'pages';
    this.picked = new Set();
    this.drawer = null;
    this.runs = [];
    this.runBusy = new Set();
    this.runChecked = new Map();
    this.liveRuns = new Set();
    this.autoResumed = new Set();
    this.jobInfo = new Map();
    this.jobChecked = new Set();
    this.checking = new Set();
    this.visibleKeys = [];
    this.mapState = {
      root: 'all',
      collapsed: new Set(),
      expanded: new Set(),
      collapseLocales: false,
      showIndependent: false,
      view: null,
    };
  }

  connectedCallback() {
    super.connectedCallback();
    if (styles) this.shadowRoot.adoptedStyleSheets = [styles];
    this.loader = createLoader({
      localization: this.localization,
      list: this.localization.list,
      site: this.site,
      onChange: () => { this.tick += 1; },
    });
    this.unsubscribe = this.localization.subscribe?.(
      (page) => this.refreshKey(nodeKey(page.site, page.path)),
    );
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    clearTimeout(this.jobTimer);
  }

  updated() {
    if (this.phase !== 'ready') return;
    if (this.tab === 'pages') this.scheduleJobCheck();
    if (this.tab === 'runs') this.autoResume();
    if (this.tab === 'pages' && this.view === 'map' && !this.mapState.view) this.initMapView();
  }

  async load() {
    this.phase = 'loading';
    this.error = '';
    try {
      const tree = await this.loader.load();
      if (!tree) return;
      if (!this.expanded.size && tree.top[0]) this.expanded = new Set([tree.top[0].key]);
      this.jobChecked = new Set();
      this.picked = new Set([...this.picked].filter((key) => tree.nodes.has(key)));
      this.phase = tree.nodes.size ? 'ready' : 'empty';
    } catch (e) {
      console.error(e);
      this.error = e.message || String(e);
      this.phase = 'error';
    }
  }

  refreshKey(key) {
    const node = this.loader.tree.nodes.get(key);
    if (node) this.loader.refreshSubtree(node);
  }

  get tree() { return this.loader.tree; }

  get results() { return this.loader.results; }

  showToast(message, tone = 'neutral') {
    this.toast = { message, tone };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; }, 6000);
  }

  filtering() {
    return Boolean(this.query.trim()) || this.needsActionOnly
      || this.kind !== 'all' || this.type !== 'all';
  }

  predicate() {
    return (node) => {
      const result = this.results.get(node.key);
      return matchesQuery(node, this.query)
        && matchesKind(node, this.kind)
        && matchesType(result, this.type)
        && (!this.needsActionOnly || needsAction(result));
    };
  }

  visibleRows() {
    if (!this.filtering()) {
      return { rows: flattenRows(this.tree.top, { expanded: this.expanded }), matches: null };
    }
    const { visible, matches } = visibleSet(this.tree, this.predicate());
    const rows = flattenRows(this.tree.top, {
      expanded: this.expanded, visible, forceExpand: true,
    });
    return { rows, matches };
  }

  toggle(node) {
    const expanded = new Set(this.expanded);
    if (expanded.has(node.key)) expanded.delete(node.key);
    else expanded.add(node.key);
    this.expanded = expanded;
  }

  select(node, reveal = false) {
    this.selectedKey = node.key;
    this.focusKey = node.key;
    this.confirm = null;
    if (reveal) {
      const expanded = new Set(this.expanded);
      ancestors(this.tree.nodes, node).forEach((ancestor) => expanded.add(ancestor.key));
      this.expanded = expanded;
      this.updateComplete.then(() => this.focusRow(node.key, false));
    }
  }

  focusRow(key, focus = true) {
    const row = this.shadowRoot.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    if (focus) row.focus();
  }

  moveFocus(key) {
    this.focusKey = key;
    this.updateComplete.then(() => this.focusRow(key));
  }

  handleKeydown(event, rows) {
    const index = rows.findIndex((row) => row.node.key === this.focusKey);
    const row = rows[index];
    if (!row) return;
    const { node } = row;
    const go = (target) => {
      if (!target) return;
      event.preventDefault();
      this.moveFocus(target.node.key);
    };
    switch (event.key) {
      case 'ArrowDown': go(rows[index + 1]); break;
      case 'ArrowUp': go(rows[index - 1]); break;
      case 'Home': go(rows[0]); break;
      case 'End': go(rows[rows.length - 1]); break;
      case 'ArrowRight':
        event.preventDefault();
        if (row.hasChildren && !row.expanded) this.toggle(node);
        else if (row.expanded) go(rows[index + 1]);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.expanded && !this.filtering()) this.toggle(node);
        else if (node.parent) this.moveFocus(node.parent);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.select(node);
        break;
      default:
    }
  }

  async withBusy(node, task) {
    if (this.busy.has(node.key)) return;
    this.busy = new Set([...this.busy, node.key]);
    try {
      await task();
    } catch (e) {
      console.error(e);
      this.showToast(e.message || String(e), 'negative');
    } finally {
      const busy = new Set(this.busy);
      busy.delete(node.key);
      this.busy = busy;
    }
    await this.loader.refreshSubtree(node);
  }

  runAction(node, { action, option, label }) {
    return this.withBusy(node, async () => {
      const result = await this.localization.execute({
        site: node.site, path: node.path, action, option,
      });
      const name = label ?? ACTION_LABELS[action] ?? action;
      if (result?.ok) this.showToast(`${name}: ${pageLabel(node)} (${node.path}) done`, 'positive');
      else this.showToast(`${name} failed. ${describeFailure(result)}`, 'negative');
    });
  }

  runNext(node, step) {
    if (step.kind === 'drawer' || step.label === 'Update') {
      this.openDrawerFor(node);
      return;
    }
    if (step.kind === 'review') {
      if (this.localization.resolveReview) {
        this.withBusy(node, async () => {
          await this.localization.resolveReview(node.site, node.path);
          this.showToast(`Mock: changes on ${node.path} reviewed and accepted`, 'positive');
        });
        return;
      }
      window.open(editUrl(this.org, node.site, node.path), '_blank', 'noopener');
      return;
    }
    this.runAction(node, step);
  }

  publish(node, cascade) {
    return this.withBusy(node, async () => {
      const result = await this.localization.publish({ site: node.site, path: node.path, cascade });
      const count = result?.results?.length ?? 0;
      if (result?.ok) {
        this.showToast(`Published ${count} page${count === 1 ? '' : 's'}`, 'positive');
      } else {
        const failed = (result?.results ?? []).filter((entry) => !entry.ok);
        this.showToast(`Publish failed for ${failed.length} of ${count}: ${failed[0]?.error ?? ''}`, 'negative');
      }
    });
  }

  pick(node, checked) {
    const picked = new Set(this.picked);
    if (checked) picked.add(node.key);
    else picked.delete(node.key);
    this.picked = picked;
  }

  pickAll(nodes, checked) {
    const picked = new Set(this.picked);
    nodes.forEach((node) => {
      if (checked) picked.add(node.key);
      else picked.delete(node.key);
    });
    this.picked = picked;
  }

  openDrawer(sources, focusLocationId = null) {
    if (!sources.length || !this.loader.model) return;
    const tree = buildTargetTree(this.loader.model, sources.map((node) => node.location.id));
    const selected = focusLocationId && tree.nodes.has(focusLocationId)
      ? toggleTarget(tree, new Set(), focusLocationId, true)
      : new Set(tree.nodes.keys());
    this.drawer = {
      sources, tree, selected, query: '', option: 'merge', busy: false,
    };
    this.updateComplete.then(() => this.shadowRoot.querySelector('.sheet')?.focus());
  }

  openDrawerFor(node) {
    const parent = node.parent ? this.tree.nodes.get(node.parent) : null;
    if (parent) this.openDrawer([parent], node.location.id);
    else this.openDrawer([node]);
  }

  openPickedDrawer() {
    const sources = [...this.picked].map((key) => this.tree.nodes.get(key)).filter(Boolean);
    this.openDrawer(sources);
  }

  patchDrawer(patch) {
    this.drawer = { ...this.drawer, ...patch };
  }

  removeDrawerSource(key) {
    const sources = this.drawer.sources.filter((node) => node.key !== key);
    const tree = buildTargetTree(this.loader.model, sources.map((node) => node.location.id));
    const selected = new Set([...this.drawer.selected].filter((id) => tree.nodes.has(id)));
    this.patchDrawer({ sources, tree, selected });
  }

  drawerContext() {
    return {
      results: this.results,
      rootSite: this.site,
      onClose: () => { this.drawer = null; },
      onRemoveSource: (key) => this.removeDrawerSource(key),
      onToggle: (id, checked) => this.patchDrawer({
        selected: toggleTarget(this.drawer.tree, this.drawer.selected, id, checked),
      }),
      onLevel: (ids, checked) => this.patchDrawer({
        selected: setMany(this.drawer.selected, ids, checked),
      }),
      onAll: (checked) => this.patchDrawer({
        selected: checked ? new Set(this.drawer.tree.nodes.keys()) : new Set(),
      }),
      onQuery: (query) => this.patchDrawer({ query }),
      onOption: (option) => this.patchDrawer({ option }),
      onRun: () => this.startRun(),
    };
  }

  trackRun(run, busy) {
    this.starting = null;
    this.liveRuns.add(run.id);
    this.runs = mergeRuns([run], this.runs);
    const runBusy = new Set(this.runBusy);
    if (busy) runBusy.add(run.id);
    else runBusy.delete(run.id);
    this.runBusy = runBusy;
  }

  async startRun() {
    const {
      sources, selected, option, tree,
    } = this.drawer;
    const pages = sources.map(pageRef);
    const targets = selected.size === tree.nodes.size ? undefined : [...selected];
    const title = sources.length === 1
      ? `Update ${sources[0].title} (${sources[0].path})`
      : `Update ${sources[0].title} and ${sources.length - 1} more`;
    this.drawer = null;
    this.picked = new Set();
    this.tab = 'runs';
    this.starting = title;
    this.activeRunId = null;
    this.loadRuns();
    let run = null;
    try {
      run = await this.localization.propagate({
        pages,
        targets,
        option,
        title,
        onProgress: (current) => {
          if (!this.activeRunId) this.activeRunId = current.id;
          this.trackRun(current, true);
        },
      });
      this.activeRunId = run.id;
      this.trackRun(run, false);
      const status = runStatus(run);
      this.showToast(`${title}: ${status.label.toLowerCase()}`, status.key === 'attention' ? 'negative' : 'positive');
    } catch (e) {
      console.error(e);
      this.starting = null;
      this.showToast(`Could not start the run: ${e.message || e}`, 'negative');
    }
    if (run) this.refreshAfterRun(run);
  }

  refreshAfterRun(run) {
    const keys = new Set([
      ...(run.pages ?? []).map((page) => nodeKey(page.site, page.path)),
      ...(run.items ?? []).map((item) => item.key),
    ]);
    const nodes = [...keys].map((key) => this.tree.nodes.get(key)).filter(Boolean);
    nodes.forEach((node) => this.jobChecked.delete(node.key));
    if (nodes.length) this.loader.refreshNodes(nodes);
  }

  async withRun(run, task) {
    if (this.runBusy.has(run.id)) return;
    this.runBusy = new Set([...this.runBusy, run.id]);
    try {
      await task();
    } catch (e) {
      console.error(e);
      this.showToast(e.message || String(e), 'negative');
    }
    this.trackRun(run, false);
    this.refreshAfterRun(run);
  }

  retryRun(run) {
    return this.withRun(run, () => this.localization.retryRun(run, {
      onProgress: (current) => this.trackRun(current, true),
    }));
  }

  resumeRun(run) {
    if (!this.localization.resumeRun) return Promise.resolve();
    return this.withRun(run, async () => {
      await this.localization.resumeRun(run, {
        onProgress: (current) => this.trackRun(current, true),
      });
      this.runChecked.set(run.id, new Date().toISOString());
    });
  }

  autoResume() {
    const run = this.runs.find((each) => each.id === this.activeRunId);
    if (!run || this.autoResumed.has(run.id) || this.runBusy.has(run.id)) return;
    if (!translatingItems(run).length || !this.localization.resumeRun) return;
    this.autoResumed.add(run.id);
    this.resumeRun(run);
  }

  async loadRuns() {
    const provider = this.localization.runs;
    if (!provider) {
      this.runsError = 'Runs are not available for this backend.';
      return;
    }
    this.runsLoading = true;
    this.runsError = '';
    try {
      const listed = (await provider.list(this.site)).slice(0, RUN_LIST_LIMIT);
      const read = await Promise.all(listed.map((entry) => provider.read(this.site, entry.id)
        .catch(() => null)));
      const live = this.runs.filter((run) => this.liveRuns.has(run.id));
      this.runs = mergeRuns(live, read.filter(Boolean));
      if (!this.activeRunId && !this.starting && this.runs[0]) this.activeRunId = this.runs[0].id;
    } catch (e) {
      console.error(e);
      this.runsError = `Could not load runs: ${e.message || e}`;
    } finally {
      this.runsLoading = false;
    }
  }

  showTab(tab) {
    this.tab = tab;
    if (tab === 'runs') this.loadRuns();
  }

  runsContext() {
    const { model } = this.loader;
    return {
      runs: this.runs,
      activeRunId: this.activeRunId,
      runBusy: this.runBusy,
      runChecked: this.runChecked,
      loading: this.runsLoading,
      error: this.runsError,
      starting: this.starting,
      canResume: Boolean(this.localization.resumeRun),
      locationOf: (id) => model?.locations.get(id) ?? null,
      levelOf: (id, depth) => {
        const location = model?.locations.get(id);
        return location?.level || (location ? `Level ${depth + 1}` : '');
      },
      nodeOf: (key) => this.tree.nodes.get(key),
      onOpen: (run) => { this.activeRunId = run.id; },
      onReload: () => this.loadRuns(),
      onRetry: (run) => this.retryRun(run),
      onResume: (run) => this.resumeRun(run),
      onReveal: (node) => {
        this.tab = 'pages';
        this.view = 'tree';
        this.select(node, true);
      },
    };
  }

  scheduleJobCheck() {
    if (!this.localization.checkJobs || this.jobTimer) return;
    this.jobTimer = setTimeout(() => {
      this.jobTimer = null;
      const keys = [...new Set([...this.visibleKeys, this.selectedKey].filter(Boolean))]
        .filter((key) => !this.jobChecked.has(key))
        .filter((key) => (this.results.get(key)?.status?.sync ?? []).includes('translating'));
      if (keys.length) this.checkJobs(keys);
    }, JOB_CHECK_DELAY);
  }

  async checkJobs(keys) {
    const nodes = keys.map((key) => this.tree.nodes.get(key)).filter(Boolean);
    if (!nodes.length) return [];
    nodes.forEach((node) => this.jobChecked.add(node.key));
    this.checking = new Set([...this.checking, ...nodes.map((node) => node.key)]);
    let results = [];
    try {
      results = await this.localization.checkJobs(nodes.map(pageRef));
      const jobInfo = new Map(this.jobInfo);
      const checkedAt = new Date().toISOString();
      results.forEach((result) => {
        jobInfo.set(nodeKey(result.site, result.path), { ...result, checkedAt });
      });
      this.jobInfo = jobInfo;
    } catch (e) {
      console.error(e);
      this.showToast(`Could not check translations: ${e.message || e}`, 'negative');
    } finally {
      const checking = new Set(this.checking);
      nodes.forEach((node) => checking.delete(node.key));
      this.checking = checking;
    }
    const changed = nodes.filter((node, index) => results[index]?.state !== 'translating');
    if (changed.length) await this.loader.refreshNodes(changed);
    return results;
  }

  async checkStatus(node) {
    const [result] = await this.checkJobs([node.key]);
    if (result?.state === 'ready') this.showToast(`Translation for ${node.path} is ready to save`, 'positive');
    else if (result?.state === 'translating') this.showToast(`${node.path} is still translating`);
  }

  mapRoots() {
    const root = this.mapState.root !== 'all' && this.tree.nodes.get(this.mapState.root);
    return root ? [root] : this.tree.top;
  }

  mapLayout() {
    const deps = [this.tick, this.mapState, this.needsActionOnly, this.tree];
    if (this.mapCache && this.mapCache.deps.every((dep, index) => dep === deps[index])) {
      return this.mapCache.layout;
    }
    const layout = layoutMap(this.mapRoots(), this.results, {
      collapsed: this.mapState.collapsed,
      expanded: this.mapState.expanded,
      collapseLocales: this.mapState.collapseLocales,
      showIndependent: this.mapState.showIndependent,
      needsActionOnly: this.needsActionOnly,
    });
    this.mapCache = { deps, layout };
    return layout;
  }

  viewportSize() {
    const viewport = this.shadowRoot.querySelector('.map-viewport');
    const rect = viewport?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }

  patchMap(patch) {
    this.mapState = { ...this.mapState, ...patch };
  }

  initMapView() {
    const size = this.viewportSize();
    if (!size.width) return;
    this.patchMap({ view: fitWidth(this.mapLayout(), size) });
  }

  setMapView(view) {
    this.pendingView = view;
    if (this.viewFrame) return;
    this.viewFrame = requestAnimationFrame(() => {
      const next = this.pendingView;
      this.viewFrame = null;
      this.pendingView = null;
      this.patchMap({ view: next });
    });
  }

  mapContext() {
    const current = () => this.pendingView ?? this.mapState.view ?? { x: 0, y: 0, scale: 1 };
    return {
      results: this.results,
      selectedKey: this.selectedKey,
      mapState: this.mapState,
      needsActionOnly: this.needsActionOnly,
      roots: this.tree.top,
      onSelect: (node) => this.select(node),
      onCollapse: (entry) => this.patchMap(
        toggleCollapse(this.mapState, entry.key, entry.collapsed),
      ),
      onRoot: (root) => this.patchMap({ root, view: null }),
      onOption: (key, value) => {
        if (key === 'needsActionOnly') this.needsActionOnly = value;
        else this.patchMap({ [key]: value });
      },
      onZoom: (factor) => {
        const size = this.viewportSize();
        this.pendingView = null;
        const center = { x: size.width / 2, y: size.height / 2 };
        this.patchMap({ view: zoomView(current(), factor, center) });
      },
      onFit: () => {
        this.pendingView = null;
        this.patchMap({ view: fitView(this.mapLayout(), this.viewportSize()) });
      },
      onPointerDown: (event) => {
        if (event.button !== 0 || event.target.closest('button, select, input, a')) return;
        this.drag = { x: event.clientX, y: event.clientY, view: current() };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('dragging');
      },
      onPointerMove: (event) => {
        if (!this.drag) return;
        const { view } = this.drag;
        this.setMapView({
          ...view,
          x: view.x + event.clientX - this.drag.x,
          y: view.y + event.clientY - this.drag.y,
        });
      },
      onPointerUp: (event) => {
        if (!this.drag) return;
        this.drag = null;
        event.currentTarget.classList.remove('dragging');
      },
      onWheel: (event) => {
        event.preventDefault();
        const view = current();
        if (event.ctrlKey || event.metaKey) {
          const rect = event.currentTarget.getBoundingClientRect();
          const factor = Math.exp(-event.deltaY * 0.01);
          this.setMapView(zoomView(view, factor, {
            x: event.clientX - rect.left, y: event.clientY - rect.top,
          }));
          return;
        }
        this.setMapView({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY });
      },
    };
  }

  renderHeader() {
    return html`
      <header class="app-header">
        <div class="title-group">
          <h1>Multi-site Management</h1>
          <p class="app-context">
            <span>${this.org}</span><span aria-hidden="true">/</span><strong>${this.site}</strong>
            ${this.mode === 'mock' ? html`<span class="badge informative">Mock data</span>` : nothing}
          </p>
        </div>
        <button type="button" class="btn" ?disabled=${this.phase === 'loading'} @click=${() => this.load()}>Refresh</button>
      </header>
      ${this.notice ? html`<p class="app-notice">${this.notice}</p>` : nothing}`;
  }

  renderBanner(counts) {
    const total = this.tree.nodes.size;
    const checking = counts.loaded < total;
    if (!counts.needsAction && !checking) return nothing;
    return html`
      <section class="banner ${counts.needsAction ? 'notice' : ''}" aria-label="Needs action">
        ${counts.needsAction ? html`<span class="banner-icon" aria-hidden="true">!</span>` : html`<span class="spinner"></span>`}
        <p class="banner-text">
          ${counts.needsAction ? html`<span><strong>${counts.needsAction}</strong> ${counts.needsAction === 1 ? 'page needs' : 'pages need'} action</span>` : nothing}
          ${checking ? html`<span class="banner-progress" role="status">Checking status ${counts.loaded} of ${total}…</span>` : nothing}
        </p>
        ${counts.needsAction ? html`
          <button type="button" class="btn ${this.needsActionOnly ? '' : 'notice-btn'}" aria-pressed=${String(this.needsActionOnly)}
            @click=${() => { this.needsActionOnly = !this.needsActionOnly; }}>
            ${this.needsActionOnly ? 'Show all pages' : 'Show pages needing action'}
          </button>` : nothing}
      </section>`;
  }

  renderCards(counts) {
    return html`
      <div class="cards" role="group" aria-label="Filter by page type">
        ${CARDS.map((card) => html`
          <button type="button" class="card ${this.type === card.type ? 'active' : ''}"
            aria-pressed=${String(this.type === card.type)}
            @click=${() => { this.type = card.type; }}>
            <span class="card-count">${counts[card.type]}</span>
            <span class="card-label">${card.label}</span>
          </button>`)}
      </div>`;
  }

  renderToolbar() {
    return html`
      <div class="toolbar">
        <label class="search">
          <span class="visually-hidden">Search pages</span>
          <input type="search" placeholder="Search pages, paths or languages" .value=${this.query}
            @input=${(event) => { this.query = event.target.value; }}>
        </label>
        <div class="segmented" role="group" aria-label="View">
          ${['tree', 'map'].map((view) => html`
            <button type="button" aria-pressed=${String(this.view === view)}
              @click=${() => { this.view = view; }}>${view === 'tree' ? 'Tree' : 'Map'}</button>`)}
        </div>
        ${this.filtering() ? html`
          <button type="button" class="btn quiet" @click=${() => this.clearFilters()}>Clear filters</button>` : nothing}
        <span class="spacer"></span>
        <div class="segmented" role="group" aria-label="Location kind">
          ${KINDS.map((entry) => html`
            <button type="button" aria-pressed=${String(this.kind === entry.kind)}
              @click=${() => { this.kind = entry.kind; }}>${entry.label}</button>`)}
        </div>
      </div>`;
  }

  clearFilters() {
    this.query = '';
    this.needsActionOnly = false;
    this.kind = 'all';
    this.type = 'all';
  }

  renderSelectionBar() {
    const count = this.picked.size;
    return html`
      <div class="selection-bar ${count ? 'active' : ''}" role="region" aria-label="Selection">
        <span>${count ? html`<strong>${count}</strong> source page${count === 1 ? '' : 's'} selected` : 'Select source pages to update or create their targets in one run.'}</span>
        ${count ? html`<button type="button" class="btn quiet small" @click=${() => { this.picked = new Set(); }}>Clear</button>` : nothing}
        <span class="spacer"></span>
        <button type="button" class="btn accent" ?disabled=${!count} @click=${() => this.openPickedDrawer()}>Update / Create…</button>
      </div>`;
  }

  renderWorkspace() {
    const { rows, matches } = this.visibleRows();
    if (!rows.some((row) => row.node.key === this.focusKey) && rows[0]) {
      this.focusKey = rows[0].node.key;
    }
    const selected = this.selectedKey ? this.tree.nodes.get(this.selectedKey) : null;
    const ctx = {
      results: this.results,
      errors: this.loader.errors,
      refreshing: this.loader.refreshing,
      busy: this.busy,
      selectedKey: this.selectedKey,
      focusKey: this.focusKey,
      rootSite: this.site,
      org: this.org,
      matches,
      confirm: this.confirm,
      publishState: this.localization.publishState,
      emptyMessage: this.filtering() ? 'No pages match these filters.' : 'No pages found.',
      attention: selected ? attentionList(selected, this.results) : [],
      onToggle: (node) => this.toggle(node),
      onSelect: (node, reveal) => this.select(node, reveal),
      onNext: (node, step) => this.runNext(node, step),
      onAction: (node, button) => this.runAction(node, button),
      onPublish: (node, cascade) => this.publish(node, cascade),
      onConfirm: (confirm) => { this.confirm = confirm; },
      onKeydown: (event) => this.handleKeydown(event, rows),
      picked: this.picked,
      onPick: (node, checked) => this.pick(node, checked),
      onPickAll: (nodes, checked) => this.pickAll(nodes, checked),
      jobInfo: this.jobInfo,
      checking: this.checking,
      onCheckStatus: this.localization.checkJobs ? (node) => this.checkStatus(node) : null,
      onOpenDrawer: this.localization.propagate ? (node) => this.openDrawerFor(node) : null,
    };
    let main;
    if (this.view === 'map') {
      const layout = this.mapLayout();
      this.visibleKeys = layout.nodes.map((entry) => entry.key);
      main = renderMapView(layout, this.mapContext());
    } else {
      this.visibleKeys = rows.map((row) => row.node.key);
      main = html`<section class="table-wrap" aria-label="Tree view">${renderTreeTable(rows, ctx)}</section>`;
    }
    return html`
      ${this.view === 'tree' ? this.renderSelectionBar() : nothing}
      <div class="workspace">
        ${main}
        <aside class="detail" aria-label="Page details">${renderDetailPanel(selected, ctx)}</aside>
      </div>`;
  }

  renderTabs() {
    const active = this.runs.filter((run) => runStatus(run, this.runBusy.has(run.id)).key !== 'done').length;
    return html`
      <nav class="tabs" aria-label="Sections">
        ${[['pages', 'Pages'], ['runs', 'Runs']].map(([tab, label]) => html`
          <button type="button" class="tab ${this.tab === tab ? 'active' : ''}" aria-current=${this.tab === tab ? 'page' : 'false'}
            @click=${() => this.showTab(tab)}>${label}
            ${tab === 'runs' && (active || this.starting) ? html`<span class="count-pill">${active + (this.starting ? 1 : 0)}</span>` : nothing}
          </button>`)}
      </nav>`;
  }

  renderBody() {
    if (this.phase === 'error') {
      return html`<div class="state error-text" role="alert">Could not load: ${this.error}</div>`;
    }
    if (this.phase === 'loading') {
      return html`<div class="state"><span class="spinner"></span> Loading locations and pages…</div>`;
    }
    if (this.phase === 'empty') {
      return html`<div class="state">No localization locations are configured for <strong>${this.site}</strong>.</div>`;
    }
    if (this.tab === 'runs') {
      return html`${this.renderTabs()}${renderRunsView(this.runsContext())}`;
    }
    const counts = countPages(this.tree, this.results, this.kind);
    return html`
      ${this.renderTabs()}
      ${this.renderBanner(counts)}
      ${this.renderCards(counts)}
      ${this.renderToolbar()}
      ${this.renderWorkspace()}`;
  }

  render() {
    return html`
      ${this.renderHeader()}
      ${this.renderBody()}
      ${this.drawer ? renderActionDrawer(this.drawer, this.drawerContext()) : nothing}
      <div class="toast-region" role="status" aria-live="polite">
        ${this.toast ? html`<div class="toast ${this.toast.tone}">${this.toast.message}
          <button type="button" class="toast-close" aria-label="Dismiss" @click=${() => { this.toast = null; }}>×</button></div>` : nothing}
      </div>`;
  }
}

customElements.define('msm-next-app', MsmNextApp);

const timeout = (ms) => new Promise((resolve) => { setTimeout(() => resolve(null), ms); });

async function resolveSetup() {
  const params = new URLSearchParams(window.location.search);
  const mockSetup = (notice) => ({
    mode: 'mock',
    org: MOCK_ORG,
    site: MOCK_SITE,
    localization: createMockLocalization(),
    notice,
  });
  if (params.get('mock') === '1') return mockSetup();
  if (window.self === window.top) return mockSetup('Not running inside DA, so this shows mock data. Open the app from da.live to see real content.');
  const sdk = await Promise.race([DA_SDK, timeout(SDK_TIMEOUT)]);
  if (!sdk?.actions?.daFetch) return mockSetup('DA did not respond, so this shows mock data.');
  const org = params.get('org') || sdk.context?.org;
  const site = params.get('site') || sdk.context?.repo;
  if (!org || !site) return mockSetup('No org or site in the DA context, so this shows mock data.');
  const { default: createRealLocalization } = await import('./data/real-localization.js');
  return {
    mode: 'real',
    org,
    site,
    localization: createRealLocalization({ org, actions: sdk.actions }),
  };
}

(async function init() {
  const setup = await resolveSetup();
  const app = document.createElement('msm-next-app');
  Object.assign(app, setup);
  document.body.append(app);
}());
