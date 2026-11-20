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

/** A first query for GraphiQL: the first page of a `{type}List` query field. */
export function listQuery(field) {
  if (!field) return '{\n  \n}\n';
  return `{
  ${field}(first: 10) {
    items {
      path
      title
    }
    pageInfo {
      hasNextPage
      endCursor
      total
    }
  }
}
`;
}

/** The first `{type}List` query field of an introspection result. */
export function firstListField({ __schema: schema } = {}) {
  const query = schema?.types?.find(({ name }) => name === schema.queryType?.name);
  return query?.fields?.find(({ name }) => name.endsWith('List'))?.name;
}
