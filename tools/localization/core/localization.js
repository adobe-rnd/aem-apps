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

export default function createLocalization({ org, providers, services = {} } = {}) {
  if (!org || !providers?.config || !providers?.pageInfo || !providers?.index) {
    throw new TypeError('createLocalization requires org and config, pageInfo and index providers');
  }

  let caches;
  const refresh = () => {
    caches = {
      config: new Map(),
      rows: new Map(),
      pageInfo: new Map(),
      index: new Map(),
      review: new Map(),
    };
  };
  refresh();

  const cached = (cache, key, load) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key);
  };

  const loadSite = async (site) => {
    const rows = await cached(caches.config, site, () => providers.config.read(site));
    caches.rows.set(site, rows ?? null);
  };

  const buildModel = () => parseConfig({ sites: Object.fromEntries(caches.rows) });

  async function resolveChain(site, path) {
    const model = buildModel();
    const chain = sourceChain(model, site, path);
    const source = chain.at(-1)?.location.source;
    const nextSite = source && siteOf(source);
    if (!nextSite || caches.rows.has(nextSite)) return { model, chain };
    await loadSite(nextSite);
    return resolveChain(site, path);
  }

  async function factsFor(ref) {
    const info = await cached(
      caches.pageInfo,
      `${ref.site}:${ref.path}`,
      () => providers.pageInfo.get(ref.site, ref.path),
    );
    const index = await cached(
      caches.index,
      ref.location.id,
      () => providers.index.read(ref.location.id),
    );
    const entry = info?.exists ? index?.pages?.[info.id] : index?.pending?.[ref.path];
    return {
      exists: Boolean(info?.exists),
      id: info?.id,
      version: info?.version,
      base: entry?.base ?? null,
      job: entry?.job ?? null,
    };
  }

  const needsReview = (ref) => cached(
    caches.review,
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
    await loadSite(site);
    const { model, chain: refs } = await resolveChain(site, path);
    const location = findLocation(model, site, path);
    if (!location) {
      return {
        location: null, chain: [], status: null, actions: [],
      };
    }

    const chain = await Promise.all(refs.map(async (ref) => ({ ref, facts: await factsFor(ref) })));
    const draft = pageStatus(chain);

    const reviewed = chain.filter((entry, i) => (i === 0 && entry.facts.exists)
      || (draft?.effectiveSource && entry.ref === draft.effectiveSource));
    await Promise.all(reviewed.map(async (entry) => {
      entry.facts.needsReview = Boolean(await needsReview(entry.ref));
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
