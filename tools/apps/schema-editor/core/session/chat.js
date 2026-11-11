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
// Connects a session to the DA chat assistant: answers `chatRequest`s with prompts and,
// after each completed turn, picks up what the assistant saved. `chat` is the injected
// adapter (adapters/chat.js).

import { askPrompt, fixPrompt } from '../prompts.js';

// eslint-disable-next-line import/prefer-default-export
export function connectChat({ store, chat }) {
  const { bus } = store;
  bus.chatState.emit({ available: chat.available, open: false });
  if (!chat.available) return () => {};

  // Set when the assistant was given the unsaved draft: its saved result then
  // supersedes the draft instead of being held back.
  let handedDraft = false;

  const onRequest = ({ intent } = {}) => {
    const {
      org, site, model, dirty, status,
    } = store;
    if (status !== 'ready' || !model) return;
    if (intent === 'fix') {
      const issues = store.issues.filter((issue) => issue.severity !== 'info');
      if (!issues.length) return;
      handedDraft = true;
      chat.ask(fixPrompt({
        org, site, model, issues,
      }), { autoSend: true });
      return;
    }
    handedDraft = dirty;
    chat.ask(askPrompt({
      org, site, model, dirty,
    }));
  };

  const onTurn = async ({ status } = {}) => {
    if (status !== 'completed') return;
    const replaceDraft = handedDraft;
    handedDraft = false;
    const result = await store.refresh({ replaceDraft });
    if (result === 'updated') {
      bus.toastRequest.emit({ message: 'Updated with the assistant’s changes. Undo to go back.' });
    } else if (result === 'kept') {
      bus.toastRequest.emit({
        message: 'The assistant saved a new version. Your unsaved changes were kept.',
        variant: 'warning',
      });
    }
  };

  const onVisibility = (open) => bus.chatState.emit({ available: true, open });

  const unsubscribers = [
    bus.chatRequest.subscribe(onRequest),
    chat.onTurnCompleted(onTurn),
    chat.onVisibilityChange?.(onVisibility) ?? (() => {}),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
