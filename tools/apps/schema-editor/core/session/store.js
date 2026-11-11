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
// SchemaStore: the single source of truth of one authoring session. Views never mutate the
// model or touch storage; they call `dispatch` / `save` and listen to `bus`. Injected:
// `repository` (only `read` / `save`, see catalog.js) and the optional SDK `validateSchema`.

import { createSchemaBus } from './bus.js';
import { parseSchema } from '../model/parse.js';
import { serializeSchema, stringifySchema } from '../model/serialize.js';
import { lint, countIssues } from '../model/lint.js';
import { checkWithSdk } from '../model/sdk.js';
import { createHistory } from '../model/history.js';
import { CommandError, lockKeys } from '../model/commands.js';
import { findNode, getDef } from '../model/query.js';
import {
  MODES, pageFor, componentFor, selectionAfter,
} from './modes.js';

// eslint-disable-next-line import/prefer-default-export
export class SchemaStore {
  constructor({
    org, site, name, repository, validateSchema, bus = createSchemaBus(), history,
  } = {}) {
    this.org = org;
    this.site = site;
    this.name = name;
    this.repository = repository;
    this.validateSchema = validateSchema;
    this.bus = bus;
    this.history = history ?? createHistory();
    this.status = 'idle';
    this.error = null;
    this.missing = false;
    this.raw = undefined;
    this.model = null;
    this.issues = [];
    this.sdkIssues = [];
    this.lastSavedJson = null;
    this.selection = null;
    this.editingDefId = null;
    this.mode = 'build';
    /** The component the Components page shows; kept while in Build. */
    this.componentId = null;
    this.saveState = { state: 'idle' };
    this.savePromise = null;
    this.saveQueued = false;
  }

  get dirty() {
    return !!this.model && stringifySchema(this.model) !== this.lastSavedJson;
  }

  get counts() {
    return countIssues(this.issues);
  }

  get page() {
    return { mode: this.mode, componentId: this.componentId };
  }

  async load() {
    this.status = 'loading';
    this.#emitModel();
    const result = await this.repository.read({ org: this.org, site: this.site, name: this.name });
    if (result.error || !result.json) {
      this.status = 'error';
      this.missing = result.status === 404;
      this.error = this.missing
        ? `Schema "${this.name}" was not found.`
        : result.error || 'The schema is not valid JSON.';
      this.raw = result.raw;
      this.#emitModel();
      return false;
    }
    this.open(parseSchema(result.json, { name: this.name }).model);
    return true;
  }

  /** Starts editing a model (loaded or new) as the saved baseline. */
  open(model, { saved = true } = {}) {
    this.model = model;
    this.lastSavedJson = saved ? stringifySchema(model) : null;
    this.status = 'ready';
    this.error = null;
    this.missing = false;
    this.raw = undefined;
    this.history.clear();
    this.sdkIssues = [];
    this.#relint();
    this.editingDefId = null;
    this.componentId = null;
    this.#emitModel();
    this.select(null);
    this.setMode(this.mode);
    this.#setSaveState({ state: 'idle' });
  }

  /**
   * Picks up a version saved outside the editor (e.g. by the chat assistant) as an undoable
   * step. Unsaved edits are replaced only with `replaceDraft` (the assistant had the draft).
   * @returns {Promise<'updated'|'unchanged'|'kept'|'error'>}
   */
  async refresh({ replaceDraft = false } = {}) {
    if (this.status !== 'ready') return 'unchanged';
    const result = await this.repository.read({ org: this.org, site: this.site, name: this.name });
    if (result.error || !result.json) return 'error';
    const { model } = parseSchema(result.json, { name: this.name });
    const json = stringifySchema(model);
    if (json === this.lastSavedJson) return 'unchanged';
    if (this.dirty && !replaceDraft) return 'kept';
    this.history.push(this.model, model, { label: 'assistant changes' });
    this.lastSavedJson = json;
    this.#setModel(model);
    this.#setSaveState({ state: 'idle' });
    return 'updated';
  }

  /** Applies a command from commands.js; returns `{ ok, error?, result? }`. */
  dispatch(command, args) {
    if (this.status !== 'ready') return { ok: false, error: 'Not ready' };
    let result;
    try {
      result = command(this.model, args);
    } catch (e) {
      if (e instanceof CommandError) {
        this.bus.toastRequest.emit({ message: e.message, variant: 'negative' });
        return { ok: false, error: e.message };
      }
      throw e;
    }
    if (result.model === this.model) return { ok: true, result };
    this.history.push(this.model, result.model, result);
    this.#setModel(result.model);
    if (result.dropped?.length) {
      const dropped = result.dropped.join(', ');
      this.bus.toastRequest.emit({ message: `Removed settings that no longer apply: ${dropped}.` });
    }
    return { ok: true, result };
  }

  undo() {
    const step = this.history.undo();
    if (step) this.#setModel(step.model);
    return step;
  }

  redo() {
    const step = this.history.redo();
    if (step) this.#setModel(step.model);
    return step;
  }

  #setModel(model) {
    this.model = model;
    this.sdkIssues = [];
    this.#relint();
    if (this.selection && !findNode(model, this.selection)) this.selection = null;
    if (this.editingDefId && !getDef(model, this.editingDefId)) this.editingDefId = null;
    this.#emitModel();
    this.#emitSelection();
    this.#keepComponent();
    if (this.saveState.state === 'saved' && this.dirty) this.#setSaveState({ state: 'idle' });
  }

  #relint() {
    this.issues = [...this.sdkIssues, ...lint(this.model)];
  }

  /** `reveal` also scrolls the canvas to the node, switching to a page that shows it. */
  select(nodeId, { reveal = false } = {}) {
    const entry = nodeId ? findNode(this.model, nodeId) : null;
    this.selection = entry ? nodeId : null;
    this.editingDefId = entry?.def?.id ?? null;
    this.#emitSelection();
    if (!entry || !reveal) return;
    this.#setPage(pageFor(this.model, nodeId, this.page));
    this.bus.revealRequest.emit({ nodeId });
  }

  revealDef(defId) {
    const def = getDef(this.model, defId);
    if (def) this.select(def.node.id, { reveal: true });
  }

  /** Components opens on the component the user works in (see `componentFor`). */
  setMode(mode) {
    if (!MODES.includes(mode)) return;
    const componentId = mode === 'components'
      ? componentFor(this.model, this.selection, this.componentId)
      : this.componentId;
    this.#setPage({ mode, componentId });
  }

  /** Shows `page`, keeping the selection only where the page shows it. */
  #setPage({ mode, componentId }) {
    this.mode = mode;
    this.componentId = componentId;
    const selection = selectionAfter(this.model, this.selection, this.page);
    if (selection !== this.selection) this.select(selection);
    this.bus.pageState.emit(this.page);
  }

  /** After an edit, Components keeps its component while it exists, else shows another. */
  #keepComponent() {
    const { componentId, mode } = this;
    if (componentId && getDef(this.model, componentId)) return;
    const next = mode === 'components' ? componentFor(this.model, this.selection, null) : null;
    if (next !== componentId) this.#setPage({ mode, componentId: next });
  }

  #checkSdk() {
    if (!this.model) return true;
    const { issues } = checkWithSdk(this.model, this.validateSchema);
    this.sdkIssues = issues;
    this.#relint();
    this.#emitModel();
    return !issues.length;
  }

  async save() {
    if (this.savePromise) {
      this.saveQueued = true;
      return this.savePromise;
    }
    if (this.status !== 'ready') return { ok: false };
    const errors = lint(this.model).filter((i) => i.severity === 'error').length;
    if (errors) {
      const error = `Fix ${errors} ${errors === 1 ? 'error' : 'errors'} to save.`;
      this.#setSaveState({ state: 'error', error });
      return { ok: false, error };
    }
    if (!this.#checkSdk()) {
      const error = 'The schema did not pass validation.';
      this.#setSaveState({ state: 'error', error });
      return { ok: false, error };
    }

    this.savePromise = this.#persist();
    const result = await this.savePromise;
    this.savePromise = null;
    if (this.saveQueued) {
      this.saveQueued = false;
      if (this.dirty) return this.save();
    }
    return result;
  }

  async #persist() {
    const saved = this.model;
    const json = serializeSchema(saved);
    const { org, site, name } = this;
    this.#setSaveState({ state: 'saving' });
    const result = await this.repository.save({
      org, site, name, json,
    });
    if (!result?.ok) {
      const error = result?.error || 'The schema could not be saved.';
      this.#setSaveState({ state: 'error', error });
      return { ok: false, error };
    }
    this.lastSavedJson = stringifySchema(saved);
    this.model = lockKeys(this.model);
    this.#emitModel();
    this.#setSaveState({ state: this.dirty ? 'idle' : 'saved', savedAt: Date.now() });
    return { ok: true };
  }

  #setSaveState(saveState) {
    this.saveState = saveState;
    this.bus.saveState.emit(saveState);
  }

  #emitModel() {
    this.bus.modelState.emit({
      status: this.status,
      error: this.error,
      missing: this.missing,
      raw: this.raw,
      model: this.model,
      issues: this.issues,
      counts: this.counts,
      dirty: this.dirty,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
    });
  }

  #emitSelection() {
    this.bus.selectionState.emit({ nodeId: this.selection, editingDefId: this.editingDefId });
  }
}
