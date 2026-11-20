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

// The GraphQL service cannot be called from a browser (CORS preflight is rejected), so queries go
// through the da-sc-graphql worker, which answers the preflight and adds the API key.

/**
 * The query URL of an endpoint on the da-sc-graphql worker at `serviceUrl` (the `sc.graphql.url`
 * config): `{serviceUrl}/{org}/{site}/endpoints/{endpoint}/graphql`. Undefined unless https.
 */
export function getEndpointUrl({
  serviceUrl, org, site, endpoint,
}) {
  try {
    const base = new URL(String(serviceUrl ?? '').trim());
    if (base.protocol !== 'https:') return undefined;
    const path = [org, site, 'endpoints', endpoint, 'graphql'].map(encodeURIComponent).join('/');
    return `${base.href.replace(/\/+$/, '')}/${path}`;
  } catch {
    return undefined;
  }
}

const reason = (e) => e?.message || String(e);

/**
 * The schema the service serves for an endpoint, by sending the introspection `query` through
 * `fetcher`: `{ schema }` (an introspection result GraphiQL takes) or `{ error }`.
 */
export async function introspect({ fetcher, query }) {
  let result;
  try {
    result = await fetcher({ query, operationName: 'IntrospectionQuery' });
  } catch (e) {
    return { error: `The GraphQL service could not be reached (${reason(e)}). It may not allow this origin (CORS).` };
  }
  // eslint-disable-next-line no-underscore-dangle
  if (result?.data?.__schema) return { schema: result.data };
  return { error: result?.errors?.[0]?.message ?? 'The GraphQL service returned no schema.' };
}
