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
// Prompts the editor hands to the DA chat assistant.

import { schemaPath, schemasFolder } from './codeblock.js';
import { stringifySchema } from './model/serialize.js';

const RULES = 'Follow the Structured Content schema rules (the supported JSON Schema subset) '
  + 'and keep the existing field keys unless I ask otherwise.';

const SAVE = (path) => `Save the result back to ${path}.`;

const draftBlock = (model) => `\`\`\`json\n${stringifySchema(model)}\n\`\`\``;

/** Prefill for an open question about the schema being edited. */
export function askPrompt({
  org, site, model, dirty,
}) {
  const path = schemaPath(org, site, model.name);
  const lines = [`I'm editing the Structured Content schema "${model.name}" (${path}).`];
  if (dirty) lines.push('My current, unsaved version:', draftBlock(model));
  lines.push(`${RULES} If you change it, save it back to ${path}.`, '');
  return lines.join('\n');
}

const issueLine = (issue) => `- ${issue.severity}: ${issue.message}${issue.schemaPath ? ` (at ${issue.schemaPath})` : ''}`;

/** Asks the assistant to fix the schema's issues, starting from what the author sees. */
export function fixPrompt({
  org, site, model, issues,
}) {
  const path = schemaPath(org, site, model.name);
  return [
    `Fix the issues of the Structured Content schema "${model.name}" (${path}).`,
    'Issues:',
    ...issues.map(issueLine),
    'The schema as I have it now:',
    draftBlock(model),
    `${RULES} ${SAVE(path)}`,
  ].join('\n');
}

/** Prefill for creating a new schema; the author completes the description. */
export function createPrompt({ org, site }) {
  return [
    `Create a new Structured Content schema for ${org}/${site} and save it in ${schemasFolder(org, site)}`,
    `as <name>.html. ${RULES}`,
    'It should model: ',
  ].join('\n');
}
