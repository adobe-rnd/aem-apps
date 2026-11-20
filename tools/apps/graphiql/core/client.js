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

// The Content AI GraphQL endpoint, used when neither the site nor the org config sets
// `graphql.endpoint`. It needs the `x-api-key` header.
export const DEFAULT_ENDPOINT_PATTERN = 'https://publish-p153659-e1614585.adobeaemcloud.com'
  // eslint-disable-next-line no-template-curly-in-string
  + '/adobe/experimental/aemcontentai-expires-20261231/contentAI/graphql/${org}--${site}/endpoints/${endpoint}/graphql';

const URL_PLACEHOLDER = /\$\{(endpoint|org|site)\}/g;

/** The https URL of an endpoint from a `${endpoint}` (and `${org}`, `${site}`) pattern. */
export function getEndpointUrl({
  pattern = DEFAULT_ENDPOINT_PATTERN, org, site, endpoint,
}) {
  const values = { endpoint, org, site };
  const href = pattern.replace(URL_PLACEHOLDER, (_, key) => encodeURIComponent(values[key]));
  try {
    const url = new URL(href);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
