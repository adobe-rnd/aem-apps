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
import planPropagation from '../../../../localization/core/domain/plan.js';

const HOUR = 3600 * 1000;
const BLOCKING = ['failed', 'blocked', 'needs review', 'translating', 'skipped'];

export const SEED_RUN = {
  id: 'run-seed-starfall-fr',
  title: 'Starfall launch (French)',
  pages: [{ site: 'gamebox', path: '/global/games/starfall.html' }],
  targets: ['gamebox:/fr-fr', 'gamebox:/fr-be'],
  option: 'merge',
  age: 26 * HOUR,
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function summarize(items) {
  return items.reduce((summary, item) => ({
    ...summary,
    [item.state]: (summary[item.state] ?? 0) + 1,
  }), { total: items.length });
}

const stateFromStatus = (status) => {
  if (!status) return { state: 'skipped', reasons: ['no-page'] };
  if (status.relationship === 'inherited') return { state: 'inherited' };
  if (status.sync.includes('translating') || status.sync.includes('ready to save')) {
    return { state: 'translating', action: 'translate' };
  }
  if (status.sync.includes('current')) return { state: 'done', action: 'rollout' };
  return { state: 'pending' };
};

export async function buildSeedRun({ orgModel, page, now = Date.now() }) {
  const model = await orgModel();
  const { items } = planPropagation(model, { pages: SEED_RUN.pages, targets: SEED_RUN.targets });
  const at = new Date(now - SEED_RUN.age).toISOString();
  await Promise.all(items.map(async (item) => {
    const { status } = await page(item.site, item.path);
    Object.assign(item, { reasons: [], at }, stateFromStatus(status));
  }));
  [...items].sort((first, second) => first.depth - second.depth).forEach((item) => {
    const parent = items.find((each) => each.key === item.parent);
    if (parent && BLOCKING.includes(parent.state)) {
      Object.assign(item, { state: 'blocked', reasons: [`parent:${parent.state}`], action: undefined });
    }
  });
  return {
    id: SEED_RUN.id,
    title: SEED_RUN.title,
    createdAt: at,
    updatedAt: at,
    site: SEED_RUN.pages[0].site,
    pages: SEED_RUN.pages,
    targets: SEED_RUN.targets,
    option: SEED_RUN.option,
    items,
    summary: summarize(items),
  };
}

export function createRunStore({ wait = async () => {}, seed = null } = {}) {
  const store = new Map();
  let seeded = null;
  const keyOf = (site, id) => `${site}:${id}`;

  const ensureSeed = () => {
    if (!seed) return Promise.resolve();
    seeded ??= seed().then((run) => {
      if (run && !store.has(keyOf(run.site, run.id))) {
        const lastModified = Date.parse(run.updatedAt);
        store.set(keyOf(run.site, run.id), { run: clone(run), lastModified });
      }
    }).catch(() => {});
    return seeded;
  };

  async function save(run) {
    await wait();
    store.set(keyOf(run.site, run.id), { run: clone(run), lastModified: Date.now() });
    return run;
  }

  async function read(site, id) {
    await ensureSeed();
    await wait();
    const entry = store.get(keyOf(site, id));
    return entry ? clone(entry.run) : null;
  }

  async function list(site) {
    await ensureSeed();
    await wait();
    return [...store.values()]
      .filter((entry) => entry.run.site === site)
      .map((entry) => ({ id: entry.run.id, lastModified: entry.lastModified }))
      .sort((first, second) => second.lastModified - first.lastModified);
  }

  return { save, read, list };
}
