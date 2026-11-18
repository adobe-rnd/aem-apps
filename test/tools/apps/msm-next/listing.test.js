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
import { parseConfig } from '../../../../tools/localization/core/domain/config.js';
import { listLocationPages, isDotPath, isDraftsPath } from '../../../../tools/apps/msm-next/data/listing.js';
import createPool from '../../../../tools/apps/msm-next/data/pool.js';

const model = parseConfig({
  sites: {
    brand: [
      { path: '/en', language: 'en' },
      {
        path: '/en/ca', language: 'en-CA', source: '/en', actions: 'rollout',
      },
    ],
  },
});

const FOLDERS = {
  '/en': [
    { path: '/en/index.html', isFolder: false },
    { path: '/en/data.json', isFolder: false },
    { path: '/en/logo.png', isFolder: false },
    { path: '/en/.trash', isFolder: true },
    { path: '/en/ca', isFolder: true },
    { path: '/en/games', isFolder: true },
  ],
  '/en/games': [{ path: '/en/games/a.html', isFolder: false }],
};

describe('listLocationPages', () => {
  it('lists pages recursively, skipping dot folders and nested locations', async () => {
    const calls = [];
    const list = async (site, folder) => {
      calls.push(`${site}${folder}`);
      return FOLDERS[folder] ?? [];
    };
    const pages = await listLocationPages({ list, model, location: model.locations.get('brand:/en') });
    assert.deepEqual(pages, ['/en/data.json', '/en/games/a.html', '/en/index.html']);
    assert.deepEqual(calls.sort(), ['brand/en', 'brand/en/games']);
  });

  it('skips the root drafts folder and everything below it', async () => {
    const root = parseConfig({ sites: { brand: [{ path: '/', language: 'en' }] } });
    const tree = {
      '/': [
        { path: '/index.html', isFolder: false },
        { path: '/drafts', isFolder: true },
        { path: '/blog', isFolder: true },
      ],
      '/blog': [{ path: '/blog/drafts', isFolder: true }, { path: '/blog/a.html', isFolder: false }],
      '/blog/drafts': [{ path: '/blog/drafts/b.html', isFolder: false }],
      '/drafts': [{ path: '/drafts/x.html', isFolder: false }],
    };
    const list = async (site, folder) => tree[folder] ?? [];
    const pages = await listLocationPages({ list, model: root, location: root.locations.get('brand:/') });
    assert.deepEqual(pages, ['/blog/a.html', '/blog/drafts/b.html', '/index.html']);
  });

  it('detects drafts paths', () => {
    assert.equal(isDraftsPath('/drafts'), true);
    assert.equal(isDraftsPath('/drafts/a/b.html'), true);
    assert.equal(isDraftsPath('/draftsy'), false);
    assert.equal(isDraftsPath('/blog/drafts'), false);
  });

  it('detects dot paths', () => {
    assert.equal(isDotPath('/.da/x.json'), true);
    assert.equal(isDotPath('/en/x.html'), false);
  });
});

describe('createPool', () => {
  it('limits concurrency and keeps results', async () => {
    const pool = createPool(2);
    let active = 0;
    let peak = 0;
    const task = (value) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      active -= 1;
      return value;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((value) => pool.run(task(value))));
    assert.deepEqual(results, [1, 2, 3, 4, 5]);
    assert.equal(peak, 2);
  });

  it('propagates failures without stalling', async () => {
    const pool = createPool(1);
    const failed = pool.run(async () => { throw new Error('boom'); });
    await assert.rejects(failed, /boom/);
    assert.equal(await pool.run(async () => 'next'), 'next');
  });
});
