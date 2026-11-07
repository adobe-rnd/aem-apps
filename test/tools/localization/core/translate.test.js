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
// └── g:/fr fr       rollout, translate; none; merge, overwrite
//     └── g:/fr-be fr-BE  link, rollout; linked
const CONFIGS = {
  g: [
    { path: '/global', language: 'en' },
    {
      path: '/fr', language: 'fr', source: '/global', actions: 'rollout, translate', conflictBehavior: 'merge, overwrite',
    },
    {
      path: '/fr-be', language: 'fr-BE', source: '/fr', actions: 'link, rollout', missingPages: 'linked',
    },
  ],
};

const file = (id, version) => ({ id, version });

function setup(options = {}) {
  const translator = createTranslator();
  const world = createWorld({
    configs: CONFIGS,
    pages: { 'g:/global/x': file('G', 'v1') },
    translator,
    ...options,
  });
  return { ...world, translator };
}

const target = { site: 'g', path: '/fr/x' };

describe('translate', () => {
  it('sends the source content and marks the page translating', async () => {
    const world = setup();
    const result = await world.localization.execute({ ...target, action: 'translate' });
    assert.equal(result.ok, true);
    assert.deepEqual(world.translator.sent[0].job.src, 'en');
    assert.deepEqual(world.translator.sent[0].job.dests, ['fr']);
    assert.deepEqual(world.translator.sent[0].items, [{
      id: 'item-1', path: '/x', format: 'html', content: '<main>g:/global/x</main>',
    }]);
    const pending = world.index.get('g:/fr').pending['/fr/x'];
    assert.equal(pending.job.state, 'translating');
    assert.ok(world.jobs.has(`g:${pending.job.jobId}`));
    const after = await world.localization.page('g', '/fr/x');
    assert.deepEqual(after.status.sync, ['translating']);
  });

  it('fails without changing the index when the connector refuses', async () => {
    const world = setup();
    world.translator.sendError = { code: 'unsupported-language', message: 'nope' };
    const result = await world.localization.execute({ ...target, action: 'translate' });
    assert.deepEqual(result, { ok: false, error: 'nope', code: 'unsupported-language' });
    assert.equal(world.index.get('g:/fr'), undefined);
  });
});

describe('checkJobs and save', () => {
  it('reports translating, then ready, then saves the translation with the sent base', async () => {
    const world = setup();
    await world.localization.execute({ ...target, action: 'translate' });

    assert.deepEqual(await world.localization.checkJobs([target]), [{ ...target, state: 'translating', progress: { done: 0, total: 1 } }]);

    world.translator.ready = true;
    assert.deepEqual(await world.localization.checkJobs([target]), [{ ...target, state: 'ready', progress: { done: 1, total: 1 } }]);
    const ready = await world.localization.page('g', '/fr/x');
    assert.deepEqual(ready.status.sync, ['ready to save']);
    assert.ok(ready.actions.find((entry) => entry.action === 'save').enabled);

    world.files.set('g:/global/x', file('G', 'v2'));
    const saved = await world.localization.execute({ ...target, action: 'save' });
    assert.equal(saved.ok, true);
    assert.deepEqual(world.calls.content, ['[fr] <main>g:/global/x</main>']);
    const after = await world.localization.page('g', '/fr/x');
    assert.equal(after.status.relationship, 'translation');
    assert.deepEqual(after.status.sync, ['behind source']);
    const entry = Object.values(world.index.get('g:/fr').pages)[0];
    assert.equal(entry.base.via, 'translate');
    assert.equal(entry.base.sourceVersion, 'v1');
    assert.equal(entry.job, undefined);
    assert.deepEqual(world.index.get('g:/fr').pending, {});
  });

  it('clears a failed job so the page can be translated again', async () => {
    const world = setup();
    await world.localization.execute({ ...target, action: 'translate' });
    world.translator.failed = true;
    assert.deepEqual(await world.localization.checkJobs([target]), [{ ...target, state: 'failed', progress: { done: 0, total: 1 } }]);
    const after = await world.localization.page('g', '/fr/x');
    assert.equal(after.status.relationship, 'not created');
    assert.ok(after.actions.find((entry) => entry.action === 'translate').enabled);
  });

  it('skips pages without a job', async () => {
    const world = setup();
    assert.deepEqual(await world.localization.checkJobs([{ site: 'g', path: '/global/x' }]), [{ site: 'g', path: '/global/x', state: 'none' }]);
  });

  it('translates over an existing page and saves into it', async () => {
    const world = setup({ pages: { 'g:/global/x': file('G', 'v1'), 'g:/fr/x': file('F', 'f1') } });
    await world.localization.execute({ ...target, action: 'translate', option: 'merge' });
    assert.equal(world.index.get('g:/fr').pages.F.job.state, 'translating');
    world.translator.ready = true;
    await world.localization.checkJobs([target]);
    const saved = await world.localization.execute({ ...target, action: 'save', option: 'overwrite' });
    assert.equal(saved.ok, true);
    assert.deepEqual(world.calls.overwrite, ['g:/global/x>g:/fr/x']);
  });
});

describe('runs with translation', () => {
  it('translates in a run, then resumes downstream after the vendor finishes', async () => {
    const world = setup();
    const run = await world.localization.propagate({ pages: [{ site: 'g', path: '/global/x' }] });
    assert.deepEqual(run.items.map((item) => [item.key, item.state]), [
      ['g:/fr/x', 'translating'],
      ['g:/fr-be/x', 'blocked'],
    ]);

    const waiting = await world.localization.resumeRun(run);
    assert.equal(waiting.items[0].state, 'translating');

    world.translator.ready = true;
    const resumed = await world.localization.resumeRun(run);
    assert.deepEqual(resumed.items.map((item) => [item.key, item.state]), [
      ['g:/fr/x', 'done'],
      ['g:/fr-be/x', 'inherited'],
    ]);
    assert.equal(resumed.items[0].action, 'save');
  });
});

// g:/global en (root)
// ├── g:/fr fr  rollout, translate
// ├── g:/de de  rollout, translate
// └── h:/en en  (root) -> unrelated
const GROUP_CONFIGS = {
  g: [
    { path: '/global', language: 'en' },
    {
      path: '/fr', language: 'fr', source: '/global', actions: 'rollout, translate',
    },
    {
      path: '/de', language: 'de', source: '/global', actions: 'rollout, translate',
    },
  ],
};

const groupSetup = (options = {}) => setup({
  configs: GROUP_CONFIGS,
  pages: {
    'g:/global/x': file('GX', 'v1'),
    'g:/global/y': file('GY', 'v1'),
    'g:/global/z': file('GZ', 'v1'),
  },
  ...options,
});

const pagesOf = (paths) => paths.map((path) => ({ site: 'g', path }));
const frDe = ['/fr/x', '/fr/y', '/de/x', '/de/y'];

describe('grouped translation', () => {
  it('sends one job for several pages and languages from the same source location', async () => {
    const world = groupSetup();
    const results = await world.localization.translateMany(pagesOf(frDe));
    assert.deepEqual(results.map((result) => result.ok), [true, true, true, true]);
    assert.equal(world.translator.sent.length, 1);
    const [{ job, items }] = world.translator.sent;
    assert.equal(job.src, 'en');
    assert.deepEqual(job.dests, ['fr', 'de']);
    assert.deepEqual(items.map((item) => [item.id, item.path]), [['item-1', '/x'], ['item-2', '/y']]);
    assert.equal(world.jobs.size, 1);
    const jobIds = ['/fr/x', '/fr/y', '/de/x', '/de/y'].map((path) => {
      const location = path.startsWith('/fr') ? 'g:/fr' : 'g:/de';
      return world.index.get(location).pending[path].job.jobId;
    });
    assert.equal(new Set(jobIds).size, 1);
    const after = await world.localization.page('g', '/de/y');
    assert.deepEqual(after.status.sync, ['translating']);
  });

  it('splits into several jobs when the connector batch limits are exceeded', async () => {
    const world = groupSetup();
    world.translator.limits = { maxBatchItems: 1 };
    await world.localization.translateMany(pagesOf(['/fr/x', '/fr/y', '/fr/z']));
    assert.deepEqual(world.translator.sent.map((sent) => sent.items.map((item) => item.path)), [['/x'], ['/y'], ['/z']]);
    assert.equal(world.jobs.size, 3);

    const bytes = groupSetup();
    bytes.translator.limits = { maxBatchBytes: '<main>g:/global/x</main>'.length * 2 };
    await bytes.localization.translateMany(pagesOf(['/fr/x', '/fr/y', '/fr/z']));
    assert.deepEqual(bytes.translator.sent.map((sent) => sent.items.length), [2, 1]);
  });

  it('fails only the pages of a refused job', async () => {
    const world = groupSetup();
    world.translator.limits = { maxBatchItems: 1 };
    const send = world.translator.connectors.call;
    let calls = 0;
    world.translator.connectors.call = async (method, args) => {
      if (method === 'send') {
        calls += 1;
        if (calls === 2) return { jobState: null, error: { code: 'too-large', message: 'big' } };
      }
      return send(method, args);
    };
    const results = await world.localization.translateMany(pagesOf(['/fr/x', '/fr/y']));
    assert.deepEqual(results.map(({ ok, error }) => ({ ok, error })), [{ ok: true, error: undefined }, { ok: false, error: 'big' }]);
    assert.equal(world.index.get('g:/fr').pending['/fr/y'], undefined);
  });

  it('polls a shared job once and fans the status out per page and language', async () => {
    const world = groupSetup();
    await world.localization.translateMany(pagesOf(frDe));
    world.translator.statusCalls = 0;
    assert.deepEqual(await world.localization.checkJobs(pagesOf(frDe)), pagesOf(frDe)
      .map((ref) => ({ ...ref, state: 'translating', progress: { done: 0, total: 1 } })));
    assert.equal(world.translator.statusCalls, 1);

    world.translator.ready = true;
    world.translator.failedLangs = ['de'];
    const checked = await world.localization.checkJobs(pagesOf(frDe));
    assert.deepEqual(checked.map((result) => [result.path, result.state]), [
      ['/fr/x', 'ready'], ['/fr/y', 'ready'], ['/de/x', 'failed'], ['/de/y', 'failed'],
    ]);
    assert.equal(world.index.get('g:/fr').pending['/fr/x'].job.state, 'ready');
    assert.equal(world.index.get('g:/de').pending['/de/x'], undefined);
    const json = JSON.stringify(checked);
    assert.equal(json.includes('jobState'), false);
    assert.equal(json.includes('jobId'), false);
  });

  it('updates pages that were not asked about when the shared job finishes', async () => {
    const world = groupSetup();
    await world.localization.translateMany(pagesOf(['/fr/x', '/fr/y']));
    world.translator.ready = true;
    await world.localization.checkJobs(pagesOf(['/fr/x']));
    assert.equal(world.index.get('g:/fr').pending['/fr/y'].job.state, 'ready');
  });

  it('saves each page from the shared job, paging results once per language', async () => {
    const world = groupSetup();
    world.translator.pageSize = 1;
    await world.localization.translateMany(pagesOf(frDe));
    world.translator.ready = true;
    await world.localization.checkJobs(pagesOf(frDe));
    const saved = await Promise.all(pagesOf(frDe).map((ref) => world.localization
      .execute({ ...ref, action: 'save' })));
    assert.deepEqual(saved.map((result) => result.ok), [true, true, true, true]);
    assert.deepEqual(world.calls.content.sort(), [
      '[de] <main>g:/global/x</main>', '[de] <main>g:/global/y</main>',
      '[fr] <main>g:/global/x</main>', '[fr] <main>g:/global/y</main>',
    ]);
    assert.equal(world.translator.resultCalls.filter((call) => call.lang === 'fr').length, 2);
    const after = await world.localization.page('g', '/de/y');
    assert.equal(after.status.relationship, 'translation');
  });

  it('keeps reading single-page job records saved before grouping', async () => {
    const world = groupSetup();
    world.files.set('g:/fr/x', file('FX', 'f1'));
    world.index.set('g:/fr', {
      pages: { FX: { job: { state: 'translating', jobId: 'old' } } }, pending: {},
    });
    world.jobs.set('g:old', {
      jobState: { n: 9, items: [{ id: 'item-1', content: '<main>old</main>' }], dests: ['fr'] },
      lang: 'fr',
      source: { site: 'g', path: '/global/x' },
      sourceId: 'GX',
      sourceVersion: 'v1',
      target: { site: 'g', path: '/fr/x' },
      option: null,
      sentAt: 'then',
    });
    world.translator.ready = true;
    assert.equal((await world.localization.checkJobs(pagesOf(['/fr/x'])))[0].state, 'ready');
    const saved = await world.localization.execute({
      site: 'g', path: '/fr/x', action: 'save',
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(world.calls.content, ['[fr] <main>old</main>']);
  });
});

describe('runs with grouped translation', () => {
  it('sends one job for all pages translated at the same depth', async () => {
    const world = groupSetup();
    const run = await world.localization.propagate({ pages: pagesOf(['/global/x', '/global/y']) });
    assert.equal(world.translator.sent.length, 1);
    assert.deepEqual(world.translator.sent[0].job.dests.sort(), ['de', 'fr']);
    assert.equal(world.translator.sent[0].items.length, 2);
    assert.deepEqual(run.items.map((item) => item.state), ['translating', 'translating', 'translating', 'translating']);
    world.translator.ready = true;
    const resumed = await world.localization.resumeRun(run);
    assert.deepEqual(resumed.items.map((item) => item.state), ['done', 'done', 'done', 'done']);
  });
});
