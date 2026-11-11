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

import { createChannel } from './channel.js';

// eslint-disable-next-line import/prefer-default-export
export function createSchemaBus() {
  return Object.freeze({
    /** { status, error, model, issues, counts, dirty, canUndo, canRedo, … } (store `#emitModel`) */
    modelState: createChannel({ replay: true }),
    /** { nodeId, editingDefId } */
    selectionState: createChannel({ replay: true }),
    /** { state: 'idle'|'saving'|'saved'|'error', error?, savedAt? } */
    saveState: createChannel({ replay: true }),
    /** { mode: 'build'|'components', componentId } — the page shown */
    pageState: createChannel({ replay: true }),
    /** { active, source: 'palette'|'card', payload } while dragging */
    dragState: createChannel(),
    /** { nodeId, reveal? } — scroll a card into view and focus it */
    revealRequest: createChannel(),
    /** { message, variant? } — user feedback, shown by the app */
    toastRequest: createChannel(),
    /**
     * { view?, open?, tab? } — bring a panel view (e.g. 'properties') to the front;
     * `open: true` reopens a closed panel; `tab` is 'settings' | 'json'. Sent on canvas
     * clicks and edits, not on other selections (inserts, issues, arrow keys).
     */
    panelRequest: createChannel(),
    /** { available, open } — whether the DA chat assistant can be asked, and is open */
    chatState: createChannel({ replay: true }),
    /** { intent: 'ask'|'fix' } — hand the schema to the chat assistant */
    chatRequest: createChannel(),
  });
}
