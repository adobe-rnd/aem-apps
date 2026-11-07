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
import createConfigProvider from './providers/config.js';
import createPageInfoProvider from './providers/page-info.js';
import createLocIndexProvider from './providers/loc-index.js';
import createRunsProvider from './providers/runs.js';
import createJobsProvider from './providers/jobs.js';
import createContentService from './services/content.js';
import createPublishService from './services/publish.js';
import createLegacyApi, { DA_ORIGIN } from './api/legacy.js';
import createExecutor from './execute.js';
import createRunner from './runs.js';

const siteOf = (id) => id.slice(0, id.indexOf(':'));

const newCaches = () => ({
  config: new Map(),
  rows: new Map(),
  pageInfo: new Map(),
  index: new Map(),
  review: new Map(),
  hlx6: new Map(),
});

const cached = (cache, key, load) => {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key);
};

function defaultApi({ api, actions, daOrigin }) {
  if (api) return api;
  if (!actions?.daFetch) return null;
  return createLegacyApi({ fetch: actions.daFetch, daOrigin });
}

function defaultProviders({ org, api }) {
  if (!api) return {};
  return {
    config: createConfigProvider({ org, api }),
    pageInfo: createPageInfoProvider({ org, api }),
    index: createLocIndexProvider({ org, api }),
    runs: createRunsProvider({ org, api }),
    jobs: createJobsProvider({ org, api }),
  };
}

function defaultServices({ org, api, actions }) {
  if (!api) return {};
  const services = { publish: createPublishService({ org, api }) };
  services.content = createContentService({ org, api, loc: actions?.loc });
  return services;
}

export default function createLocalization({
  org,
  actions,
  api: apiOverride,
  daOrigin = DA_ORIGIN,
  providers: providerOverrides = {},
  services: serviceOverrides = {},
} = {}) {
  const api = defaultApi({ api: apiOverride, actions, daOrigin });
  const providers = { ...defaultProviders({ org, api }), ...providerOverrides };
  const services = { ...defaultServices({ org, api, actions }), ...serviceOverrides };
  if (!org || !providers.config || !providers.pageInfo || !providers.index) {
    throw new TypeError('createLocalization requires org and either an api, actions.daFetch, or config, pageInfo and index providers');
  }

  let caches = newCaches();
  const refresh = () => { caches = newCaches(); };

  const loadSite = async (snapshot, site) => {
    const rows = await cached(snapshot.config, site, () => providers.config.read(site));
    snapshot.rows.set(site, rows ?? null);
  };

  const buildModel = (snapshot) => parseConfig({ sites: Object.fromEntries(snapshot.rows) });

  async function loadAncestors(snapshot, location, seen = new Set()) {
    if (!location?.source || seen.has(location.id)) return buildModel(snapshot);
    seen.add(location.id);
    const sourceSite = siteOf(location.source);
    if (!snapshot.rows.has(sourceSite)) await loadSite(snapshot, sourceSite);
    const model = buildModel(snapshot);
    return loadAncestors(snapshot, model.locations.get(location.source), seen);
  }

  async function pageInfoFor(snapshot, ref) {
    const info = await cached(
      snapshot.pageInfo,
      `${ref.site}:${ref.path}`,
      () => providers.pageInfo.get(ref.site, ref.path),
    );
    const locationId = ref.location.id;
    const index = await cached(snapshot.index, locationId, () => providers.index.read(locationId));
    const entry = info?.exists ? index?.pages?.[info.id] : index?.pending?.[ref.path];
    return {
      exists: Boolean(info?.exists),
      id: info?.id,
      version: info?.version,
      base: entry?.base ?? null,
      job: entry?.job ?? null,
      overrides: entry?.overrides ?? null,
      linked: !info?.exists && Boolean(entry?.linked),
    };
  }

  const needsReview = (snapshot, ref) => cached(
    snapshot.review,
    `${ref.site}:${ref.path}`,
    () => providers.pageInfo.needsReview(ref.site, ref.path),
  );

  async function translationSupported(location, status) {
    const supports = services.translationConnectors?.supports;
    const sourceLanguage = status?.effectiveSource?.location?.language;
    if (!sourceLanguage || !location.actions.includes('translate')) return true;
    if (!supports) return false;
    return supports(sourceLanguage, location.language);
  }

  const isHlx6 = (snapshot, site) => cached(
    snapshot.hlx6,
    site,
    async () => Boolean(await api?.isHlx6?.({ org, site })),
  );

  async function backendSupported(snapshot, site, status) {
    const sites = new Set([site, status?.effectiveSource?.site].filter(Boolean));
    const flags = await Promise.all([...sites].map((each) => isHlx6(snapshot, each)));
    return !flags.some(Boolean);
  }

  async function page(site, path) {
    const snapshot = caches;
    await loadSite(snapshot, site);
    const model = await loadAncestors(snapshot, findLocation(buildModel(snapshot), site, path));
    const location = findLocation(model, site, path);
    if (!location) {
      return {
        location: null, chain: [], status: null, actions: [],
      };
    }

    const refs = sourceChain(model, site, path);
    const chain = await Promise.all(refs.map(async (ref) => ({
      ref, info: await pageInfoFor(snapshot, ref),
    })));
    const draft = pageStatus(chain);

    const [self] = chain;
    const reviewed = chain.filter((entry) => (entry === self && entry.info.exists)
      || (draft?.effectiveSource && entry.ref === draft.effectiveSource));
    await Promise.all(reviewed.map(async (entry) => {
      entry.info.needsReview = Boolean(await needsReview(snapshot, entry.ref));
    }));

    const status = pageStatus(chain);
    const pageActions = availableActions({
      status,
      location,
      translationSupported: await translationSupported(location, status),
      backendSupported: await backendSupported(snapshot, site, status),
      copyEngineAvailable: Boolean(services.content && services.content.copyAvailable !== false),
    });
    return {
      location, chain, status, actions: pageActions,
    };
  }

  async function orgModel() {
    const snapshot = caches;
    const sites = await providers.config.listSites();
    await Promise.all(sites.map((site) => loadSite(snapshot, site)));
    return buildModel(snapshot);
  }

  const executor = createExecutor({
    org, page, providers, services, refresh, orgModel,
  });
  const runner = createRunner({
    page,
    execute: executor.execute,
    checkJobs: executor.checkJobs,
    clearJobs: executor.clearJobs,
    translateMany: executor.translateMany,
    orgModel,
    refresh,
    runs: providers.runs,
  });

  return {
    org,
    page,
    refresh,
    orgModel,
    execute: executor.execute,
    publish: executor.publish,
    checkJobs: executor.checkJobs,
    translateMany: executor.translateMany,
    propagate: runner.propagate,
    retryRun: runner.retryRun,
    resumeRun: runner.resumeRun,
    cancelRun: runner.cancelRun,
    archiveRun: runner.archiveRun,
    runs: providers.runs ?? null,
  };
}
