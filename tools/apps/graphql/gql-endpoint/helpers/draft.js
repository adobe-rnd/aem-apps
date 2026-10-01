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
import { NO_SCHEMAS_MESSAGE } from '../../utils/endpoint.js';

// Editing a draft; a draft is { name, schemas, isNew }.

export function selectSchemas({ draft, ids, selected }) {
  const others = draft.schemas.filter((schemaId) => !ids.includes(schemaId));
  return { ...draft, schemas: selected ? [...new Set([...others, ...ids])].sort() : others };
}

export function isDirty({ draft, config }) {
  if (!draft) return false;
  if (!config) return true;
  return draft.schemas.join('\n') !== config.schemas.join('\n');
}

// Saving an unchanged endpoint regenerates its GraphQL schema from the current schemas.
export function getSaveState({
  draft, blocker, dirty, busy,
}) {
  const pending = draft.isNew || dirty;
  // The Schemas tab explains an empty selection, so it isn't repeated next to Save.
  const showHint = blocker && pending && blocker !== NO_SCHEMAS_MESSAGE;
  return {
    canSave: !blocker && !busy,
    hint: showHint ? blocker : undefined,
  };
}
