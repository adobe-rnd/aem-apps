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
import { connectChat } from '../../../../../../tools/apps/schema-editor/core/session/chat.js';
import { createNode } from '../../../../../../tools/apps/schema-editor/core/model/elements.js';
import { insertNode } from '../../../../../../tools/apps/schema-editor/core/model/commands.js';

const SCHEMA = { type: 'object', title: 'Root', properties: { a: { type: 'string', title: 'A' } } };
const CHANGED = { ...SCHEMA, properties: { ...SCHEMA.properties, b: { type: 'string', title: 'B' } } };

function fakeChat(available = true) {
  const asked = [];
  let onTurn;
  let onVisibility;
  return {
    asked,
    turn: (status) => onTurn({ status }),
    visible: (open) => onVisibility(open),
    onVisibilityChange: (callback) => {
      onVisibility = callback;
      return () => { onVisibility = null; };
    },
    available,
    ask: (text, options = {}) => asked.push({ text, autoSend: !!options.autoSend }),
    onTurnCompleted: (callback) => {
      onTurn = callback;
      return () => { onTurn = null; };
    },
  };
}

async function setup() {
  let json = SCHEMA;
  const repository = { read: async () => ({ json: structuredClone(json) }) };
  const store = new SchemaStore({
    org: 'o', site: 's', name: 'page', repository,
  });
  await store.load();
  const toasts = [];
  store.bus.toastRequest.subscribe((t) => toasts.push(t));
  const chat = fakeChat();
  const disconnect = connectChat({ store, chat });
  return {
    store, chat, toasts, disconnect, setRemote: (next) => { json = next; },
  };
}

const edit = (store, node = createNode('text')) => store.dispatch(insertNode, {
  parentId: store.model.root.id, node,
});
// A Choice without choices: an error the assistant can be asked to fix.
const breakIt = (store) => edit(store, { ...createNode('choice'), enum: [] });

describe('connectChat', () => {
  it('broadcasts whether chat is available', () => {
    const store = new SchemaStore({ org: 'o', site: 's', name: 'page' });
    const seen = [];
    store.bus.chatState.subscribe((s) => seen.push(s));
    connectChat({ store, chat: fakeChat(false) });
    expect(seen).to.deep.equal([{ available: false, open: false }]);
  });

  it('prefills an open question and sends a fix request right away', async () => {
    const { store, chat } = await setup();
    store.bus.chatRequest.emit({ intent: 'ask' });
    expect(chat.asked[0].autoSend).to.equal(false);
    expect(chat.asked[0].text).to.include('/o/s/.da/forms/schemas/page.html');
    breakIt(store);
    store.bus.chatRequest.emit({ intent: 'fix' });
    expect(chat.asked[1].autoSend).to.equal(true);
    expect(chat.asked[1].text).to.include('Fix the issues');
  });

  it('ignores a fix request without issues', async () => {
    const { store, chat } = await setup();
    store.bus.chatRequest.emit({ intent: 'fix' });
    expect(chat.asked.length).to.equal(0);
  });

  it('applies what the assistant saved after a completed turn', async () => {
    const {
      store, chat, toasts, setRemote,
    } = await setup();
    setRemote(CHANGED);
    await chat.turn('aborted');
    expect(store.model.root.children.length).to.equal(1);
    await chat.turn('completed');
    expect(store.model.root.children.length).to.equal(2);
    expect(toasts.at(-1).message).to.include('Undo to go back');
  });

  it('keeps unsaved edits the assistant never saw', async () => {
    const {
      store, chat, toasts, setRemote,
    } = await setup();
    edit(store);
    setRemote(CHANGED);
    await chat.turn('completed');
    expect(store.dirty).to.equal(true);
    expect(toasts.at(-1).variant).to.equal('warning');
  });

  it('replaces the draft the assistant was given', async () => {
    const { store, chat, setRemote } = await setup();
    breakIt(store);
    store.bus.chatRequest.emit({ intent: 'fix' });
    setRemote(CHANGED);
    await chat.turn('completed');
    expect(store.dirty).to.equal(false);
    expect(store.model.root.children.length).to.equal(2);
  });

  it('broadcasts whether the chat panel is open', async () => {
    const { store, chat } = await setup();
    const seen = [];
    store.bus.chatState.subscribe((s) => seen.push(s));
    chat.visible(true);
    chat.visible(false);
    expect(seen).to.deep.equal([
      { available: true, open: false },
      { available: true, open: true },
      { available: true, open: false },
    ]);
  });

  it('stops listening once disconnected', async () => {
    const { store, chat, disconnect } = await setup();
    disconnect();
    store.bus.chatRequest.emit({ intent: 'ask' });
    expect(chat.asked.length).to.equal(0);
  });
});
