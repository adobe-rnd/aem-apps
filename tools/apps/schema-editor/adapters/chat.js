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
 * The DA chat assistant over the da.live app SDK. The shell owns the chat panel; the app only
 * prefills a prompt and learns when a turn ends. Chat is offered only when the shell advertises
 * turn notifications, which it does only while chat is enabled for the site.
 */
// eslint-disable-next-line import/prefer-default-export
export function createChat(sdk) {
  const actions = sdk?.actions;
  const available = sdk?.capabilities?.chatTurnCompleted === 1
    && typeof actions?.setPrompt === 'function';

  return Object.freeze({
    available,

    /** Opens the chat with `text`, sent right away when `autoSend` is set. */
    ask(text, { autoSend = false } = {}) {
      if (!available) return false;
      actions.setPrompt(text, { autoSend });
      return true;
    },

    /** Calls back with `{ status: 'completed'|'aborted'|'error' }` after each turn. */
    onTurnCompleted(callback) {
      if (!available) return () => {};
      try {
        return actions.subscribeChatTurnCompleted(callback);
      } catch {
        return () => {};
      }
    },

    /** Calls back with whether the chat panel is open; a no-op on hosts that don't report it. */
    onVisibilityChange(callback) {
      if (!available || sdk.capabilities.panelVisibility !== 1
        || typeof actions.subscribePanelVisibility !== 'function') return () => {};
      try {
        return actions.subscribePanelVisibility(({ sections }) => callback(sections.includes('chat')));
      } catch {
        return () => {};
      }
    },
  });
}
