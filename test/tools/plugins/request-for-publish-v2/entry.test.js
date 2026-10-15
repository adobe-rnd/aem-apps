import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../../../tools/plugins/request-for-publish-v2/request-for-publish.js', import.meta.url), 'utf8');
const makePanelSource = source.slice(source.indexOf('function makePanel('), source.indexOf('export default'));

function loadPanel(overrides = {}) {
  return vm.runInNewContext(`(${makePanelSource.trim()})`, {
    URL,
    document: { createElement: () => ({}) },
    window: { location: new URL('https://apps.example.com/') },
    setImsDetails: () => {},
    workerOrigin: () => 'https://worker.example.com',
    createWorkspaceActions: () => ({ save: async () => {} }),
    createClient: (options) => options,
    ...overrides,
  });
}

it('previews and publishes the page content ref through Admin', async () => {
  const calls = [];
  const makePanel = loadPanel({ daFetch: async (...args) => calls.push(args) });
  const panel = makePanel({ context: {}, token: 'sdk-token', actions: {} });
  const page = {
    org: 'example', site: 'website', path: '/drafts/page.html', ref: 'release-42',
  };
  await panel.client.preview(page);
  await panel.client.publish(page);
  assert.equal(calls.length, 2);
  ['preview', 'live'].forEach((operation, index) => {
    assert.equal(
      new URL(calls[index][0]).searchParams.get('url'),
      `https://admin.hlx.page/${operation}/example/website/release-42/drafts/page.html`,
    );
    assert.equal(calls[index][1].method, 'POST');
  });
});
