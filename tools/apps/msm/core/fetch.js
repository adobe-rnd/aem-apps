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

let daFetchFn = null;

export function setDaFetch(fn) {
  daFetchFn = fn;
}

export async function daFetch(url, opts) {
  if (!daFetchFn) {
    throw new Error('MSM requires SDK fetch initialization');
  }
  return daFetchFn(url, opts);
}

export const DA_ORIGIN = 'https://admin.da.live';
export const AEM_ADMIN = 'https://admin.hlx.page';

// Publishing bumps a page's lastModified after its publish timestamp is
// recorded, producing a spurious "behind source" signal. This absorbs that lag.
export const PUBLISH_LAG_MS = 5000;

// Normalize a page path for use in API URLs: add leading slash, strip the
// given extension. Called by status and operations before building URLs.
export function cleanPath(pagePath, ext) {
  const withSlash = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  return withSlash.replace(new RegExp(`\\.${ext}$`), '');
}
