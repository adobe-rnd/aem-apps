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
export const ENDPOINT_NAME_MIN_LENGTH = 3;
export const ENDPOINT_NAME_MAX_LENGTH = 32;
const ENDPOINT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function createConfig({ name, schemas = [] }) {
  const ids = schemas.filter((id) => typeof id === 'string' && id);
  return { name, schemas: [...new Set(ids)].sort() };
}

// An endpoint's path on the da-sc-graphql worker, as GraphiQL queries it.
export const getEndpointPath = ({ org, site, name }) => `/${[org, site, 'endpoints', name, 'graphql']
  .map(encodeURIComponent).join('/')}`;

// The endpoint's URL on the worker at `serviceUrl` (`sc.graphql.url`); undefined without it.
export const getEndpointUrl = ({
  serviceUrl, org, site, name,
}) => (serviceUrl ? `${serviceUrl}${getEndpointPath({ org, site, name })}` : undefined);

export function validateEndpointName({ name, existing = [] }) {
  if (!name) return 'An endpoint name is required.';
  if (!ENDPOINT_NAME_PATTERN.test(name)) {
    return 'The endpoint name must start with a letter and contain only lowercase letters, numbers, or hyphens.';
  }
  if (name.length < ENDPOINT_NAME_MIN_LENGTH || name.length > ENDPOINT_NAME_MAX_LENGTH) {
    return `The endpoint name must be ${ENDPOINT_NAME_MIN_LENGTH}–${ENDPOINT_NAME_MAX_LENGTH} characters long.`;
  }
  if (existing.includes(name)) return `An endpoint named "${name}" already exists.`;
  return undefined;
}

export const isValidEndpointName = (name) => typeof name === 'string'
  && !validateEndpointName({ name });

export const serializeEndpoint = ({ config, generatedAt, sdl }) => [
  JSON.stringify({ ...createConfig(config), generatedAt }, null, 2),
  sdl,
];

const parseJson = (text) => {
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { error: 'The endpoint configuration is not valid JSON.' };
  }
};

export function parseConfig({ text, name }) {
  const { json, error } = parseJson(text);
  if (error) return { error };
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'The endpoint configuration is not an object.' };
  }
  const schemas = Array.isArray(json.schemas) ? json.schemas : [];
  return { config: createConfig({ name, schemas }) };
}

export const NO_SCHEMAS_MESSAGE = 'At least one Structured Content schema must be selected.';

// Whether a config can be stored and served; existing names are not checked.
export const validateConfig = ({ name, schemas }) => validateEndpointName({ name })
  ?? (schemas?.length ? undefined : NO_SCHEMAS_MESSAGE);
