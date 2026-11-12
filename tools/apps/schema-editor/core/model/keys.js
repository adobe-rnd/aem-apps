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
// Naming rules for property keys, schema file names and component (`$defs`) names, and
// helpers that derive valid, unique names from titles.

export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;
export const RESERVED_KEYS = Object.freeze(['metadata', 'section-metadata']);
const SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
// Names go into `#/$defs/<name>` pointers; excluding `~` and `/` avoids escaping.
export const DEF_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function words(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function uniquify(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

function uniquifyDashed(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function deriveKey(title, siblingKeys = []) {
  const parts = words(title).map((word, i) => {
    const lower = word.toLowerCase();
    return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  let key = parts.join('') || 'field';
  if (/^[0-9]/.test(key)) key = `field${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  if (RESERVED_KEYS.includes(key)) key = `${key}Field`;
  return uniquify(key, siblingKeys);
}

export function deriveSchemaName(title, existingNames = []) {
  let name = words(title).map((w) => w.toLowerCase()).join('-');
  if (!name) name = 'schema';
  if (/^[0-9]/.test(name)) name = `schema-${name}`;
  return uniquifyDashed(name, existingNames);
}

export function deriveDefName(title, existingNames = []) {
  let name = words(title)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  if (!name) name = 'Component';
  if (/^[0-9]/.test(name)) name = `Component${name}`;
  return uniquify(name, existingNames);
}

export function validateSchemaName(name, existingNames = []) {
  if (!name) return 'Enter a name.';
  if (!SCHEMA_NAME_PATTERN.test(name)) {
    return 'Names start with a lowercase letter and use only lowercase letters, digits and hyphens.';
  }
  if (existingNames.includes(name)) return `A schema named "${name}" already exists.`;
  return null;
}

export function validateDefName(name, existingNames = []) {
  if (!name) return 'Enter a name.';
  if (!DEF_NAME_PATTERN.test(name)) {
    return 'Names start with a letter and use only letters, digits, hyphens and underscores.';
  }
  if (existingNames.includes(name)) return `A component named "${name}" already exists.`;
  return null;
}
