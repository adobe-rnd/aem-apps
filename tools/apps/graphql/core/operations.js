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
import {
  createConfig, isValidEndpointName, parseConfig, serializeEndpoint, validateConfig,
} from './endpoint.js';
import { annotateSchemas, parseSchemaDocument } from './schemas.js';
import { unwrapCodeblock, wrapCodeblocks } from './codeblock.js';

const sitePath = ({ org, site }) => `/${org}/${site}`;
const schemasPath = (args) => `${sitePath(args)}/.da/forms/schemas`;
const endpointsPath = (args) => `${sitePath(args)}/.da/graphql/endpoints`;
const endpointFolder = (args) => `${endpointsPath(args)}/${args.name}`;
const endpointPath = (args) => `${endpointFolder(args)}/endpoint.html`;

// Loaded on demand so listing endpoints never loads graphql-js.
const loadSdl = () => import('./sdl.js');

const endpointNames = (items) => items
  .filter((item) => !item.ext && isValidEndpointName(item.name))
  .map((item) => item.name)
  .sort();

// The core workflows over a store port; `loadValidator` and `now` are optional.
// eslint-disable-next-line import/prefer-default-export
export function createGraphqlCore({ store, loadValidator, now = () => new Date() }) {
  // A folder that doesn't exist yet has no items.
  async function listFolder(path) {
    const result = await store.list({ path });
    return result.status === 404 ? { items: [] } : result;
  }

  async function listSchemaFiles(args) {
    const result = await listFolder(schemasPath(args));
    return result.error ? result : { items: result.items.filter((item) => item.ext === 'html') };
  }

  // DA lists a missing site as empty and hlx6 lists no dot folders, so any content means found.
  // Without `permissions` the site is writable.
  async function listEndpoints({ org, site }) {
    const listed = await Promise.all([
      store.list({ path: sitePath({ org, site }) }),
      listFolder(endpointsPath({ org, site })),
      listSchemaFiles({ org, site }),
    ]);
    const failed = listed.find(({ error }) => error);
    if (failed) return { code: 'load-failed', error: `Could not load ${org}/${site}.`, status: failed.status };
    const [siteList, endpointList, schemaList] = listed;
    const endpoints = endpointNames(endpointList.items);
    const found = [siteList.items, endpoints, schemaList.items].some((items) => items.length > 0);
    const { permissions } = siteList;
    return { endpoints, found, canWrite: found && (!permissions || permissions.includes('write')) };
  }

  // Without a validator, every schema that parses counts as valid.
  async function loadValidate() {
    try {
      return { validate: await loadValidator?.() };
    } catch {
      return { code: 'load-failed', error: 'Could not load the schema validator.' };
    }
  }

  async function loadSchemas({ org, site }) {
    const [files, validator] = await Promise.all([listSchemaFiles({ org, site }), loadValidate()]);
    if (files.error) {
      return {
        code: 'load-failed', error: `Could not load the schemas of ${org}/${site}.`, status: files.status,
      };
    }
    if (validator.error) return validator;
    const schemas = await Promise.all(files.items.map(async ({ name: id, path }) => {
      const result = await store.read({ path });
      return result.error ? { id, status: 'load-failed' } : parseSchemaDocument({ id, text: result.text });
    }));
    schemas.sort((a, b) => a.id.localeCompare(b.id));
    return { schemas: annotateSchemas({ schemas, validate: validator.validate }) };
  }

  async function loadEndpoint({ org, site, name }) {
    const result = await store.read({ path: endpointPath({ org, site, name }) });
    if (result.status === 404) {
      return { code: 'not-found', error: `Endpoint "${name}" was not found.`, status: 404 };
    }
    if (result.error) {
      return { code: 'load-failed', error: `Could not load endpoint "${name}".`, status: result.status };
    }
    const parsed = parseConfig({ text: unwrapCodeblock(result.text) ?? '', name });
    return parsed.error ? { code: 'invalid-config', ...parsed } : parsed;
  }

  // The SDL for a config, from the site's current schemas.
  async function generateSdl({ org, site, config }) {
    const invalid = validateConfig(config);
    if (invalid) return { code: 'invalid-config', error: invalid };
    const [loaded, { buildSdl }] = await Promise.all([loadSchemas({ org, site }), loadSdl()]);
    if (loaded.error) return loaded;
    const { schemas } = loaded;
    const { sdl, warnings, errors } = buildSdl({ schemaIds: config.schemas, schemas });
    if (errors.length) {
      return {
        code: 'generation-failed', error: 'The GraphQL schema could not be generated.', errors, warnings,
      };
    }
    return { sdl, warnings };
  }

  // The only way an endpoint is written: its config and SDL are code blocks of one document,
  // published so the engine serves it. Missing or invalid schemas are skipped with warnings.
  // If a schema can't be read or none is usable, nothing is written.
  async function saveEndpoint({ org, site, config: draft }) {
    const config = createConfig(draft);
    const generated = await generateSdl({ org, site, config });
    if (generated.error) return generated;
    const { sdl, warnings } = generated;
    const blocks = serializeEndpoint({ config, generatedAt: now().toISOString(), sdl });
    const path = endpointPath({ org, site, name: config.name });
    const result = await store.write({ path, text: wrapCodeblocks(blocks) });
    if (result.error) {
      return { code: 'save-failed', error: 'Could not save the endpoint.', status: result.status };
    }
    const published = await store.publish({ path });
    if (published.error) {
      return {
        code: 'publish-failed',
        error: 'The endpoint was saved but could not be published. Save again to retry.',
        status: published.status,
      };
    }
    return { config, sdl, warnings };
  }

  // A missing endpoint counts as deleted.
  async function deleteEndpoint({ org, site, name }) {
    const path = endpointPath({ org, site, name });
    // Unpublish first, so a failure keeps the document and a retry can still find it.
    const unpublished = await store.unpublish({ path });
    if (unpublished.error && unpublished.status !== 404) {
      return { code: 'unpublish-failed', error: `Could not unpublish endpoint "${name}". It was not deleted.`, status: unpublished.status };
    }
    const result = await store.remove({ path });
    if (result.error && result.status !== 404) {
      return { code: 'delete-failed', error: `Could not delete endpoint "${name}".`, status: result.status };
    }
    // Best effort: drop the now empty endpoint folder.
    await store.remove({ path: endpointFolder({ org, site, name }) });
    return { ok: true };
  }

  return {
    listEndpoints,
    loadSchemas,
    loadEndpoint,
    saveEndpoint,
    deleteEndpoint,
  };
}
