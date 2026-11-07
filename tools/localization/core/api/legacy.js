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

export const DA_ORIGIN = 'https://admin.da.live';
export const AEM_ORIGIN = 'https://admin.hlx.page';

const CONTINUATION_HEADER = 'da-continuation-token';

const CONTENT_TYPES = {
  html: 'text/html',
  json: 'application/json',
};

const contentTypeOf = (path) => CONTENT_TYPES[path.split('.').pop()] ?? '';

const sitePath = ({ org, site, path = '' }) => {
  const folder = path === '/' ? '' : path;
  return site ? `/${org}/${site}${folder}` : `/${org}`;
};

export default function createLegacyApi({
  fetch, daOrigin = DA_ORIGIN, aemOrigin = AEM_ORIGIN,
}) {
  const sourceUrl = (target) => `${daOrigin}/source${sitePath(target)}`;

  const source = {
    get: (target) => fetch(sourceUrl(target), { cache: 'no-store' }),
    getMetadata: (target) => fetch(sourceUrl(target), { method: 'HEAD', cache: 'no-store' }),
    delete: (target) => fetch(sourceUrl(target), { method: 'DELETE' }),
    save: ({ body, headers = {}, ...target }) => {
      const formData = new FormData();
      formData.append('data', new Blob([body], { type: contentTypeOf(target.path) }));
      return fetch(sourceUrl(target), { method: 'POST', body: formData, headers });
    },
    list: async ({ continuationToken, ...target }) => {
      const headers = continuationToken ? { [CONTINUATION_HEADER]: continuationToken } : {};
      const response = await fetch(`${daOrigin}/list${sitePath(target)}`, { cache: 'no-store', headers });
      if (!response.ok) {
        return {
          ok: false, status: response.status, items: [], continuationToken: null,
        };
      }
      return {
        ok: true,
        status: response.status,
        items: await response.json(),
        continuationToken: response.headers.get(CONTINUATION_HEADER),
      };
    },
  };

  const config = {
    get: ({ org, site }) => fetch(`${daOrigin}/config/${org}/${site}`, { cache: 'no-store' }),
  };

  const aemUrl = (route, { org, site, path }) => `${aemOrigin}/${route}/${org}/${site}/main${path}`;
  const aem = {
    status: (target) => fetch(aemUrl('status', target), { cache: 'no-store' }),
    preview: (target) => fetch(aemUrl('preview', target), { method: 'POST' }),
    publish: (target) => fetch(aemUrl('live', target), { method: 'POST' }),
  };

  return {
    isHlx6: async () => false,
    source,
    config,
    aem,
  };
}
