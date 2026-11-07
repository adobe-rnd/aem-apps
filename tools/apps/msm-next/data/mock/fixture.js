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

export const MOCK_ORG = 'gamebox-demo';
export const MOCK_SITE = 'gamebox';

const COPY = { actions: 'link, rollout', missingPages: 'linked', conflictBehavior: 'merge, overwrite' };
const TRANSLATE = { actions: 'translate' };

export const CONFIGS = {
  gamebox: [
    {
      path: '/global', language: 'en', label: 'Global', level: 'Global',
    },
    {
      path: '/amer', language: 'en', label: 'Americas', level: 'Region', source: '/global', ...COPY,
    },
    {
      path: '/en-us', language: 'en-US', level: 'Locale', source: '/amer', ...COPY,
    },
    {
      path: '/en-ca', language: 'en-CA', level: 'Locale', source: '/amer', ...COPY, missingPages: 'none',
    },
    {
      path: '/es-419', language: 'es-419', level: 'Language', source: '/amer', ...TRANSLATE,
    },
    {
      path: '/es-mx', language: 'es-MX', level: 'Locale', source: '/es-419', ...COPY,
    },
    {
      path: '/emea', language: 'en', label: 'EMEA', level: 'Region', source: '/global', ...COPY,
    },
    {
      path: '/en-gb', language: 'en-GB', level: 'Locale', source: '/emea', actions: 'rollout', conflictBehavior: 'merge, overwrite',
    },
    {
      path: '/fr', language: 'fr', level: 'Language', source: '/emea', ...TRANSLATE,
    },
    {
      path: '/fr-fr', language: 'fr-FR', level: 'Locale', source: '/fr', ...COPY,
    },
    {
      path: '/fr-be', language: 'fr-BE', level: 'Locale', source: '/fr', ...COPY,
    },
    {
      path: '/de', language: 'de', level: 'Language', source: '/emea', ...TRANSLATE,
    },
    {
      path: '/de-de', language: 'de-DE', level: 'Locale', source: '/de', ...COPY,
    },
    {
      path: '/de-at', language: 'de-AT', level: 'Locale', source: '/de', ...COPY,
    },
  ],
  'gamebox-retail': [
    {
      path: '/pixelmart', language: 'en-US', label: 'PixelMart', level: 'Retailer', source: 'gamebox:/en-us', ...COPY,
    },
    {
      path: '/arcade-avenue', language: 'en-US', label: 'Arcade Avenue', level: 'Retailer', source: 'gamebox:/en-us', actions: 'rollout', conflictBehavior: 'merge, overwrite',
    },
  ],
};

export const SOURCE_PAGES = [
  '/index.html',
  '/hardware/console.html',
  '/hardware/controller.html',
  '/games/index.html',
  '/games/starfall.html',
  '/services/gamebox-plus.html',
  '/support/index.html',
  '/legal/terms.html',
];

export const STATES = {
  'gamebox:/global': { fallback: 'root' },
  'gamebox:/amer': {
    fallback: 'inherited',
    pages: {
      '/index.html': 'current',
      '/hardware/console.html': 'overridden',
      '/games/starfall.html': 'behind',
    },
  },
  'gamebox:/en-us': {
    fallback: 'inherited',
    pages: {
      '/index.html': 'current',
      '/hardware/console.html': 'review',
      '/support/index.html': 'unlinked',
    },
    extra: { '/deals/black-friday.html': 'standalone' },
  },
  'gamebox:/en-ca': {
    fallback: 'missing',
    pages: {
      '/index.html': 'current',
      '/hardware/console.html': 'behind',
      '/games/index.html': 'linked',
    },
  },
  'gamebox:/es-419': {
    fallback: 'missing',
    pages: {
      '/index.html': 'current',
      '/hardware/console.html': 'translating',
      '/games/starfall.html': 'ready',
      '/games/index.html': 'behind',
    },
  },
  'gamebox:/es-mx': {
    fallback: 'inherited',
    pages: { '/index.html': 'current' },
  },
  'gamebox:/emea': {
    fallback: 'inherited',
    pages: {
      '/index.html': 'current',
      '/services/gamebox-plus.html': 'behind-overridden',
    },
  },
  'gamebox:/en-gb': {
    fallback: 'missing',
    pages: {
      '/index.html': 'current',
      '/hardware/console.html': 'overridden',
      '/legal/terms.html': 'behind',
    },
  },
  'gamebox:/fr': {
    fallback: 'missing',
    pages: {
      '/index.html': 'current',
      '/hardware/console.html': 'overridden',
      '/services/gamebox-plus.html': 'review',
      '/games/starfall.html': 'translating',
    },
  },
  'gamebox:/fr-fr': { fallback: 'inherited', pages: { '/index.html': 'current' } },
  'gamebox:/fr-be': { fallback: 'inherited', pages: { '/index.html': 'behind' } },
  'gamebox:/de': {
    fallback: 'missing',
    pages: {
      '/index.html': 'current',
      '/hardware/console.html': 'behind',
      '/legal/terms.html': 'ready',
    },
  },
  'gamebox:/de-de': { fallback: 'inherited', pages: { '/hardware/console.html': 'current' } },
  'gamebox:/de-at': { fallback: 'inherited', extra: { '/aktion.html': 'standalone' } },
  'gamebox-retail:/pixelmart': {
    fallback: 'inherited',
    pages: { '/index.html': 'overridden', '/hardware/console.html': 'current' },
  },
  'gamebox-retail:/arcade-avenue': {
    fallback: 'missing',
    pages: { '/index.html': 'current', '/games/starfall.html': 'unlinked' },
    extra: { '/events/launch-party.html': 'standalone' },
  },
};

export const HIDDEN_PATHS = ['gamebox:/.da/loc/global/index.json', 'gamebox:/global/.trash/old-home.html'];

const DAY = 24 * 3600 * 1000;
const COPY_STATES = ['current', 'overridden', 'behind', 'behind-overridden', 'review', 'unlinked'];

const idOf = (site, path) => {
  if (path.startsWith('/')) return `${site}:${path}`;
  return path;
};

export function locationIndex() {
  const byId = new Map();
  Object.entries(CONFIGS).forEach(([site, rows]) => rows.forEach((row) => {
    const id = `${site}:${row.path}`;
    byId.set(id, {
      id,
      site,
      path: row.path,
      source: row.source ? idOf(site, row.source) : null,
      missingPages: row.missingPages ?? 'none',
      translates: (row.actions ?? '').includes('translate'),
    });
  }));
  return byId;
}

export function buildFixture(now = Date.parse('2026-11-01T12:00:00Z')) {
  const files = new Map();
  const indexes = new Map();
  const locations = locationIndex();
  let seq = 0;
  const next = () => {
    seq += 1;
    return seq;
  };
  const key = (location, rel) => `${location.site}:${location.path}${rel}`;
  const indexOf = (id) => {
    if (!indexes.has(id)) indexes.set(id, { pages: {}, pending: {} });
    return indexes.get(id);
  };

  const effective = (location, rel) => {
    let parent = location.source ? locations.get(location.source) : null;
    while (parent) {
      const file = files.get(key(parent, rel));
      if (file) return file;
      const linked = indexOf(parent.id).pending[`${parent.path}${rel}`]?.linked;
      if (parent.missingPages !== 'linked' && !linked) return null;
      parent = parent.source ? locations.get(parent.source) : null;
    }
    return null;
  };

  const addFile = (location, rel, extra = {}) => {
    const number = next();
    const file = { id: `mock-id-${number}`, version: `"mock-v${number}"`, ...extra };
    files.set(key(location, rel), file);
    return file;
  };

  const applyCopy = (location, rel, state) => {
    const source = effective(location, rel);
    if (!source) return;
    const edited = state === 'overridden' || state === 'behind-overridden';
    const file = addFile(location, rel, { edited, needsReview: state === 'review' });
    const behind = state === 'behind' || state === 'behind-overridden';
    const entry = {
      base: {
        sourceId: source.id,
        sourceVersion: behind ? '"mock-v-old"' : source.version,
        via: location.translates ? 'translate' : 'rollout',
        targetVersion: edited ? '"mock-v-prev"' : file.version,
        at: new Date(now - ((seq % 9) + 1) * DAY).toISOString(),
      },
    };
    if (state === 'unlinked') {
      const sourceLocation = locations.get(location.source);
      entry.overrides = {
        unlinked: true,
        unlinkedFrom: `${sourceLocation.site}:${sourceLocation.path}${rel}`,
        unlinkedAt: new Date(now - 3 * DAY).toISOString(),
      };
    }
    indexOf(location.id).pages[file.id] = entry;
  };

  const apply = (location, rel, state) => {
    const path = `${location.path}${rel}`;
    if (state === 'root' || state === 'standalone') {
      addFile(location, rel);
    } else if (COPY_STATES.includes(state)) {
      applyCopy(location, rel, state);
    } else if (state === 'translating' || state === 'ready') {
      indexOf(location.id).pending[path] = {
        job: { state, id: `mock-job-${next()}`, at: new Date(now - DAY).toISOString() },
      };
    } else if (state === 'linked') {
      const at = new Date(now - 2 * DAY).toISOString();
      indexOf(location.id).pending[path] = { linked: true, at };
    }
  };

  locations.forEach((location) => {
    const plan = STATES[location.id] ?? { fallback: 'inherited' };
    SOURCE_PAGES.forEach((rel) => apply(location, rel, plan.pages?.[rel] ?? plan.fallback));
    Object.entries(plan.extra ?? {}).forEach(([rel, state]) => apply(location, rel, state));
  });

  return { files, indexes, now };
}
