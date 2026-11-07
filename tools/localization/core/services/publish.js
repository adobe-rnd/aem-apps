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
export function toAemPath(path) {
  if (path.endsWith('/index.html')) return path.slice(0, -'index.html'.length);
  if (path.endsWith('.html')) return path.slice(0, -'.html'.length);
  return path;
}

function toResult(operation, response) {
  if (response.ok) return { ok: true, status: response.status };
  const error = response.headers.get('x-error') ?? `${operation} failed with status ${response.status}`;
  return { ok: false, status: response.status, error };
}

export default function createPublishService({ org, api }) {
  const aemTarget = ({ site, path }) => ({ org, site, path: toAemPath(path) });

  async function preview(page) {
    return toResult('preview', await api.aem.preview(aemTarget(page)));
  }

  async function publish(page) {
    const previewResult = await preview(page);
    if (!previewResult.ok) return previewResult;
    return toResult('publish', await api.aem.publish(aemTarget(page)));
  }

  return { preview, publish };
}
