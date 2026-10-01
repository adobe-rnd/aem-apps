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
/* eslint-disable import/no-unresolved */
import { source, asText } from 'https://da.live/nx2/utils/api.js';
import { isValidEndpointName, parseConfig, serializeConfig } from './endpoint.js';
import { annotateSchemas } from './schemas.js';

const SCHEMAS_PATH = '/.da/forms/schemas';
const ENDPOINTS_PATH = '/.da/graphql/endpoints';

const endpointPath = ({ org, site, name }) => `/${org}/${site}${ENDPOINTS_PATH}/${name}`;
const configPath = (args) => `${endpointPath(args)}/config.html`;
const artifactPath = (args) => `${endpointPath(args)}/schema.html`;

// DA codeblock document shell, as written by the schema editor.

const escapeHtml = (text) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const wrapCodeblock = (text) => `<body><header></header><main><div><pre><code>${
  escapeHtml(text)}</code></pre></div></main><footer></footer></body>`;

const unwrapCodeblock = (html) => new DOMParser()
  .parseFromString(html ?? '', 'text/html').querySelector('code')?.textContent;

const loadValidator = () => import('https://da.live/nx/deps/da-sc-sdk/dist/index.js')
  .then(({ validateSchema }) => (schema) => validateSchema({ schema }));

const failure = (status) => ({ error: 'Request failed.', status });

async function list({ path, continuationToken, items = [] }) {
  const result = await source.list(path, { continuationToken }).catch(() => ({}));
  if (!result.ok) return failure();
  const all = [...items, ...result.items];
  if (!result.continuationToken) return { items: all, permissions: result.permissions };
  return list({ path, continuationToken: result.continuationToken, items: all });
}

// A missing folder can list as an error (hlx6), so folder errors list as empty.
const listItems = async (path) => (await list({ path })).items ?? [];

async function read(path) {
  const { ok, data, status } = await asText(source.get(path)).catch(() => ({}));
  return ok ? { text: data } : failure(status);
}

async function send(request) {
  const resp = await request.catch(() => undefined);
  return resp?.ok ? { ok: true } : failure(resp?.status);
}

const listEndpoints = async ({ org, site }) => (await listItems(`/${org}/${site}${ENDPOINTS_PATH}`))
  .filter((item) => !item.ext && isValidEndpointName(item.name))
  .map((item) => item.name)
  .sort();

const listSchemaFiles = async ({ org, site }) => (await listItems(`/${org}/${site}${SCHEMAS_PATH}`))
  .filter((item) => item.ext === 'html');

// DA lists a missing site as empty, so any content means found; no `permissions` allows write.
export async function loadSite({ org, site }) {
  const [siteList, endpoints] = await Promise.all([
    list({ path: `/${org}/${site}` }),
    listEndpoints({ org, site }),
  ]);
  if (siteList.error) return { error: `Could not load ${org}/${site}.`, status: siteList.status };
  const found = siteList.items.length > 0 || endpoints.length > 0
    || (await listSchemaFiles({ org, site })).length > 0;
  const { permissions } = siteList;
  return { endpoints, found, canWrite: found && (!permissions || permissions.includes('write')) };
}

function parseSchemaDocument({ id, text }) {
  try {
    return { id, status: 'loaded', schema: JSON.parse(unwrapCodeblock(text) ?? '') };
  } catch {
    return { id, status: 'invalid-json' };
  }
}

async function readSchemas({ org, site }) {
  const [files, validate] = await Promise.all([
    listSchemaFiles({ org, site }),
    loadValidator().catch(() => undefined),
  ]);
  const schemas = await Promise.all(files.map(async ({ name: id, path }) => {
    const result = await read(path);
    return result.error ? { id, status: 'load-failed' } : parseSchemaDocument({ id, text: result.text });
  }));
  schemas.sort((a, b) => a.id.localeCompare(b.id));
  return annotateSchemas({ schemas, validate });
}

// Memoized per site, as every endpoint page of a site needs the same schemas.
export const loadSchemas = (() => {
  const bySite = new Map();
  return ({ org, site }) => {
    const key = `${org}/${site}`;
    if (!bySite.has(key)) {
      const loading = readSchemas({ org, site });
      loading.catch(() => bySite.delete(key));
      bySite.set(key, loading);
    }
    return bySite.get(key);
  };
})();

export async function loadEndpoint({ org, site, name }) {
  const result = await read(configPath({ org, site, name }));
  if (result.status === 404) return { error: `Endpoint "${name}" was not found.`, status: 404 };
  if (result.error) return { error: `Could not load endpoint "${name}".`, status: result.status };
  return parseConfig({ text: unwrapCodeblock(result.text) ?? '', name });
}

export async function saveEndpoint({
  org, site, config, artifact,
}) {
  const { name } = config;
  const configResult = await send(source.save(configPath({ org, site, name }), {
    body: wrapCodeblock(serializeConfig(config)),
  }));
  if (configResult.error) {
    return { error: 'Could not save the endpoint configuration.', status: configResult.status };
  }
  const artifactResult = await send(source.save(artifactPath({ org, site, name }), {
    body: wrapCodeblock(artifact),
  }));
  if (artifactResult.error) {
    return {
      error: 'The configuration was saved, but the GraphQL schema could not be saved.',
      status: artifactResult.status,
    };
  }
  return { ok: true };
}

export async function deleteEndpoint({ org, site, name }) {
  const results = await Promise.all([
    send(source.delete(artifactPath({ org, site, name }))),
    send(source.delete(configPath({ org, site, name }))),
  ]);
  const failed = results.find((result) => result.error && result.status !== 404);
  if (failed) return { error: `Could not delete endpoint "${name}".`, status: failed.status };
  // Best effort: drop the now empty endpoint folder.
  await send(source.delete(endpointPath({ org, site, name })));
  return { ok: true };
}
