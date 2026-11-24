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
// Event bus of one authoring session. `*State` channels broadcast and replay to late
// subscribers (e.g. lazily loaded panel views); `*Request` channels carry commands.

/**
 * A bus channel: `emit` calls every subscriber. With `replay`, a new subscriber also gets the
 * last value emitted, so state channels need no separate getter.
 */
export function createChannel({ replay = false } = {}) {
  const listeners = new Set();
  let lastValue;
  let hasValue = false;
  return {
    emit(detail) {
      lastValue = detail;
      hasValue = true;
      listeners.forEach((fn) => fn(detail));
    },
    subscribe(fn) {
      listeners.add(fn);
      if (replay && hasValue) fn(lastValue);
      return () => listeners.delete(fn);
    },
  };
}

export function createSchemaBus() {
  return Object.freeze({
    /**
     * { status, error, model, issues, jsonDraft, counts, dirty, canUndo, canRedo, … } (store
     * `#emitModel`); `jsonDraft` is the Schema page's text when it differs (`setJsonDraft`).
     */
    modelState: createChannel({ replay: true }),
    /** { nodeId, editingDefId } */
    selectionState: createChannel({ replay: true }),
    /** { state: 'idle'|'saving'|'saved'|'error', error?, savedAt? } */
    saveState: createChannel({ replay: true }),
    /** { mode: 'build'|'components'|'schema', componentId } — the page shown */
    pageState: createChannel({ replay: true }),
    /** { active, source: 'palette'|'card', payload } while dragging */
    dragState: createChannel(),
    /**
     * { nodeId, focus? } — scroll a card into view and focus it (unless `focus` is false);
     * { text: { line?, column? } } — the same for a place in the Schema page's text
     */
    revealRequest: createChannel(),
    /** { message, variant? } — user feedback, shown by the app */
    toastRequest: createChannel(),
    /**
     * { view?, open?, tab?, focus? } — bring a panel view (e.g. 'properties') to the front;
     * `open: true` reopens a closed panel; `tab` is 'settings' | 'json'; `focus` names the
     * Properties setting to focus (e.g. 'title'). Sent on canvas
     * clicks, edits and inserts, not on other selections (issues, arrow keys); an issue
     * click only keeps Issues in front.
     */
    panelRequest: createChannel(),
    /** { available, open } — whether the DA chat assistant can be asked, and is open */
    chatState: createChannel({ replay: true }),
    /** { intent: 'ask'|'fix' } — hand the schema to the chat assistant */
    chatRequest: createChannel(),
  });
}
