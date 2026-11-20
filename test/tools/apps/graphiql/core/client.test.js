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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEndpointUrl, introspect } from '../../../../../tools/apps/graphiql/core/client.js';

describe('getEndpointUrl', () => {
  it('fills the default Content AI pattern', () => {
    assert.equal(
      getEndpointUrl({ org: 'acme', site: 'web', endpoint: 'products' }),
      'https://publish-p153659-e1614585.adobeaemcloud.com/adobe/experimental/aemcontentai-expires-20261231/contentAI/graphql/acme--web/endpoints/products/graphql',
    );
  });

  it('fills a configured pattern', () => {
    assert.equal(
      getEndpointUrl({
        // eslint-disable-next-line no-template-curly-in-string
        pattern: 'https://gql.example/${org}--${site}/${endpoint}', org: 'a', site: 'b', endpoint: 'c',
      }),
      'https://gql.example/a--b/c',
    );
  });

  it('rejects patterns that are not https URLs', () => {
    assert.equal(getEndpointUrl({ pattern: 'http://gql.example/x', endpoint: 'x' }), undefined);
    assert.equal(getEndpointUrl({ pattern: 'not a url', endpoint: 'x' }), undefined);
  });
});

describe('introspect', () => {
  const query = '{ __schema { types { name } } }';

  it('returns the introspection result Content AI serves', async () => {
    const data = { __schema: { types: [] } };
    const fetcher = async () => ({ data });
    assert.deepEqual(await introspect({ fetcher, query }), { schema: data });
  });

  it('reports a GraphQL error', async () => {
    const fetcher = async () => ({ errors: [{ message: 'HTTP 401: Unauthorized' }] });
    assert.deepEqual(await introspect({ fetcher, query }), { error: 'HTTP 401: Unauthorized' });
  });

  it('reports an unreachable endpoint as a possible CORS failure', async () => {
    const fetcher = async () => { throw new TypeError('Failed to fetch'); };
    const { error } = await introspect({ fetcher, query });
    assert.match(error, /Failed to fetch.*CORS/);
  });
});
