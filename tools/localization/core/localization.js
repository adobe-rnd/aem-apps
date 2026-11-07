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
  const publishValues = new Map();
  const publishFresh = new Set();
  const publishInflight = new Map();
  const publishKey = (site, path) => `${site}:${path}`;
  const publishValue = (state) => {
    if (state?.live) return 'live';
    return state?.preview ? 'preview' : null;
  };
  const invalidatePublishState = (site, path) => {
    if (site === undefined) {
      publishFresh.clear();
      publishInflight.clear();
      return;
    }
    services.publish?.invalidate?.({ site, path });
    publishFresh.delete(publishKey(site, path));
    publishInflight.delete(publishKey(site, path));
  };
  const publishState = (site, path) => publishValues.get(publishKey(site, path)) ?? null;
  const trackPublishState = ({ site, path }, lookup) => {
    const key = publishKey(site, path);
    const task = lookup
      .catch(() => null)
      .then((state) => {
        if (publishInflight.get(key) !== task) return false;
        publishInflight.delete(key);
        publishFresh.add(key);
        const value = publishValue(state);
        const changed = publishState(site, path) !== value;
        publishValues.set(key, value);
        return changed;
      });
    publishInflight.set(key, task);
    return task;
  };
  const pendingPublishState = ({ site, path }) => {
    const key = publishKey(site, path);
    if (publishFresh.has(key)) return Promise.resolve(false);
    return publishInflight.get(key) ?? null;
  };
  const loadPublishState = async (pages) => {
    if (!services.publish?.state) return false;
    const unique = new Map();
    pages.forEach((ref) => unique.set(publishKey(ref.site, ref.path), ref));
    const waiting = [];
    const missing = [];
    unique.forEach((ref) => {
      const pending = pendingPublishState(ref);
      if (pending) waiting.push(pending);
      else missing.push(ref);
    });
    let lookups;
    if (missing.length > 1 && services.publish.stateMany) {
      const many = Promise.resolve().then(() => services.publish.stateMany(missing));
      lookups = missing.map((ref, index) => many.then((states) => states[index]));
    } else {
      lookups = missing.map((ref) => Promise.resolve().then(() => services.publish.state(ref)));
    }
    const started = missing.map((ref, index) => trackPublishState(ref, lookups[index]));
    const changes = await Promise.all([...waiting, ...started]);
    return changes.some(Boolean);
  };
  const invalidating = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } finally {
      invalidatePublishState();
    }
  };
  const refresh = ({ publish = true } = {}) => {
    caches = newCaches();
    if (!publish) return;
    services.publish?.clear?.();
    invalidatePublishState();
  };

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
    if (draft?.relationship === 'inherited' && services.publish?.state) {
      const published = await Promise.resolve()
        .then(() => services.publish.state({ site, path }))
        .catch(() => null);
      if (published) self.info.published = published;
    }
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
    execute: invalidating(executor.execute),
    publish: invalidating(executor.publish),
    publishState,
    loadPublishState,
    invalidatePublishState,
    checkJobs: executor.checkJobs,
    translateMany: executor.translateMany,
    propagate: invalidating(runner.propagate),
    retryRun: invalidating(runner.retryRun),
    resumeRun: invalidating(runner.resumeRun),
    cancelRun: runner.cancelRun,
    archiveRun: runner.archiveRun,
    runs: providers.runs ?? null,
  };
}
