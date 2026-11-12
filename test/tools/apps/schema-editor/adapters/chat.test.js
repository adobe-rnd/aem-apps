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
import { expect } from '../expect.js';
import { createChat } from '../../../../../tools/apps/schema-editor/adapters/chat.js';

function fakeSdk({ capabilities = { chatTurnCompleted: 1 }, subscribe } = {}) {
  const prompts = [];
  const callbacks = [];
  const sdk = {
    capabilities,
    actions: {
      setPrompt: (text, options) => prompts.push({ text, options }),
      subscribeChatTurnCompleted: subscribe ?? ((callback) => {
        callbacks.push(callback);
        return () => callbacks.splice(callbacks.indexOf(callback), 1);
      }),
    },
  };
  return { sdk, prompts, callbacks };
}

describe('createChat', () => {
  it('prefills the chat, sending only on request', () => {
    const { sdk, prompts } = fakeSdk();
    const chat = createChat(sdk);
    expect(chat.available).to.equal(true);
    expect(chat.ask('hi')).to.equal(true);
    chat.ask('go', { autoSend: true });
    expect(prompts).to.deep.equal([
      { text: 'hi', options: { autoSend: false } },
      { text: 'go', options: { autoSend: true } },
    ]);
  });

  it('relays turn notifications until unsubscribed', () => {
    const { sdk, callbacks } = fakeSdk();
    const seen = [];
    const unsubscribe = createChat(sdk).onTurnCompleted((detail) => seen.push(detail.status));
    callbacks[0]({ status: 'completed' });
    unsubscribe();
    expect(seen).to.deep.equal(['completed']);
    expect(callbacks.length).to.equal(0);
  });

  it('is unavailable when the shell does not offer chat', () => {
    const { sdk, prompts } = fakeSdk({ capabilities: {} });
    const chat = createChat(sdk);
    expect(chat.available).to.equal(false);
    expect(chat.ask('hi')).to.equal(false);
    expect(prompts.length).to.equal(0);
    expect(chat.onTurnCompleted(() => {})).to.be.a('function');
    expect(createChat(undefined).available).to.equal(false);
  });

  it('reports whether the shell chat panel is open', () => {
    const { sdk } = fakeSdk({ capabilities: { chatTurnCompleted: 1, panelVisibility: 1 } });
    let notify;
    sdk.actions.subscribePanelVisibility = (callback) => {
      notify = callback;
      return () => { notify = null; };
    };
    const seen = [];
    const unsubscribe = createChat(sdk).onVisibilityChange((open) => seen.push(open));
    notify({ sections: ['chat'] });
    notify({ sections: ['other'] });
    unsubscribe();
    expect(seen).to.deep.equal([true, false]);
    expect(notify).to.equal(null);
  });

  it('ignores panel visibility on hosts that do not report it', () => {
    const { sdk } = fakeSdk();
    sdk.actions.subscribePanelVisibility = () => { throw new Error('unsupported'); };
    expect(createChat(sdk).onVisibilityChange(() => {})).to.be.a('function');
    sdk.capabilities = { chatTurnCompleted: 1, panelVisibility: 1 };
    expect(createChat(sdk).onVisibilityChange(() => {})).to.be.a('function');
  });

  it('survives a host that refuses turn notifications', () => {
    const { sdk } = fakeSdk({ subscribe: () => { throw new Error('nope'); } });
    expect(createChat(sdk).onTurnCompleted(() => {})).to.be.a('function');
  });
});
