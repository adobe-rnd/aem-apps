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

/**
 * Returns `notifyReindex(path)`, which tells the reindex service from `loadUrl({ org, site })`
 * that a DA document, `/{org}/{site}/...`, was published. Nothing is sent without a URL.
 * Fire and forget: it never throws and is not awaited, so it can't fail or slow down a save.
 */
// eslint-disable-next-line import/prefer-default-export
export function createReindexNotifier({ loadUrl, fetchFn = (...args) => fetch(...args) }) {
  return (path) => {
    const [, org, site, ...parts] = path.split('/');
    const aemPath = `/${parts.join('/')}`.replace(/\.html$/, '');
    try {
      Promise.resolve(loadUrl({ org, site }))
        .then((url) => url && fetchFn(`${url}/${org}/${site}/reindex`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tiers: ['live'], paths: [aemPath] }),
        }))
        .catch(() => {});
    } catch {
      // ignored, see above
    }
  };
}
