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
// Second validation layer: runs the da-sc-sdk compiler on the serialized schema and maps
// its issues back onto model nodes. `validateSchema` is injected (adapters/sc-sdk.js).

import { serializeSchema } from './serialize.js';
import { walk } from './query.js';

// eslint-disable-next-line import/prefer-default-export
export function checkWithSdk(model, validateSchema) {
  if (!validateSchema) return { valid: true, issues: [] };
  const schema = serializeSchema(model);
  let result;
  try {
    result = validateSchema({ schema });
  } catch (e) {
    return {
      valid: false,
      issues: [{
        code: 'sdk-crash',
        severity: 'error',
        message: `The schema could not be compiled: ${e.message}`,
        nodeId: model.root.id,
        schemaPath: '',
        source: 'sdk',
      }],
    };
  }
  const byPointer = new Map([...walk(model)].map(({ node, pointer }) => [pointer, node.id]));
  const nodeFor = (path = '') => {
    let pointer = path;
    while (pointer && !byPointer.has(pointer)) pointer = pointer.slice(0, pointer.lastIndexOf('/'));
    return byPointer.get(pointer) ?? model.root.id;
  };
  const issues = (result.schemaIssues ?? []).map((issue) => ({
    code: `sdk-${issue.reason}`,
    severity: 'error',
    message: issue.message,
    nodeId: nodeFor(issue.schemaPath),
    schemaPath: issue.schemaPath ?? '',
    source: 'sdk',
  }));
  return { valid: result.valid && !issues.length, issues };
}
