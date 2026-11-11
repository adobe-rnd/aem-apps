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
import { describe, it } from 'node:test';
import { expect } from '../../expect.js';
import { SchemaStore } from '../../../../../../tools/apps/schema-editor/core/session/store.js';
import { createSchemaBus } from '../../../../../../tools/apps/schema-editor/core/session/bus.js';
import { createNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import {
  insertNode, updateNode, removeNode, addDef, deleteDef,
} from '../../../../../../tools/apps/schema-editor/core/model/commands.js';
import { PERSON } from '../../fixtures.js';

const SCHEMA = {
  type: 'object',
  title: 'Root',
  properties: { a: { type: 'string', title: 'A' } },
};

function setup({ read, save, validateSchema } = {}) {
  const bus = createSchemaBus();
  const saves = [];
  const repository = {
    read: read ?? (async () => ({ json: structuredClone(SCHEMA) })),
    save: save ?? (async (args) => {
      saves.push(args);
      return { ok: true };
    }),
  };
  const store = new SchemaStore({
    org: 'o', site: 's', name: 'page', bus, repository, validateSchema,
  });
  const seen = {
    model: [], selection: [], save: [], toast: [],
  };
  bus.modelState.subscribe((s) => seen.model.push(s));
  bus.selectionState.subscribe((s) => seen.selection.push(s));
  bus.saveState.subscribe((s) => seen.save.push(s));
  bus.toastRequest.subscribe((s) => seen.toast.push(s));
  return {
    store, bus, saves, seen,
  };
}

describe('SchemaStore', () => {
  it('loads a schema and broadcasts state', async () => {
    const { store, bus, seen } = setup();
    expect(await store.load()).to.equal(true);
    expect(store.status).to.equal('ready');
    expect(store.dirty).to.equal(false);
    expect(seen.model.at(-1)).to.include({ status: 'ready', dirty: false });
    let replayed;
    bus.modelState.subscribe((s) => { replayed = s; });
    expect(replayed.model).to.equal(store.model);
  });

  it('reports load errors', async () => {
    const { store } = setup({ read: async () => ({ error: 'nope', status: 404 }) });
    expect(await store.load()).to.equal(false);
    expect(store.status).to.equal('error');
    expect(store.error).to.contain('not found');
  });

  it('dispatches commands with undo/redo and dirty tracking', async () => {
    const { store, seen } = setup();
    await store.load();
    const node = createNode('text', { title: 'B', siblingKeys: [] });
    const { ok, result } = store.dispatch(insertNode, { parentId: store.model.root.id, node });
    expect(ok).to.equal(true);
    expect(store.dirty).to.equal(true);
    expect(seen.model.at(-1)).to.include({ dirty: true, canUndo: true });
    store.select(result.nodeId);
    expect(store.selection).to.equal(result.nodeId);
    store.undo();
    expect(store.dirty).to.equal(false);
    expect(store.selection).to.equal(null);
    store.redo();
    expect(store.model.root.children).to.have.length(2);
  });

  it('turns command errors into toasts', async () => {
    const { store, seen } = setup();
    await store.load();
    const { ok } = store.dispatch(removeNode, { nodeId: store.model.root.id });
    expect(ok).to.equal(false);
    expect(seen.toast.at(-1).variant).to.equal('negative');
  });

  it('blocks saving with errors', async () => {
    const { store, saves } = setup();
    await store.load();
    const a = store.model.root.children[0];
    store.dispatch(updateNode, { nodeId: a.id, patch: { title: '' } });
    const result = await store.save();
    expect(result.ok).to.equal(false);
    expect(result.error).to.contain('1 error');
    expect(saves).to.have.length(0);
  });

  it('saves, locks keys and resets dirty', async () => {
    const { store, saves, seen } = setup();
    await store.load();
    const node = createNode('text', { title: 'New', siblingKeys: [] });
    const { result } = store.dispatch(insertNode, { parentId: store.model.root.id, node });
    expect((await store.save()).ok).to.equal(true);
    expect(saves[0]).to.include({ org: 'o', site: 's', name: 'page' });
    expect(saves[0].json.properties.new.title).to.equal('New');
    expect(store.dirty).to.equal(false);
    expect(seen.save.map((s) => s.state)).to.include.members(['saving', 'saved']);
    store.dispatch(updateNode, { nodeId: result.nodeId, patch: { title: 'Renamed' } });
    expect(store.model.root.children[1].key).to.equal('new');
  });

  it('serializes concurrent saves', async () => {
    let release;
    const calls = [];
    const { store } = setup({
      save: (args) => {
        calls.push(args);
        return new Promise((resolve) => { release = () => resolve({ ok: true }); });
      },
    });
    await store.load();
    store.dispatch(updateNode, { nodeId: store.model.root.id, patch: { title: 'One' } });
    const first = store.save();
    store.dispatch(updateNode, { nodeId: store.model.root.id, patch: { title: 'Two' } });
    const second = store.save();
    expect(calls).to.have.length(1);
    release();
    await new Promise((r) => { setTimeout(r, 0); });
    release();
    await Promise.all([first, second]);
    expect(calls).to.have.length(2);
    expect(calls[1].json.title).to.equal('Two');
    expect(store.dirty).to.equal(false);
  });

  it('blocks saving on SDK issues and lists them', async () => {
    const validateSchema = () => ({
      valid: false,
      schemaIssues: [{ reason: 'invalid-pattern', message: 'Bad pattern', schemaPath: '/properties/a' }],
    });
    const { store } = setup({ validateSchema });
    await store.load();
    expect(await store.save())
      .to.deep.equal({ ok: false, error: 'The schema did not pass validation.' });
    expect(store.issues.find((i) => i.source === 'sdk'))
      .to.include({ code: 'sdk-invalid-pattern', nodeId: store.model.root.children[0].id });
  });

  it('switches between Build and Components only', async () => {
    const { store } = setup();
    await store.load();
    store.setMode('components');
    expect(store.mode).to.equal('components');
    store.setMode('json');
    expect(store.mode).to.equal('components');
    store.setMode('build');
    expect(store.mode).to.equal('build');
  });
});

describe('SchemaStore pages', () => {
  async function opened() {
    const env = setup({ read: async () => ({ json: structuredClone(PERSON) }) });
    await env.store.load();
    const pages = [];
    const reveals = [];
    env.bus.pageState.subscribe((page) => pages.push(page));
    env.bus.revealRequest.subscribe(({ nodeId }) => reveals.push(nodeId));
    const { model } = env.store;
    return {
      ...env, pages, reveals, model, def: model.defs[0],
    };
  }

  it('reveals a component on its Components page and the schema in Build', async () => {
    const {
      store, pages, reveals, model, def,
    } = await opened();
    store.revealDef(def.id);
    expect(store.page).to.deep.equal({ mode: 'components', componentId: def.id });
    expect(store.selection).to.equal(def.node.id);
    expect(store.editingDefId).to.equal(def.id);
    store.select(model.root.id, { reveal: true });
    expect(store.page).to.deep.equal({ mode: 'build', componentId: def.id });
    expect(pages.slice(1).map((page) => page.mode)).to.deep.equal(['components', 'build']);
    expect(reveals).to.deep.equal([def.node.id, model.root.id]);
  });

  it('reveals a used component field on its component\'s page, where it is edited', async () => {
    const { store, def } = await opened();
    store.select(def.node.children[0].id, { reveal: true });
    expect(store.page).to.deep.equal({ mode: 'components', componentId: def.id });
  });

  it('opens Components on the component of the selected use, else the first', async () => {
    const { store, model, def } = await opened();
    store.setMode('components');
    expect(store.componentId).to.equal(def.id);
    store.setMode('build');
    store.dispatch(addDef, {});
    const added = store.model.defs[1];
    store.revealDef(added.id);
    store.setMode('build');
    const use = model.root.children.find((node) => node.kind === 'ref');
    store.select(use.id);
    store.setMode('components');
    expect(store.componentId).to.equal(def.id);
    expect(store.selection).to.equal(def.node.id);
  });

  it('clears the selection a new page does not show', async () => {
    const { store, model } = await opened();
    store.select(model.root.children[0].id);
    store.setMode('components');
    expect(store.selection).to.equal(null);
    store.setMode('build');
    expect(store.selection).to.equal(null);
  });

  it('shows another component once the shown one is deleted, and none when all are', async () => {
    const { store, def } = await opened();
    store.dispatch(addDef, {});
    const added = store.model.defs[1];
    store.revealDef(added.id);
    store.dispatch(deleteDef, { defId: added.id });
    expect(store.page).to.deep.equal({ mode: 'components', componentId: def.id });
    store.dispatch(deleteDef, { defId: def.id });
    expect(store.page).to.deep.equal({ mode: 'components', componentId: null });
    store.undo();
    expect(store.componentId).to.equal(def.id);
  });

  it('forgets a deleted component while in Build', async () => {
    const { store, def } = await opened();
    store.revealDef(def.id);
    store.setMode('build');
    store.dispatch(deleteDef, { defId: def.id });
    expect(store.page).to.deep.equal({ mode: 'build', componentId: null });
  });
});

describe('SchemaStore.refresh', () => {
  const CHANGED = { ...SCHEMA, properties: { ...SCHEMA.properties, b: { type: 'string', title: 'B' } } };

  function remote(initial) {
    let json = initial;
    return {
      read: async () => ({ json: structuredClone(json) }),
      set: (next) => { json = next; },
    };
  }

  it('reports an unchanged schema', async () => {
    const { store } = setup();
    await store.load();
    expect(await store.refresh()).to.equal('unchanged');
  });

  it('applies a version saved elsewhere as an undoable change', async () => {
    const source = remote(SCHEMA);
    const { store } = setup({ read: source.read });
    await store.load();
    source.set(CHANGED);
    expect(await store.refresh()).to.equal('updated');
    expect(store.model.root.children.length).to.equal(2);
    expect(store.dirty).to.equal(false);
    expect(store.history.undoLabel).to.equal('assistant changes');
    store.undo();
    expect(store.model.root.children.length).to.equal(1);
    expect(store.dirty).to.equal(true);
  });

  it('keeps unsaved edits unless the draft was handed over', async () => {
    const source = remote(SCHEMA);
    const { store } = setup({ read: source.read });
    await store.load();
    store.dispatch(insertNode, { parentId: store.model.root.id, node: createNode('text') });
    source.set(CHANGED);
    expect(await store.refresh()).to.equal('kept');
    expect(await store.refresh({ replaceDraft: true })).to.equal('updated');
    expect(store.dirty).to.equal(false);
  });

  it('reports a schema that cannot be read', async () => {
    let fail = false;
    const { store } = setup({ read: async () => (fail ? { error: 'x' } : { json: SCHEMA }) });
    await store.load();
    fail = true;
    expect(await store.refresh()).to.equal('error');
  });
});
