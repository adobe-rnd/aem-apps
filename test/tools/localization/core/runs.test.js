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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import createWorld, { createTranslator } from './world.js';

// g:/global en (root)
// ├── g:/emea en           link, rollout; linked
// │   ├── g:/fr fr         rollout, translate; none
// │   │   └── g:/fr-be fr-BE  link, rollout; linked
// │   └── g:/en-gb en-GB   link, rollout; linked
// └── g:/amer en           link, rollout; linked
//     └── r:/shop en-US    link, rollout; linked (cross-site)
const CONFIGS = {
  g: [
    { path: '/global', language: 'en' },
    {
      path: '/emea', language: 'en', source: '/global', actions: 'link, rollout', missingPages: 'linked', conflictBehavior: 'merge, overwrite',
    },
    {
      path: '/fr', language: 'fr', source: '/emea', actions: 'rollout, translate', missingPages: 'none',
    },
    {
      path: '/fr-be', language: 'fr-BE', source: '/fr', actions: 'link, rollout', missingPages: 'linked',
    },
    {
      path: '/en-gb', language: 'en-GB', source: '/emea', actions: 'link, rollout', missingPages: 'linked',
    },
    {
      path: '/amer', language: 'en', source: '/global', actions: 'link, rollout', missingPages: 'linked',
    },
  ],
  r: [
    {
      path: '/shop', language: 'en-US', source: 'g:/amer', actions: 'link, rollout', missingPages: 'linked',
    },
  ],
};

const file = (id, version) => ({ id, version });
const base = (sourceId, sourceVersion, targetVersion = 'v0') => ({
  sourceId, sourceVersion, via: 'rollout', targetVersion,
});
const states = (run) => Object.fromEntries(run.items.map((item) => [item.key, item.state]));
const world = (options) => createWorld({
  configs: CONFIGS,
  translator: createTranslator(),
  ...options,
});

// global/x changed (v2); emea and en-gb hold local copies based on v1; fr-be is a local copy too.
const staleChain = () => ({
  pages: {
    'g:/global/x': file('G', 'v2'),
    'g:/emea/x': file('E', 'e1'),
    'g:/en-gb/x': file('B', 'b1'),
  },
  indexes: {
    'g:/emea': { pages: { E: { base: base('G', 'v1', 'e1') } }, pending: {} },
    'g:/en-gb': { pages: { B: { base: base('E', 'e0', 'b1') } }, pending: {} },
  },
});

describe('runs: propagate', () => {
  it('rolls out top-down, skipping inherited pages and waiting on translations', async () => {
    const { localization, calls } = world(staleChain());
    const run = await localization.propagate({ pages: [{ site: 'g', path: '/global/x' }] });
    assert.deepEqual(states(run), {
      'g:/emea/x': 'done',
      'g:/amer/x': 'inherited',
      'g:/fr/x': 'translating',
      'g:/en-gb/x': 'done',
      'r:/shop/x': 'inherited',
      'g:/fr-be/x': 'blocked',
    });
    assert.deepEqual(calls.merge, ['g:/global/x>g:/emea/x', 'g:/emea/x>g:/en-gb/x']);
    assert.equal(run.items.find((item) => item.key === 'g:/fr/x').action, 'translate');
    assert.deepEqual(run.items.find((item) => item.key === 'g:/fr-be/x').reasons, ['parent:translating']);
    assert.deepEqual(run.summary, {
      total: 6, done: 2, inherited: 2, translating: 1, blocked: 1,
    });
  });

  it('uses the chosen option', async () => {
    const { localization, calls } = world(staleChain());
    await localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/emea'], option: 'overwrite',
    });
    assert.deepEqual(calls.overwrite, ['g:/global/x>g:/emea/x']);
  });

  it('marks up-to-date copies and keeps going below them', async () => {
    const { localization, calls } = world({
      pages: { 'g:/global/x': file('G', 'v1'), 'g:/emea/x': file('E', 'e1'), 'g:/en-gb/x': file('B', 'b1') },
      indexes: {
        'g:/emea': { pages: { E: { base: base('G', 'v1', 'e1') } }, pending: {} },
        'g:/en-gb': { pages: { B: { base: base('E', 'e0', 'b1') } }, pending: {} },
      },
    });
    const run = await localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/en-gb'],
    });
    assert.deepEqual(states(run), { 'g:/emea/x': 'up to date', 'g:/en-gb/x': 'done' });
    assert.deepEqual(calls.merge, ['g:/emea/x>g:/en-gb/x']);
  });

  it('blocks the subtree below a merge that needs review', async () => {
    const { localization } = world({ ...staleChain(), reviewAfterMerge: ['g:/emea/x'] });
    const run = await localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/en-gb'],
    });
    assert.deepEqual(states(run), { 'g:/emea/x': 'needs review', 'g:/en-gb/x': 'blocked' });
  });

  it('blocks below unlinked pages', async () => {
    const chain = staleChain();
    chain.indexes['g:/emea'].pages.E.overrides = { unlinked: true };
    const { localization } = world(chain);
    const run = await localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/en-gb'],
    });
    assert.deepEqual(states(run), { 'g:/emea/x': 'skipped', 'g:/en-gb/x': 'blocked' });
    assert.deepEqual(run.items[0].reasons, ['unlinked']);
  });

  it('records failures, blocks below them, and retries failed and blocked items', async () => {
    const options = { ...staleChain(), failCopy: ['g:/emea/x'] };
    const failing = world(options);
    const run = await failing.localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/en-gb'],
    });
    assert.deepEqual(states(run), { 'g:/emea/x': 'failed', 'g:/en-gb/x': 'blocked' });
    assert.equal(run.items[0].error, 'boom');

    options.failCopy.length = 0;
    const retried = await failing.localization.retryRun(run);
    assert.deepEqual(states(retried), { 'g:/emea/x': 'done', 'g:/en-gb/x': 'done' });
  });

  it('reports progress after each item', async () => {
    const { localization } = world(staleChain());
    const seen = [];
    await localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }],
      targets: ['g:/en-gb'],
      onProgress: (run) => seen.push(states(run)),
    });
    assert.ok(seen.length >= 2);
    assert.equal(seen.at(-1)['g:/en-gb/x'], 'done');
  });

  it('retries below a needs-review parent once the review is resolved', async () => {
    const state = world({ ...staleChain(), reviewAfterMerge: ['g:/emea/x'] });
    const run = await state.localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/en-gb'],
    });
    assert.deepEqual(states(run), { 'g:/emea/x': 'needs review', 'g:/en-gb/x': 'blocked' });
    state.needsReview.delete('g:/emea/x');
    const retried = await state.localization.retryRun(run);
    assert.deepEqual(states(retried), { 'g:/emea/x': 'up to date', 'g:/en-gb/x': 'done' });
  });

  it('keeps going and records the error when the run store fails', async () => {
    const failing = { save: async () => { throw new Error('store down'); } };
    const { localization } = world({ ...staleChain(), runs: failing });
    const run = await localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/emea'],
    });
    assert.equal(run.items[0].state, 'done');
    assert.equal(run.saveError, 'store down');
  });

  it('creates missing pages in none locations with rollout when translate is not allowed', async () => {
    const configs = structuredClone(CONFIGS);
    configs.g.find((row) => row.path === '/fr').actions = 'rollout';
    const { localization, files } = createWorld({ configs, pages: { 'g:/global/x': file('G', 'v1') } });
    const run = await localization.propagate({
      pages: [{ site: 'g', path: '/global/x' }], targets: ['g:/fr'],
    });
    assert.deepEqual(states(run), { 'g:/emea/x': 'inherited', 'g:/fr/x': 'done' });
    assert.ok(files.has('g:/fr/x'));
  });
});
