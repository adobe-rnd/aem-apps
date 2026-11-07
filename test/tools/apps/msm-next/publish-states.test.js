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
import createPublishLoader from '../../../../tools/apps/msm-next/data/publish-states.js';

const nodes = (count) => Array.from({ length: count }, (_, i) => ({ site: 's', path: `/p${i}` }));
const later = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const settle = () => new Promise((resolve) => { setTimeout(resolve, 10); });

function fake({ changed = true } = {}) {
  const batches = [];
  const localization = {
    loadPublishState: async (pages) => {
      batches.push(pages.map((page) => page.path));
      return changed;
    },
    invalidatePublishState: (...args) => batches.push(['invalidate', ...args]),
  };
  return { localization, batches };
}

describe('publish loader', () => {
  it('loads in small batches and notifies per batch with changes', async () => {
    const { localization, batches } = fake();
    let changes = 0;
    const onChange = () => { changes += 1; };
    const loader = createPublishLoader({ localization, onChange, batch: 2 });
    loader.request(nodes(5));
    await settle();
    assert.deepEqual(batches, [['/p0', '/p1'], ['/p2', '/p3'], ['/p4']]);
    assert.equal(changes, 3);
  });

  it('does not notify when nothing changed and de-duplicates queued pages', async () => {
    const { localization, batches } = fake({ changed: false });
    let changes = 0;
    const onChange = () => { changes += 1; };
    const loader = createPublishLoader({ localization, onChange, batch: 1 });
    loader.request(nodes(3));
    loader.request(nodes(3));
    await settle();
    assert.deepEqual(batches, [['/p0'], ['/p1'], ['/p2'], ['/p0']]);
    assert.equal(changes, 0);
  });

  it('puts priority pages ahead of the queued backlog', async () => {
    const { localization, batches } = fake();
    const loader = createPublishLoader({ localization, onChange: () => {}, batch: 1 });
    loader.request(nodes(4));
    loader.request([{ site: 's', path: '/vis' }], { priority: true });
    await settle();
    assert.deepEqual(batches.map(([path]) => path), ['/p0', '/vis', '/p1', '/p2', '/p3']);
  });

  it('holds background pages until the tree is idle, visible pages first', async () => {
    const { localization, batches } = fake();
    let idle = false;
    const loader = createPublishLoader({
      localization, batch: 1, idle: () => idle, idleRetry: 5,
    });
    loader.request(nodes(2));
    await later(20);
    assert.deepEqual(batches, []);
    loader.request([{ site: 's', path: '/vis' }], { priority: true });
    await later(5);
    assert.deepEqual(batches, [['/vis']]);
    idle = true;
    await later(30);
    assert.deepEqual(batches, [['/vis'], ['/p0'], ['/p1']]);
  });

  it('promotes a background page that becomes visible', async () => {
    const { localization, batches } = fake();
    const loader = createPublishLoader({
      localization, batch: 1, idle: () => false, idleRetry: 5,
    });
    loader.request(nodes(3));
    loader.request([{ site: 's', path: '/p2' }], { priority: true });
    await later(20);
    assert.deepEqual(batches, [['/p2']]);
    loader.stop();
    loader.stop();
  });

  it('keeps a failing batch from stopping the queue', async () => {
    let calls = 0;
    const localization = {
      loadPublishState: async () => {
        calls += 1;
        if (calls === 1) throw new Error('x');
        return false;
      },
    };
    const loader = createPublishLoader({ localization, batch: 1 });
    loader.request(nodes(2));
    await settle();
    assert.equal(calls, 2);
  });

  it('is inert for localizations without publish loading and after stop', async () => {
    const loader = createPublishLoader({ localization: { publishState: () => 'live' } });
    loader.request(nodes(2));
    loader.invalidate();
    const { localization, batches } = fake();
    const stopped = createPublishLoader({ localization });
    stopped.stop();
    stopped.request(nodes(2));
    await settle();
    assert.deepEqual(batches, []);
  });

  it('invalidates one path or everything', () => {
    const { localization, batches } = fake();
    const loader = createPublishLoader({ localization });
    loader.invalidate([{ site: 's', path: '/a' }]);
    loader.invalidate();
    assert.deepEqual(batches, [['invalidate', 's', '/a'], ['invalidate']]);
  });
});
