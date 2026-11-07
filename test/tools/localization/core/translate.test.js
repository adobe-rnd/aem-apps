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
