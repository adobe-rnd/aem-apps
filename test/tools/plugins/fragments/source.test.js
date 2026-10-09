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
import {
  isHlx6, createLister, crawlHtml, discoverFragmentRoots,
} from '../../../../tools/plugins/fragments/source.js';

function fakeResponse({ status = 200, headers = {}, body = [] } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

// Builds a fetch stub from a map of url -> response options; unknown urls 404.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return fakeResponse(routes[url] ?? { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const API = 'https://api.aem.live/acme/sites/web/source';
const DA = 'https://admin.da.live/list/acme/web';

describe('isHlx6', () => {
  it('is true when the ping announces the api upgrade', async () => {
    const fetchFn = fakeFetch({
      'https://admin.hlx.page/ping/acme/web': { headers: { 'x-api-upgrade-available': 'true' } },
    });
    assert.equal(await isHlx6('acme', 'web', fetchFn), true);
  });

  it('is false without the upgrade header', async () => {
    const fetchFn = fakeFetch({ 'https://admin.hlx.page/ping/acme/web': {} });
    assert.equal(await isHlx6('acme', 'web', fetchFn), false);
  });

  it('is false when the ping fails', async () => {
    const fetchFn = async () => { throw new Error('offline'); };
    assert.equal(await isHlx6('acme', 'web', fetchFn), false);
  });
});

describe('createLister (hlx6)', () => {
  it('lists a folder from the source bus as DA-shaped items', async () => {
    const fetchFn = fakeFetch({
      [`${API}/fragments/`]: {
        body: [
          { name: 'contact-us.html', 'content-type': 'text/html', size: 220 },
          { name: 'offers/', 'content-type': 'application/folder' },
          { name: 'logo.svg', 'content-type': 'image/svg+xml' },
          { name: '.hidden.html', 'content-type': 'text/html' },
        ],
      },
    });
    const list = createLister({
      org: 'acme', repo: 'web', token: 't0k', hlx6: true, fetchFn,
    });

    const { ok, items } = await list('/fragments');

    assert.equal(ok, true);
    assert.deepEqual(items, [
      { path: '/acme/web/fragments/contact-us.html', name: 'contact-us', ext: 'html' },
      { path: '/acme/web/fragments/offers', name: 'offers' },
      { path: '/acme/web/fragments/logo.svg', name: 'logo', ext: 'svg' },
    ]);
    assert.equal(fetchFn.calls[0].opts.headers.Authorization, 'Bearer t0k');
  });

  it('lists the site root with a single trailing slash', async () => {
    const fetchFn = fakeFetch({
      [`${API}/`]: { body: [{ name: 'en/', 'content-type': 'application/folder' }] },
    });
    const list = createLister({
      org: 'acme', repo: 'web', token: 't', hlx6: true, fetchFn,
    });

    const { items } = await list('');

    assert.deepEqual(items, [{ path: '/acme/web/en', name: 'en' }]);
  });

  it('reports a missing folder as not ok', async () => {
    const list = createLister({
      org: 'acme', repo: 'web', token: 't', hlx6: true, fetchFn: fakeFetch({}),
    });

    assert.deepEqual(await list('/nope/fragments'), { ok: false, items: [] });
  });
});

describe('createLister (hlx6 rate limit)', () => {
  const noSleep = async () => {};

  it('keeps at most `concurrency` requests in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      inFlight -= 1;
      return fakeResponse({ body: [] });
    };
    const list = createLister({
      org: 'acme', repo: 'web', token: 't', hlx6: true, fetchFn, concurrency: 3, sleep: noSleep,
    });

    await Promise.all(Array.from({ length: 12 }, (_, i) => list(`/f${i}`)));

    assert.equal(maxInFlight, 3);
  });

  it('retries a 429 and returns the later result', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return calls < 3
        ? fakeResponse({ status: 429 })
        : fakeResponse({ body: [{ name: 'a.html', 'content-type': 'text/html' }] });
    };
    const list = createLister({
      org: 'acme', repo: 'web', token: 't', hlx6: true, fetchFn, sleep: noSleep,
    });

    const { ok, items } = await list('/fragments');

    assert.equal(ok, true);
    assert.equal(items.length, 1);
    assert.equal(calls, 3);
  });

  it('retries a network error (a 429 without CORS headers looks like one)', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return fakeResponse({ body: [] });
    };
    const list = createLister({
      org: 'acme', repo: 'web', token: 't', hlx6: true, fetchFn, sleep: noSleep,
    });

    assert.deepEqual(await list('/fragments'), { ok: true, items: [] });
  });

  it('gives up as not ok instead of throwing', async () => {
    const fetchFn = async () => { throw new TypeError('Failed to fetch'); };
    const list = createLister({
      org: 'acme', repo: 'web', token: 't', hlx6: true, fetchFn, sleep: noSleep,
    });

    assert.deepEqual(await list('/fragments'), { ok: false, items: [] });
  });
});

describe('createLister (legacy DA)', () => {
  it('passes admin.da.live list items through unchanged', async () => {
    const daItems = [{ path: '/acme/web/fragments/a.html', name: 'a', ext: 'html' }];
    const fetchFn = fakeFetch({ [`${DA}/fragments`]: { body: daItems } });
    const list = createLister({
      org: 'acme', repo: 'web', token: 't', hlx6: false, fetchFn,
    });

    assert.deepEqual(await list('/fragments'), { ok: true, items: daItems });
  });
});

describe('crawlHtml', () => {
  it('collects html files from all nested folders', async () => {
    const tree = {
      '/fragments': [
        { path: '/acme/web/fragments/a.html', name: 'a', ext: 'html' },
        { path: '/acme/web/fragments/offers', name: 'offers' },
        { path: '/acme/web/fragments/x.svg', name: 'x', ext: 'svg' },
      ],
      '/fragments/offers': [
        { path: '/acme/web/fragments/offers/b.html', name: 'b', ext: 'html' },
      ],
    };
    const list = async (path) => ({ ok: !!tree[path], items: tree[path] ?? [] });

    const files = await crawlHtml(list, 'acme', 'web', '/fragments');

    assert.deepEqual(files.map((f) => f.path).sort(), [
      '/acme/web/fragments/a.html',
      '/acme/web/fragments/offers/b.html',
    ]);
  });
});

describe('discoverFragmentRoots', () => {
  it('finds fragments folders at the root, per locale and per region', async () => {
    const folder = (path) => ({ path: `/acme/web${path}`, name: path.split('/').pop() });
    const tree = {
      '/fragments': [],
      '': [folder('/en'), folder('/drafts'), folder('/blog')],
      '/en': [folder('/en/ca'), folder('/en/fragments')],
      '/en/fragments': [],
      '/en/ca': [folder('/en/ca/fragments')],
      '/en/ca/fragments': [],
      '/blog': [],
      '/drafts': [folder('/drafts/fragments')],
      '/drafts/fragments': [],
    };
    const list = async (path) => ({ ok: path in tree, items: tree[path] ?? [] });

    const roots = await discoverFragmentRoots('acme', 'web', list);

    assert.deepEqual(roots, [
      {
        path: '/fragments', locale: null, depth: 1, label: '/fragments',
      },
      {
        path: '/en/ca/fragments', locale: 'ca', depth: 3, label: '/en/ca/fragments',
      },
      {
        path: '/en/fragments', locale: 'en', depth: 2, label: '/en/fragments',
      },
    ]);
  });
});
