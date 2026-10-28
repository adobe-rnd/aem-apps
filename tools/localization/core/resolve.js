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

const isHidden = (path) => path.split('/').some((segment) => segment.startsWith('.'));

const contains = (folder, path) => folder === '/'
  || path === folder
  || path.startsWith(`${folder}/`);

const relativePath = (folder, path) => {
  if (folder === '/') return path === '/' ? '' : path;
  return path.slice(folder.length);
};

const joinPath = (folder, rel) => {
  if (folder === '/') return rel || '/';
  return `${folder}${rel}`;
};

export function findLocation(model, site, path) {
  if (!path?.startsWith('/') || isHidden(path)) return null;
  let found = null;
  model.locations.forEach((location) => {
    if (location.site !== site || !contains(location.path, path)) return;
    if (!found || location.path.length > found.path.length) found = location;
  });
  return found;
}

function mapInto(model, from, path, to) {
  const mapped = joinPath(to.path, relativePath(from.path, path));
  const owner = findLocation(model, to.site, mapped);
  if (owner?.id !== to.id) return null;
  return { site: to.site, path: mapped, location: to };
}

export function sourcePage(model, site, path) {
  const location = findLocation(model, site, path);
  const source = location?.source && model.locations.get(location.source);
  if (!source) return null;
  return mapInto(model, location, path, source);
}

export function sourceChain(model, site, path) {
  const location = findLocation(model, site, path);
  if (!location) return [];
  const chain = [{ site, path, location }];
  const seen = new Set([location.id]);
  let next = sourcePage(model, site, path);
  while (next && !seen.has(next.location.id)) {
    chain.push(next);
    seen.add(next.location.id);
    next = sourcePage(model, next.site, next.path);
  }
  return chain;
}

export function targetLocations(model, id) {
  return [...model.locations.values()].filter((location) => location.source === id);
}

export function targetPages(model, site, path) {
  const location = findLocation(model, site, path);
  if (!location) return [];
  return targetLocations(model, location.id)
    .filter((target) => target.id !== location.id)
    .map((target) => mapInto(model, location, path, target))
    .filter(Boolean);
}

const LEGACY_HOST = /^[a-z0-9-]+$/;

const siteFromHostname = (hostname) => {
  const parts = String(hostname).trim().toLowerCase().split('.')[0].split('--');
  if (parts.length !== 3 || !parts.every((p) => LEGACY_HOST.test(p))) return null;
  return parts[1];
};

export function equivalentSites(model, hostnames = []) {
  const sites = new Set([...model.locations.values()].map((location) => location.site));
  hostnames.forEach((hostname) => {
    const site = siteFromHostname(hostname);
    if (site) sites.add(site);
  });
  return sites;
}
