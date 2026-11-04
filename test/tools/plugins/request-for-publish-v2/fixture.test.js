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
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import fixture, { context, pending, singleStep } from './fixture-client.js';
import { normalizeContext, deriveView } from '../../../../tools/plugins/request-for-publish-v2/workflow.js';

const steps = [singleStep[0], { ...singleStep[0], index: 2, title: 'Final review' }];

describe('v2 asset names', () => {
  ['plugins/request-for-publish-v2', 'apps/publish-requests-inbox-v2'].forEach((directory) => {
    const basename = directory.split('/').at(-1);
    it(`uses the ${basename} suffix for HTML, JavaScript, and CSS`, () => {
      const root = new URL(`../../../../tools/${directory}/`, import.meta.url);
      ['html', 'js', 'css'].forEach((extension) => {
        assert.ok(existsSync(new URL(`${basename}.${extension}`, root)), extension);
        assert.equal(existsSync(new URL(`${basename.slice(0, -3)}.${extension}`, root)), false);
      });
      const html = readFileSync(new URL(`${basename}.html`, root), 'utf8');
      assert.ok(html.includes(`/tools/${directory}/${basename}.js`));
    });
  });
});

describe('panel workflow fixture', () => {
  it('recognizes a side-panel submission when opened from Prepare', async () => {
    const { client, calls } = fixture({ role: 'both', steps });
    const panelContext = normalizeContext(context);
    const prepareContext = normalizeContext({ ...context, path: `${context.path}.html` });
    await client.submit(panelContext, 'Review this page');
    const view = deriveView(prepareContext, await client.load(prepareContext));
    assert.equal(view.view, 'approver');
    assert.equal(view.canWithdraw, true);
    assert.equal(view.canApprove, true);
    const result = await client.approve(prepareContext, view.request, { step: 1, final: false });
    assert.deepEqual(result.advanced, [context.path]);
    assert.equal(calls.some((call) => call.route === 'publish'), false);
    assert.deepEqual(
      calls.find((call) => call.route.endsWith('/approve')).body.paths,
      [context.path],
    );
  });

  it('preserves explicit participant eligibility and leaves observer rows raw', async () => {
    const denied = { ...pending, canApproveNow: false, isFinal: false };
    const { client } = fixture({ role: 'both', rows: [denied] });
    const data = await client.load(context);
    [data.own[0], data.approvable[0]].forEach((entry) => {
      assert.equal(entry.canApproveNow, false);
      assert.equal(entry.isFinal, false);
      assert.equal(entry.stepInfo.current, 1);
    });
    assert.deepEqual(data.page, [denied]);
  });

  it('advances then completes with enriched final-step rows and a final approval', async () => {
    const { client, calls } = fixture({ role: 'approver', rows: [pending], steps });
    const first = (await client.load(context)).approvable[0];
    assert.equal(first.canApproveNow, true);
    assert.equal(first.isFinal, false);
    assert.equal(first.stepInfo.current, 1);
    const advanced = await client.approve(context, first, { step: 1, final: false });
    assert.deepEqual(advanced.advanced, [context.path]);
    assert.deepEqual(advanced.completed, []);
    assert.equal(calls.some((call) => call.route === 'publish'), false);

    const last = (await client.load(context)).approvable[0];
    assert.equal(last.canApproveNow, true);
    assert.equal(last.isFinal, true);
    assert.equal(last.stepInfo.current, 2);
    assert.match(last.step, /reviewer@example.com:1:/);
    const completed = await client.approve(context, last, { step: 2, final: true });
    assert.deepEqual(completed.completed, [context.path]);
    assert.deepEqual(completed.advanced, []);
    assert.equal(calls.filter((call) => call.route === 'publish').length, 1);
    assert.deepEqual(calls.filter((call) => call.route.endsWith('/approve')).map((call) => call.body), [
      {
        org: context.org, site: context.site, paths: [context.path], step: 1,
      },
      {
        org: context.org, site: context.site, paths: [context.path], step: 2, final: true,
      },
    ]);
    assert.deepEqual((await client.load(context)).approvable, []);
  });
});
