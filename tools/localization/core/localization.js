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
import { parseConfig } from './domain/config.js';
import { findLocation, sourceChain } from './domain/resolve.js';
import { pageStatus } from './domain/status.js';
import { availableActions } from './domain/actions.js';

const siteOf = (id) => id.slice(0, id.indexOf(':'));

const newCaches = () => ({
  config: new Map(),
  rows: new Map(),
  pageInfo: new Map(),
  index: new Map(),
  review: new Map(),
});

const cached = (cache, key, load) => {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key);
};

export default function createLocalization({ org, providers, services = {} } = {}) {
  if (!org || !providers?.config || !providers?.pageInfo || !providers?.index) {
    throw new TypeError('createLocalization requires org and config, pageInfo and index providers');
  }

  let caches = newCaches();
  const refresh = () => { caches = newCaches(); };

  const loadSite = async (c, site) => {
    const rows = await cached(c.config, site, () => providers.config.read(site));
    c.rows.set(site, rows ?? null);
  };

  const buildModel = (c) => parseConfig({ sites: Object.fromEntries(c.rows) });

  async function loadAncestors(c, location, seen = new Set()) {
    if (!location?.source || seen.has(location.id)) return buildModel(c);
    seen.add(location.id);
    const sourceSite = siteOf(location.source);
    if (!c.rows.has(sourceSite)) await loadSite(c, sourceSite);
    const model = buildModel(c);
    return loadAncestors(c, model.locations.get(location.source), seen);
  }

  async function pageInfoFor(c, ref) {
    const info = await cached(
      c.pageInfo,
      `${ref.site}:${ref.path}`,
      () => providers.pageInfo.get(ref.site, ref.path),
    );
    const locationId = ref.location.id;
    const index = await cached(c.index, locationId, () => providers.index.read(locationId));
    const entry = info?.exists ? index?.pages?.[info.id] : index?.pending?.[ref.path];
    return {
      exists: Boolean(info?.exists),
      id: info?.id,
      version: info?.version,
      base: entry?.base ?? null,
      job: entry?.job ?? null,
    };
  }

  const needsReview = (c, ref) => cached(
    c.review,
    `${ref.site}:${ref.path}`,
    () => providers.pageInfo.needsReview(ref.site, ref.path),
  );

  async function translationSupported(location, status) {
    const supports = services.translationConnectors?.supports;
    const sourceLanguage = status?.effectiveSource?.location?.language;
    if (!supports || !sourceLanguage || !location.actions.includes('translate')) return true;
    return supports(sourceLanguage, location.language);
  }

  async function page(site, path) {
    const c = caches;
    await loadSite(c, site);
    const model = await loadAncestors(c, findLocation(buildModel(c), site, path));
    const location = findLocation(model, site, path);
    if (!location) {
      return {
        location: null, chain: [], status: null, actions: [],
      };
    }

    const refs = sourceChain(model, site, path);
    const chain = await Promise.all(refs.map(async (ref) => ({
      ref, info: await pageInfoFor(c, ref),
    })));
    const draft = pageStatus(chain);

    const reviewed = chain.filter((entry, i) => (i === 0 && entry.info.exists)
      || (draft?.effectiveSource && entry.ref === draft.effectiveSource));
    await Promise.all(reviewed.map(async (entry) => {
      entry.info.needsReview = Boolean(await needsReview(c, entry.ref));
    }));

    const status = pageStatus(chain);
    const actions = availableActions({
      status,
      location,
      translationSupported: await translationSupported(location, status),
    });
    return {
      location, chain, status, actions,
    };
  }

  return { org, page, refresh };
}
