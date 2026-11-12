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
// Schema catalog of a site: what the browse screen lists, creates, duplicates and deletes.
// Storage goes through the injected repository (adapters/schemas.js):
//   list({ org, site }) → { items?: [{ name, lastModified? }], error?, status? }
//   read({ org, site, name }) → { json?, raw?, error?, status? }
//   save({ org, site, name, json }) → { ok, error? }
//   remove({ org, site, name }) → { ok, error? }

import { parseSchema } from './model/parse.js';
import { serializeSchema } from './model/serialize.js';
import { lint, countIssues } from './model/lint.js';
import { walk } from './model/query.js';
import { createModel } from './model/elements.js';
import { validateSchemaName } from './model/keys.js';

export const SORTS = Object.freeze({
  modified: 'Last modified',
  title: 'Title',
  name: 'Name',
});

/** Summarises a schema for its browse row. */
export function summarize(json, name) {
  const { model } = parseSchema(json, { name });
  const fields = [...walk(model)].filter(({ node, def }) => !def && node.key !== undefined).length;
  const counts = countIssues(lint(model));
  return {
    title: model.root?.title || name,
    fields,
    components: model.defs.length,
    errors: counts.error,
    warnings: counts.warning,
  };
}

/** `summaries` maps schema names to their `summarize` result. */
export function filterItems(items, query, summaries = new Map()) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(({ name }) => {
    const title = summaries.get(name)?.title ?? '';
    return name.toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
  });
}

/** `sort` is a key of `SORTS`; `summaries` as in `filterItems`. */
export function sortItems(items, sort, summaries = new Map()) {
  const titleOf = ({ name }) => summaries.get(name)?.title || name;
  const compare = {
    modified: (a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0)
      || a.name.localeCompare(b.name),
    title: (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }),
    name: (a, b) => a.name.localeCompare(b.name),
  }[sort] ?? (() => 0);
  return [...items].sort(compare);
}

const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** Content can have a `type` or `properties` key too, but not with schema values. */
function looksLikeSchema(json) {
  if (['$schema', '$defs', '$ref'].some((keyword) => keyword in json)) return true;
  if (isPlainObject(json.properties) && Object.values(json.properties).every(isPlainObject)) {
    return true;
  }
  const types = [json.type].flat();
  return types.every((type) => SCHEMA_TYPES.has(type));
}

/** Parses a pasted / uploaded JSON Schema for "New schema › From JSON Schema". */
export function parseImport(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${e.message}` };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'The schema must be a JSON object.' };
  }
  if (!looksLikeSchema(json)) {
    return {
      error: 'This looks like content, not a JSON Schema. Paste the schema that describes '
        + 'the fields, e.g. { "type": "object", "properties": { … } }.',
    };
  }
  return { json };
}

export function checkNewName(name, existingNames) {
  return validateSchemaName(name, existingNames);
}

export class SchemaCatalog {
  constructor({ org, site, repository }) {
    this.org = org;
    this.site = site;
    this.repository = repository;
  }

  read(name) {
    return this.repository.read({ org: this.org, site: this.site, name });
  }

  list() {
    return this.repository.list({ org: this.org, site: this.site });
  }

  async summary({ name }) {
    const { json, error } = await this.read(name);
    if (error) return { error };
    return { summary: summarize(json, name) };
  }

  async rawJson({ name }) {
    const { json, raw, error } = await this.read(name);
    if (error && !raw) return { error };
    return { raw: json ? JSON.stringify(json, null, 2) : raw };
  }

  /** Creates a schema: blank (root Group titled `title`), or from `json`. */
  async create({ name, title, json }) {
    const schema = json
      ? serializeSchema({ ...parseSchema(json, { name }).model, name })
      : serializeSchema(createModel({ name, title }));
    if (!json && title) schema.title = title;
    return this.write(name, schema);
  }

  async duplicate({ from, name }) {
    const { json, error } = await this.read(from);
    if (error) return { ok: false, error };
    return this.write(name, json);
  }

  async remove({ name }) {
    const result = await this.repository.remove({ org: this.org, site: this.site, name });
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'Delete failed.' };
  }

  async write(name, json) {
    const result = await this.repository.save({
      org: this.org, site: this.site, name, json,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'Save failed.' };
  }
}
