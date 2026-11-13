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
import { createConfig, NO_SCHEMAS_MESSAGE, validateEndpointName } from '../../../core/endpoint.js';

// Editing a draft; a draft is the editable form of a config: { name, schemas, isNew }.

export function createDraft({ config, name } = {}) {
  if (!config) return { name, schemas: [], isNew: true };
  return { ...createConfig(config), isNew: false };
}

export function selectSchemas({ draft, ids, selected }) {
  const others = draft.schemas.filter((schemaId) => !ids.includes(schemaId));
  return { ...draft, schemas: selected ? [...new Set([...others, ...ids])].sort() : others };
}

export function isDirty({ draft, config }) {
  if (!draft) return false;
  if (!config) return true;
  return draft.schemas.length !== config.schemas.length
    || draft.schemas.some((id, index) => id !== config.schemas[index]);
}

export function getSaveBlocker({ draft, preview, existing = [] }) {
  if (draft.isNew) {
    const nameError = validateEndpointName({ name: draft.name, existing });
    if (nameError) return nameError;
  }
  if (!draft.schemas.length) return NO_SCHEMAS_MESSAGE;
  if (preview.errors.length) return 'Resolve the GraphQL schema errors before saving.';
  return undefined;
}

export function getSaveState({
  draft, blocker, dirty, busy,
}) {
  const pending = draft.isNew || !!dirty;
  // The Schemas tab explains an empty selection, so it isn't repeated next to Save.
  const showHint = blocker && pending && blocker !== NO_SCHEMAS_MESSAGE;
  return {
    canSave: pending && !blocker && !busy,
    hint: showHint ? blocker : undefined,
  };
}
