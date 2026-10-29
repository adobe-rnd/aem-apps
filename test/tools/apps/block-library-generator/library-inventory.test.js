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
import { getProbeTarget } from '../../../../tools/apps/block-library-generator/jobs.js';
import inspectBlockLibrary from '../../../../tools/apps/block-library-generator/library-inventory.js';

const target = getProbeTarget('prod');
function fixture() {
  const calls = [];
  const index = {
    ':type': 'sheet',
    total: 2,
    limit: 2,
    offset: 0,
    data: [
      { name: 'Cards', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/cards' },
      { name: 'Columns', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/columns' },
    ],
  };
  const states = new Map([['cards', 200], ['columns', 200]]);
  const options = {
    target,
    blockNames: ['cards', 'columns', 'hero'],
    daFetch: async (url, init) => {
      calls.push({ url, method: init.method });
      assert.equal(init.method, 'GET');
      if (url.includes('/config/')) {
        return Response.json({
          library: {
            data: [{
              title: 'Blocks', path: 'https://content.da.live/msagolj/ew/docs/library/blocks.json',
            }],
          },
        });
      }
      if (url.endsWith('blocks.json')) return Response.json(index);
      const name = url.split('/').at(-1).replace('.html', '');
      return new Response(null, { status: states.get(name) || 404 });
    },
  };
  return {
    calls, index, states, options,
  };
}

describe('Read-only existing library inventory', () => {
  it('reports existing examples with exact editor locations and missing blocks without writes', async () => {
    const { options, calls } = fixture();
    const value = await inspectBlockLibrary(options);
    assert.equal(value.blocks.cards.status, 'existing');
    assert.equal(value.blocks.columns.status, 'existing');
    assert.equal(value.blocks.hero.status, 'absent');
    assert.match(value.blocks.cards.editorURL, /da-admin=prod.*#\/msagolj\/ew\/docs\/library\/blocks\/cards$/);
    assert.equal(value.paths.indexPath, '/docs/library/blocks.json');
    assert.equal(calls.length, 5);
    assert.ok(calls.every((call) => call.method === 'GET'));
  });

  it('distinguishes missing registered pages and unregistered existing pages', async () => {
    const { options, states } = fixture();
    states.set('cards', 404);
    states.set('hero', 200);
    const value = await inspectBlockLibrary(options);
    assert.equal(value.blocks.cards.status, 'missing-page');
    assert.equal(value.blocks.hero.status, 'unregistered');
  });

  it('keeps authorization/server failures explicit rather than declaring absence', async () => {
    const { options, states } = fixture();
    states.set('cards', 403);
    states.set('columns', 500);
    const value = await inspectBlockLibrary(options);
    assert.equal(value.blocks.cards.status, 'error');
    assert.match(value.blocks.cards.error, /403/);
    assert.equal(value.blocks.columns.status, 'error');
    assert.match(value.blocks.columns.error, /500/);
  });

  it('rejects partial indexes and unsafe or ambiguous entries without sending foreign requests', async () => {
    const { options, index, calls } = fixture();
    index.total = 3;
    await assert.rejects(inspectBlockLibrary(options), /complete/);
    index.total = 2;
    index.data[0].path = 'https://untrusted.example/cards';
    const value = await inspectBlockLibrary(options);
    assert.equal(value.blocks.cards.status, 'error');
    assert.ok(calls.every((call) => !call.url.includes('untrusted')));
    index.data[0].path = index.data[1].path;
    index.data[1].name = 'Cards';
    const duplicate = await inspectBlockLibrary(options);
    assert.equal(duplicate.blocks.cards.status, 'error');
  });

  it('stops before any request when cancelled or given an invalid block name', async () => {
    const { options, calls } = fixture();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(inspectBlockLibrary({ ...options, signal: controller.signal }), /abort/i);
    await assert.rejects(inspectBlockLibrary({ ...options, blockNames: ['../cards'] }), /name/i);
    await assert.rejects(inspectBlockLibrary({
      ...options, target: { ...target, adminOrigin: 'https://untrusted.example' },
    }), /target/i);
    assert.equal(calls.length, 0);
  });

  it('includes indexed pages missing from a complete code inventory and marks missing code', async () => {
    const { options, index, states } = fixture();
    index.data.push({ name: 'Old Banner', path: 'https://content.da.live/msagolj/ew/docs/library/blocks/old-banner' });
    index.total = 3;
    index.limit = 3;
    states.set('old-banner', 200);
    const value = await inspectBlockLibrary({ ...options, codeComplete: true });
    assert.equal(value.blocks['old-banner'].status, 'existing');
    assert.equal(value.blocks['old-banner'].codeStatus, 'missing');
    assert.equal(value.blocks['old-banner'].displayName, 'Old Banner');
    assert.equal(value.blocks.cards.codeStatus, 'present');
  });

  it('does not claim missing code for library-only entries after incomplete/failed discovery', async () => {
    const { options } = fixture();
    const value = await inspectBlockLibrary({ ...options, blockNames: [], codeComplete: false });
    assert.equal(value.blocks.cards.status, 'existing');
    assert.equal(value.blocks.cards.codeStatus, 'unknown');
    assert.equal(value.blocks.columns.codeStatus, 'unknown');
  });
});
