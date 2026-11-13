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
import { unwrapCodeblock } from './codeblock.js';

const STATUS_ISSUES = {
  'invalid-json': 'The schema document does not contain valid JSON.',
  'load-failed': 'The schema document could not be loaded.',
};

function describeIssues(issues = []) {
  const lines = issues.map((issue) => {
    const where = issue.schemaPath && issue.schemaPath !== '/' ? `#${issue.schemaPath}` : 'the schema root';
    const what = (issue.message || issue.reason || '').replace(/\.$/, '');
    return `${what} (at ${where})`;
  });
  return [...new Set(lines)];
}

// Adds `valid` and readable `issues` to each { id, status, schema? } entry.
export function annotateSchemas({ schemas = [], validate }) {
  return schemas.map((entry) => {
    if (entry.status !== 'loaded') {
      return { ...entry, valid: false, issues: [STATUS_ISSUES[entry.status] ?? 'Unknown error.'] };
    }
    if (!validate) return { ...entry, valid: true, issues: [] };
    const { valid, schemaIssues = [] } = validate(entry.schema);
    return { ...entry, valid, issues: valid ? [] : describeIssues(schemaIssues) };
  });
}

export function parseSchemaDocument({ id, text }) {
  try {
    return { id, status: 'loaded', schema: JSON.parse(unwrapCodeblock(text) ?? '') };
  } catch {
    return { id, status: 'invalid-json' };
  }
}
