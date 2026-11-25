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

  // Before Helix 6 support the apps always used admin.hlx.page and DA, so a
  // ping that fails falls back to that. The fallback isn't kept: the next
  // call pings again.
  it('falls back to legacy when the ping fails and pings again on the next call', async () => {
    assert.equal(await isHlx6('org', 'flaky', async () => { throw new TypeError('network'); }), false);
    const { fetchFn } = pingFetch(HLX6);
    assert.equal(await isHlx6('org', 'flaky', fetchFn), true);
  });

  it('falls back to legacy on a 401 without caching it', async () => {
    assert.equal(await isHlx6('org', 'http-401', pingFetch({}, 401).fetchFn), false);
    assert.equal(await isHlx6('org', 'http-401', pingFetch(HLX6).fetchFn), true);
  });

  it('falls back to legacy on a 403 without caching it', async () => {
    assert.equal(await isHlx6('org', 'http-403', pingFetch({}, 403).fetchFn), false);
    assert.equal(await isHlx6('org', 'http-403', pingFetch(HLX6).fetchFn), true);
  });

  it('falls back to legacy on a 500 without caching it', async () => {
    assert.equal(await isHlx6('org', 'http-500', pingFetch({}, 500).fetchFn), false);
    assert.equal(await isHlx6('org', 'http-500', pingFetch(HLX6).fetchFn), true);
  });

  it('falls back to legacy on a 503 without retrying or caching it', async () => {
    const { fetchFn, calls } = pingSequence({ status: 503, headers: { 'retry-after': '0' } }, { headers: HLX6 });
    assert.equal(await isHlx6('org', 'busy', fetchFn), false);
    assert.equal(calls.length, 1);
    assert.equal(await isHlx6('org', 'busy', fetchFn), true);
  });

  it('falls back to legacy on a 429 without retrying it', async () => {
    const { fetchFn, calls } = pingSequence({ status: 429, headers: { 'retry-after': '0' } });
    assert.equal(await isHlx6('org', 'limited', fetchFn), false);
    assert.equal(calls.length, 1);
  });

  it('falls back to legacy when the ping does not answer', async (test) => {
    test.mock.timers.enable({ apis: ['setTimeout'] });
    const stalled = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const answer = isHlx6('org', 'stalled', stalled);
    await new Promise((resolve) => { setImmediate(resolve); });
    test.mock.timers.tick(10000);
    assert.equal(await answer, false);
  });
});

describe('pingHlx6', () => {
  it('reads the header on any answer and throws on an HTTP error without it', async () => {
    assert.equal(await pingHlx6('org', 'site', pingFetch(HLX6, 503).fetchFn), true);
    assert.equal(await pingHlx6('org', 'site', pingFetch({}, 404).fetchFn), false);
    await assert.rejects(pingHlx6('org', 'site', pingFetch({}, 503).fetchFn), /503/);
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

  it('retries a 429 and pauses everything queued for Retry-After', async () => {
    const { fetchFn, starts } = recorder((url, opts, count) => (count === 1
      ? new Response(null, { status: 429, headers: { 'retry-after': '1' } })
      : new Response(null, { status: 201 })));
    const answers = await Promise.all([
      shared.pacedAemApiFetch(fetchFn, 'a', {}),
      shared.pacedAemApiFetch(fetchFn, 'b', {}),
    ]);
    assert.deepEqual(answers.map((resp) => resp.status), [201, 201]);
    assert.equal(starts.length, 3);
    // The 429 asked for 1 s; the queued request waited for it too.
    assert.ok(starts[1] - starts[0] >= 950, `waited ${starts[1] - starts[0]} ms`);
  });

  it('returns the last answer once the retries are used up', async () => {
    const { fetchFn, starts } = recorder(() => new Response(null, { status: 429, headers: { 'retry-after': '0' } }));
    assert.equal((await shared.pacedAemApiFetch(fetchFn, 'u', {})).status, 429);
    assert.equal(starts.length, 4);
  });

  it('does not retry a 503, which the server may have run', async () => {
    const { fetchFn, starts } = recorder(() => new Response(null, { status: 503, headers: { 'retry-after': '0' } }));
    assert.equal((await shared.pacedAemApiFetch(fetchFn, 'u', {})).status, 503);
    assert.equal(starts.length, 1);
  });

  it('does not retry a network error, which the server may have run, but pauses everything queued', async () => {
    // A 429 without CORS headers looks like a network error. daFetch answers
    // a failed fetch with new Response(null, { status: 500, statusText }),
    // type 'default'; plain fetch throws.
    const { fetchFn, starts } = recorder((url, opts, count) => {
      if (count === 1) throw new TypeError('Failed to fetch');
      if (count === 2) return new Response(null, { status: 500, statusText: 'Failed to fetch' });
      return new Response(null, { status: 201 });
    });
    const [thrown, made, sent] = await Promise.allSettled(['a', 'b', 'c'].map((url) => shared.pacedAemApiFetch(fetchFn, url, {})));
    assert.equal(thrown.status, 'rejected');
    assert.equal(made.value.status, 500);
    assert.equal(sent.value.status, 201);
    assert.equal(starts.length, 3);
    const gaps = starts.slice(1).map((start, index) => start - starts[index]);
    assert.ok(gaps.every((gap) => gap >= 950), `gaps ${gaps}`);
  });

  it('neither retries nor pauses for a 500 from the server', async () => {
    const { fetchFn, starts } = recorder((url, opts, count) => (count === 1
      ? { status: 500, ok: false, type: 'cors' }
      : new Response(null, { status: 201 })));
    const answers = await Promise.all(['a', 'b'].map((url) => shared.pacedAemApiFetch(fetchFn, url, {})));
    assert.deepEqual(answers.map((resp) => resp.status), [500, 201]);
    assert.ok(starts[1] - starts[0] < 500, `waited ${starts[1] - starts[0]} ms`);
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
