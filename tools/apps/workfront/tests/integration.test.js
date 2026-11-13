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
/* eslint-disable no-restricted-syntax, no-await-in-loop -- Test each case sequentially. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import loadConfig from '../config.js';
import { normalizeContext, putBriefInChat } from '../host.js';

const configResponse = (rows, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ data: { data: rows } }),
});

test('DA site settings use dotted data-sheet keys and authenticated uncached fetch', async () => {
  const calls = [];
  const config = await loadConfig('northstar/website', async (url, options) => {
    calls.push({ url, options });
    return configResponse([
      { key: 'unrelated.setting', value: 'ignored' },
      { key: 'workfront.origin', value: ' https://northstar.my.workfront.com ' },
      { key: 'workfront.origin.proxy', value: ' https://proxy.example ' },
    ]);
  });
  assert.deepEqual(config, {
    workfrontOrigin: 'https://northstar.my.workfront.com',
    proxyOrigin: 'https://proxy.example',
  });
  assert.deepEqual(calls, [{
    url: 'https://admin.da.live/config/northstar/website/',
    options: { cache: 'no-store' },
  }]);
});

test('missing or blank site proxy selects direct mode without reading org settings', async () => {
  for (const proxyRows of [[], [{ key: 'workfront.origin.proxy', value: ' ' }]]) {
    let reads = 0;
    const config = await loadConfig('northstar/website', async () => {
      reads += 1;
      return configResponse([
        { key: 'workfront.origin', value: 'https://northstar.my.workfront.com' },
        ...proxyRows,
      ]);
    });
    assert.equal(config.proxyOrigin, '');
    assert.equal(reads, 1);
  }
});

test('DA org settings are used only when site Workfront settings are absent', async () => {
  const urls = [];
  const config = await loadConfig('northstar/website', async (url) => {
    urls.push(url);
    return configResponse(urls.length === 1 ? [{ key: 'editor.setting', value: 'true' }] : [
      { Key: 'workfront.origin', Value: 'https://northstar.my.workfront.com' },
      { Key: 'workfront.origin.proxy', Value: 'https://proxy.example' },
    ]);
  });
  assert.equal(config.proxyOrigin, 'https://proxy.example');
  assert.deepEqual(urls, [
    'https://admin.da.live/config/northstar/website/',
    'https://admin.da.live/config/northstar/',
  ]);
});

test('a missing DA site config falls back to org and supports a single-sheet response', async () => {
  let reads = 0;
  const config = await loadConfig('northstar/website', async () => {
    reads += 1;
    if (reads === 1) return configResponse([], 404);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ key: 'workfront.origin', value: 'https://northstar.my.workfront.com' }] }),
    };
  });
  assert.equal(config.workfrontOrigin, 'https://northstar.my.workfront.com');
  assert.equal(config.proxyOrigin, '');
  assert.equal(reads, 2);
});

test('missing Workfront settings fail without a hardcoded tenant or proxy', async () => {
  for (const status of [200, 404]) {
    await assert.rejects(
      loadConfig('northstar/website', async () => configResponse([], status)),
      /Set workfront.origin in the site or organization/,
    );
  }
});

test('partial or invalid site Workfront settings do not fall back to org', async () => {
  for (const rows of [
    [{ key: 'workfront.origin.proxy', value: 'https://proxy.example' }],
    [{ key: 'workfront.origin', value: ' ' }],
    [{ key: 'workfront.origin', value: 123 }],
    [
      { key: 'workfront.origin', value: 'https://northstar.my.workfront.com' },
      { key: 'workfront.origin.proxy', value: false },
    ],
  ]) {
    let reads = 0;
    await assert.rejects(loadConfig('northstar/website', async () => {
      reads += 1;
      return configResponse(rows);
    }), /workfront.origin/);
    assert.equal(reads, 1);
  }
});

test('DA permission, backend and network failures never trigger fallback', async () => {
  for (const status of [401, 403, 429, 500]) {
    let reads = 0;
    await assert.rejects(loadConfig('northstar/website', async () => {
      reads += 1;
      return configResponse([], status);
    }), new RegExp(`HTTP ${status}`));
    assert.equal(reads, 1);
  }
  let reads = 0;
  await assert.rejects(loadConfig('northstar/website', async () => {
    reads += 1;
    throw new Error('Network failed');
  }), /could not be reached/);
  assert.equal(reads, 1);
});

test('malformed DA JSON or data sheets are errors, not absent settings', async () => {
  for (const payload of [null, [], { data: null }, { data: {} }, { data: 'invalid' }, { data: { data: {} } }, { data: { data: [null] } }]) {
    let reads = 0;
    await assert.rejects(loadConfig('northstar/website', async () => {
      reads += 1;
      return { ok: true, status: 200, json: async () => payload };
    }), /invalid/);
    assert.equal(reads, 1);
  }
  await assert.rejects(loadConfig('northstar/website', async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new Error('JSON failed'); },
  })), /invalid configuration JSON/);
});

test('DA config requires host context and authenticated SDK fetch', async () => {
  for (const siteId of ['', 'northstar', 'northstar/website/extra', '/website', null]) {
    await assert.rejects(loadConfig(siteId, () => assert.fail('Unexpected fetch')), /organization and site/);
  }
  await assert.rejects(loadConfig('northstar/website'), /authenticated DA configuration access/);
});

test('static icons use mapped local Spectrum SVGs without an icon runtime', async () => {
  const [html, css, app] = await Promise.all(['workfront.html', 'styles.css', 'app.js']
    .map((name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')));
  const mappings = new Set([...css.matchAll(/\[data-icon="([^"]+)"\]/g)]
    .map((match) => match[1]));
  const icons = [...html.matchAll(/data-icon="([^"]+)"/g)];
  assert.ok(icons.length > 0);
  icons.forEach((match) => assert.ok(mappings.has(match[1]), `Missing icon: ${match[1]}`));
  assert.doesNotMatch(html + app + css, /lucide|createIcons/);
  const sources = [...css.matchAll(/url\('([^']+\.svg)'\)/g)];
  assert.ok(sources.length > 0);
  await Promise.all(sources.map(async (match) => {
    assert.match(match[1], /^\.\/assets\/icons\/S2_Icon_[A-Za-z]+_20_N\.svg$/);
    const svg = await readFile(new URL(`../${match[1]}`, import.meta.url), 'utf8');
    assert.match(svg, /<svg\b/);
    assert.match(svg, /viewBox="0 0 20 20"/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=/i);
  }));
});

test('EW context uses the exact organization, repository and document path', () => {
  const context = normalizeContext({ org: 'northstar', repo: 'website', path: '/collections/fall.html' });
  assert.equal(context.siteId, 'northstar/website');
  assert.equal(context.path, '/collections/fall.html');
  assert.equal(context.url, 'https://da.live/canvas#/northstar/website/collections/fall');
  assert.equal(context.title, 'Fall');
});

test('missing host context is not replaced with a guessed page', () => {
  assert.equal(normalizeContext({}), null);
  assert.equal(normalizeContext({ org: 'northstar', repo: 'website' }).url, '');
});

test('chat uses setPrompt without auto-sending or inserting text into the page', () => {
  const calls = [];
  putBriefInChat({
    showPanel: (name) => calls.push(name),
    setPrompt: (text, options) => calls.push({ text, options }),
    sendText: () => assert.fail('Must not insert into the editor'),
  }, 'A project brief');
  assert.deepEqual(calls, [{ text: 'A project brief', options: { autoSend: false } }, 'chat']);
  assert.throws(() => putBriefInChat({}, 'A brief'), /unavailable/);
});
