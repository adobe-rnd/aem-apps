import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import fixture, { context, pending, singleStep } from './fixture-client.js';

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
    assert.deepEqual(advanced.advanced, [{ path: context.path, step: 2 }]);
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
