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
  schemaPath, schemasFolder, unwrapSchemaHtml, wrapSchemaHtml,
} from '../core/codeblock.js';

const NOT_FOUND = 404;

/** The core's schema repository: one document per schema in the site's `.da/forms/schemas`. */
// eslint-disable-next-line import/prefer-default-export
export function createSchemaRepository(source) {
  async function list({ org, site }) {
    const listed = await source.list({ path: schemasFolder(org, site) });
    // A site without schemas has no schemas folder yet.
    if (listed.status === NOT_FOUND) return { items: [] };
    if (listed.error) return { error: listed.error, status: listed.status };
    const items = listed.items
      .filter((item) => item?.name && item.ext === 'html')
      .map(({ name, lastModified }) => ({ name, lastModified }));
    return { items, permissions: listed.permissions };
  }

  async function read({ org, site, name }) {
    const result = await source.read({ path: schemaPath(org, site, name) });
    if (result.error) {
      const error = result.status === NOT_FOUND ? 'Not found' : result.error;
      return { error, status: result.status };
    }
    return unwrapSchemaHtml(result.text);
  }

  const save = ({
    org, site, name, json,
  }) => source.write({ path: schemaPath(org, site, name), text: wrapSchemaHtml(json) });

  const remove = ({ org, site, name }) => source.remove({ path: schemaPath(org, site, name) });

  return {
    list, read, save, remove,
  };
}
