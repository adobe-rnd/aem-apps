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
// User-facing wording, kept apart from the logic and the markup.

// Status light props per schemas-panel/helpers/options.js getSchemaStatus.
export const SCHEMA_STATUSES = {
  invalid: {
    variant: 'negative',
    label: 'Invalid',
    title: 'This schema cannot be used in GraphQL. Fix it in the Schema Editor.',
  },
  missing: {
    variant: 'negative',
    label: 'Not found',
    title: 'This schema no longer exists. Deselect it to remove it from the endpoint.',
  },
  adding: {
    variant: 'notice',
    label: 'Adding',
    title: 'Added to the endpoint when you save.',
  },
  removing: {
    variant: 'notice',
    label: 'Removing',
    title: 'Removed from the endpoint when you save.',
  },
};

export const unsavedSchemaChanges = ({ adding, removing }) => [
  adding && `${adding} adding`,
  removing && `${removing} removing`,
].filter(Boolean).join(', ');

export const READ_ONLY = {
  heading: 'View only',
  text: 'You do not have permission to change GraphQL endpoints for this site. Contact your administrator for access.',
};

export const endpointSaved = (name) => `Endpoint "${name}" saved.`;

export const endpointDeleted = (name) => `Endpoint "${name}" deleted.`;

// SDL problems are { schemaId, pointer, message }.
export function describeProblem({ schemaId, pointer, message }) {
  if (!schemaId) return message;
  return `${schemaId}${pointer ? ` #${pointer}` : ''}: ${message}`;
}
