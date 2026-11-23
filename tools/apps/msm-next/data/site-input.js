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
const NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function parseSite(value) {
  const text = (value ?? '').trim();
  const hashAt = text.indexOf('#');
  const scheme = /^[a-z]+:\/\//i.test(text);
  if (scheme && hashAt === -1) return null;
  const part = hashAt === -1 ? text : text.slice(hashAt + 1);
  const [org, site] = part.split('/').filter(Boolean).map((name) => name.toLowerCase());
  if (!org || !site || !NAME.test(org) || !NAME.test(site)) return null;
  return { org, site };
}

export function siteHash({ org, site }) {
  return `#/${org}/${site}`;
}
