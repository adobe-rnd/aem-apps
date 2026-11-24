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
  adminUrl, aemApiUrl, isAemApiUrl, isHlx6, pingHlx6,
} from '../../../tools/shared/hlx6.js';
import * as shared from '../../../tools/shared/hlx6.js';

function pingFetch(headers = {}, status = 200) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return new Response(null, { status, headers });
  };
  return { fetchFn, calls };
}

// Answers the pings in order, the last answer for every later one.
function pingSequence(...answers) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const { status = 200, headers = {} } = answers[Math.min(calls.length, answers.length) - 1];
    return new Response(null, { status, headers });
  };
  return { fetchFn, calls };
}

const HLX6 = { 'x-api-upgrade-available': 'true' };

// isHlx6 remembers each site's answer, so every test uses its own site name.
describe('isHlx6', () => {
  it('is true when the admin ping announces the api upgrade', async () => {
    const { fetchFn, calls } = pingFetch(HLX6);
    assert.equal(await isHlx6('org', 'upgraded', fetchFn), true);
    assert.deepEqual(calls, ['https://admin.hlx.page/ping/org/upgraded']);
  });

  it('is false for legacy sites', async () => {
    const { fetchFn } = pingFetch();
    assert.equal(await isHlx6('org', 'legacy', fetchFn), false);
  });

  it('is false for a 404 without the header', async () => {
    const { fetchFn } = pingFetch({}, 404);
    assert.equal(await isHlx6('org', 'unknown-site', fetchFn), false);
  });

  it('pings each site once', async () => {
    const { fetchFn, calls } = pingFetch(HLX6);
    await Promise.all([isHlx6('org', 'once', fetchFn), isHlx6('org', 'once', fetchFn)]);
    assert.equal(await isHlx6('org', 'once', fetchFn), true);
    assert.deepEqual(calls, ['https://admin.hlx.page/ping/org/once']);
  });

  it('rejects when the ping fails and pings again on the next call', async () => {
    await assert.rejects(isHlx6('org', 'flaky', async () => { throw new TypeError('network'); }), /Try again/);
    const { fetchFn } = pingFetch(HLX6);
    assert.equal(await isHlx6('org', 'flaky', fetchFn), true);
  });

  it('rejects a 401 without caching it', async () => {
    await assert.rejects(isHlx6('org', 'http-401', pingFetch({}, 401).fetchFn), /401/);
    assert.equal(await isHlx6('org', 'http-401', pingFetch(HLX6).fetchFn), true);
  });

  it('rejects a 403 without caching it', async () => {
    await assert.rejects(isHlx6('org', 'http-403', pingFetch({}, 403).fetchFn), /403/);
    assert.equal(await isHlx6('org', 'http-403', pingFetch(HLX6).fetchFn), true);
  });

  it('rejects a 500 without caching it', async () => {
    await assert.rejects(isHlx6('org', 'http-500', pingFetch({}, 500).fetchFn), /500/);
    assert.equal(await isHlx6('org', 'http-500', pingFetch(HLX6).fetchFn), true);
  });

  it('retries a 503 and returns the later answer, honoring Retry-After', async () => {
    const { fetchFn, calls } = pingSequence({ status: 503, headers: { 'retry-after': '0' } }, { headers: HLX6 });
    assert.equal(await isHlx6('org', 'busy', fetchFn), true);
    assert.equal(calls.length, 2);
  });

  it('gives up on a 429 after two retries', async () => {
    const { fetchFn, calls } = pingSequence({ status: 429, headers: { 'retry-after': '0' } });
    await assert.rejects(isHlx6('org', 'limited', fetchFn), /429/);
    assert.equal(calls.length, 3);
  });

  it('gives up on a ping that does not answer', async (test) => {
    test.mock.timers.enable({ apis: ['setTimeout'] });
    const stalled = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const answer = isHlx6('org', 'stalled', stalled);
    await new Promise((resolve) => { setImmediate(resolve); });
    test.mock.timers.tick(10000);
    await assert.rejects(answer, /Try again/);
  });
});

describe('pingHlx6', () => {
  it('reads the header on any answer and throws on an HTTP error without it', async () => {
    assert.equal(await pingHlx6('org', 'site', pingFetch(HLX6, 503).fetchFn), true);
    assert.equal(await pingHlx6('org', 'site', pingFetch({}, 404).fetchFn), false);
    await assert.rejects(pingHlx6('org', 'site', pingFetch({}, 503).fetchFn), /503/);
  });
});

// usesSourceBus remembers each site's answer too, so every test uses its own site name.
describe('usesSourceBus', () => {
  function sidekick(...configs) {
    const calls = [];
    const fetchSiteConfig = async (org, site) => {
      calls.push(`${org}/${site}`);
      return configs[Math.min(calls.length, configs.length) - 1];
    };
    return { fetchSiteConfig, calls };
  }

  it('is false for a site the ping does not flag, without reading its config', async (test) => {
    test.mock.method(global, 'fetch', pingFetch().fetchFn);
    const { fetchSiteConfig, calls } = sidekick({ contentSourceType: 'sourcebus' });
    assert.equal(await shared.usesSourceBus('org', 'sb-legacy', fetchSiteConfig), false);
    assert.deepEqual(calls, []);
  });

  it('is true for source type sourcebus without a URL, and reads the config once', async (test) => {
    test.mock.method(global, 'fetch', pingFetch(HLX6).fetchFn);
    const { fetchSiteConfig, calls } = sidekick({ contentSourceType: 'sourcebus' });
    assert.equal(await shared.usesSourceBus('org', 'sb-type', fetchSiteConfig), true);
    assert.equal(await shared.usesSourceBus('org', 'sb-type', fetchSiteConfig), true);
    assert.deepEqual(calls, ['org/sb-type']);
  });

  it('is true for source type sourcebus even with a DA-shaped URL', async (test) => {
    test.mock.method(global, 'fetch', pingFetch(HLX6).fetchFn);
    const { fetchSiteConfig } = sidekick({ contentSourceType: 'sourcebus', contentSourceUrl: 'https://content.da.live/org/sb-both/' });
    assert.equal(await shared.usesSourceBus('org', 'sb-both', fetchSiteConfig), true);
  });

  it('is true for a source URL on the API host', async (test) => {
    test.mock.method(global, 'fetch', pingFetch(HLX6).fetchFn);
    const { fetchSiteConfig } = sidekick({ contentSourceType: 'markup', contentSourceUrl: 'https://api.aem.live/org/sites/sb-url/source' });
    assert.equal(await shared.usesSourceBus('org', 'sb-url', fetchSiteConfig), true);
  });

  it('is false for a legacy DA site that only has a source-bus overlay', async (test) => {
    // The admin ping flags this site too.
    test.mock.method(global, 'fetch', pingFetch(HLX6).fetchFn);
    const { fetchSiteConfig } = sidekick({ contentSourceType: 'markup', contentSourceUrl: 'https://content.da.live/org/sb-overlay/' });
    assert.equal(await shared.usesSourceBus('org', 'sb-overlay', fetchSiteConfig), false);
  });

  it('is unknown when the config names no source, and asks again next time', async (test) => {
    test.mock.method(global, 'fetch', pingFetch(HLX6).fetchFn);
    const { fetchSiteConfig, calls } = sidekick(null, {}, { contentSourceType: 'sourcebus' });
    assert.equal(await shared.usesSourceBus('org', 'sb-unknown', fetchSiteConfig), null);
    assert.equal(await shared.usesSourceBus('org', 'sb-unknown', fetchSiteConfig), null);
    assert.equal(await shared.usesSourceBus('org', 'sb-unknown', fetchSiteConfig), true);
    assert.equal(calls.length, 3);
  });

  it('is unknown when the ping fails', async (test) => {
    test.mock.method(global, 'fetch', pingFetch({}, 500).fetchFn);
    const { fetchSiteConfig, calls } = sidekick({ contentSourceType: 'sourcebus' });
    assert.equal(await shared.usesSourceBus('org', 'sb-ping-down', fetchSiteConfig), null);
    assert.deepEqual(calls, []);
  });
});

// pacedAemApiFetch shares one pace for the page, so these tests wait for real.
describe('pacedAemApiFetch', () => {
  function recorder(answer = () => new Response(null, { status: 201 })) {
    const starts = [];
    const fetchFn = async (url, opts) => {
      starts.push(Date.now());
      return answer(url, opts, starts.length);
    };
    return { fetchFn, starts };
  }

  it('starts at most one request every 125 ms, also after an idle period', async () => {
    const { fetchFn, starts } = recorder();
    await Promise.all(Array.from({ length: 6 }, () => shared.pacedAemApiFetch(fetchFn, 'u', {})));
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    await Promise.all(Array.from({ length: 6 }, () => shared.pacedAemApiFetch(fetchFn, 'u', {})));
    const gaps = starts.slice(1).map((start, index) => start - starts[index]);
    assert.equal(starts.length, 12);
    assert.ok(gaps.every((gap) => gap >= 120), `gaps ${gaps}`);
  });

  it('retries a 429 or a network error and pauses everything queued for Retry-After', async () => {
    const { fetchFn, starts } = recorder((url, opts, count) => {
      if (count === 1) return new Response(null, { status: 429, headers: { 'retry-after': '1' } });
      if (count === 2) throw new TypeError('Failed to fetch');
      return new Response(null, { status: 201 });
    });
    const answers = await Promise.all([
      shared.pacedAemApiFetch(fetchFn, 'a', {}),
      shared.pacedAemApiFetch(fetchFn, 'b', {}),
    ]);
    assert.deepEqual(answers.map((resp) => resp.status), [201, 201]);
    assert.equal(starts.length, 4);
    // The 429 asked for 1 s; the queued request waited for it too.
    assert.ok(starts[2] - starts[0] >= 950, `waited ${starts[2] - starts[0]} ms`);
  });

  it('returns the last answer once the retries are used up', async () => {
    const { fetchFn, starts } = recorder(() => new Response(null, { status: 503, headers: { 'retry-after': '0' } }));
    assert.equal((await shared.pacedAemApiFetch(fetchFn, 'u', {})).status, 503);
    assert.equal(starts.length, 4);
  });

  it('retries the 500 daFetch makes up for a network error, not a 500 from the server', async () => {
    // daFetch answers a failed fetch (e.g. a 429 without CORS headers) with
    // new Response(null, { status: 500, statusText }), type 'default'.
    const made = recorder((url, opts, count) => (count === 1
      ? new Response(null, { status: 500, statusText: 'Failed to fetch' })
      : new Response(null, { status: 201 })));
    assert.equal((await shared.pacedAemApiFetch(made.fetchFn, 'u', {})).status, 201);
    assert.equal(made.starts.length, 2);

    const server = recorder(() => ({ status: 500, ok: false, type: 'cors' }));
    assert.equal((await shared.pacedAemApiFetch(server.fetchFn, 'u', {})).status, 500);
    assert.equal(server.starts.length, 1);
  });

  it('keeps requests apart when the timers fire late, as in a background tab', async (test) => {
    test.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() + 60000 });
    const { fetchFn, starts } = recorder();
    const flush = () => new Promise((resolve) => { setImmediate(resolve); });
    const sent = Promise.all([1, 2, 3].map(() => shared.pacedAemApiFetch(fetchFn, 'u', {})));
    await flush();
    assert.equal(starts.length, 1);
    // A throttled tab runs both waiting timers together, a second late.
    test.mock.timers.tick(1000);
    await flush();
    assert.equal(starts.length, 2);
    test.mock.timers.tick(125);
    await flush();
    await sent;
    assert.deepEqual(starts.slice(1).map((start, index) => start - starts[index]), [1000, 125]);
  });
});

describe('adminUrl', () => {
  const page = { org: 'org', site: 'site', path: '/drafts/x' };

  it('keeps admin.hlx.page with the ref for legacy sites', () => {
    assert.equal(adminUrl('preview', page, false), 'https://admin.hlx.page/preview/org/site/main/drafts/x');
    assert.equal(adminUrl('live', { ...page, ref: 'release-42' }, false), 'https://admin.hlx.page/live/org/site/release-42/drafts/x');
  });

  it('uses api.aem.live without a ref for Helix 6 sites', () => {
    assert.equal(adminUrl('preview', page, true), 'https://api.aem.live/org/sites/site/preview/drafts/x');
    assert.equal(adminUrl('live', { ...page, ref: 'release-42' }, true), 'https://api.aem.live/org/sites/site/live/drafts/x');
  });

  it('builds the bulk endpoints', () => {
    // admin.hlx.page takes bulk paths at /*; api.aem.live at the resource root.
    assert.equal(adminUrl('live', { ...page, path: '/*' }, false), 'https://admin.hlx.page/live/org/site/main/*');
    assert.equal(adminUrl('live', { ...page, path: '/' }, true), 'https://api.aem.live/org/sites/site/live/');
  });

  it('adds a leading slash', () => {
    assert.equal(adminUrl('preview', { ...page, path: 'drafts/x' }, true), 'https://api.aem.live/org/sites/site/preview/drafts/x');
    assert.equal(adminUrl('preview', { ...page, path: 'drafts/x' }, false), 'https://admin.hlx.page/preview/org/site/main/drafts/x');
  });
});

describe('isAemApiUrl', () => {
  it('recognizes api.aem.live links only', () => {
    assert.equal(isAemApiUrl('https://api.aem.live/org/sites/site/jobs/live-publish/job-1'), true);
    assert.equal(isAemApiUrl('https://admin.hlx.page/job/org/site/main/publish/job-1'), false);
    assert.equal(isAemApiUrl('https://api.aem.live.example.com/x'), false);
    assert.equal(isAemApiUrl('not a url'), false);
  });
});

describe('aemApiUrl', () => {
  it('builds the URL of a site resource on api.aem.live', () => {
    assert.equal(aemApiUrl('org', 'site', 'source/drafts/x.html'), 'https://api.aem.live/org/sites/site/source/drafts/x.html');
    assert.equal(aemApiUrl('org', 'site', 'config/editor/da.json'), 'https://api.aem.live/org/sites/site/config/editor/da.json');
  });
});
