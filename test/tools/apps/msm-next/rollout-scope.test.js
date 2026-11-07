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
import { needsRollout, descendantNodes } from '../../../../tools/apps/msm-next/data/rollout-scope.js';

const leaf = { key: 'leaf', children: [] };
const mid = { key: 'mid', children: [leaf] };
const top = { key: 'top', children: [mid] };
const tree = { nodes: new Map([top, mid, leaf].map((node) => [node.key, node])) };

describe('rollout scope', () => {
  it('collects descendants', () => {
    assert.deepEqual(descendantNodes(top, tree).map((node) => node.key), ['mid', 'leaf']);
    assert.deepEqual(descendantNodes(leaf, tree), []);
  });

  it('keeps single leaf pages direct', () => {
    assert.equal(needsRollout(leaf, tree, 'rollout'), false);
    assert.equal(needsRollout(leaf, tree, 'translate'), false);
  });

  it('requires a rollout when downstream pages exist', () => {
    assert.equal(needsRollout(mid, tree, 'rollout'), true);
    assert.equal(needsRollout(top, tree, 'translate'), true);
    assert.equal(needsRollout(mid, tree, 'save'), true);
  });

  it('requires a rollout for several pages', () => {
    assert.equal(needsRollout([leaf, leaf], tree, 'rollout'), true);
    assert.equal(needsRollout([leaf], tree, 'rollout'), false);
    assert.equal(needsRollout([mid], tree, 'rollout'), true);
  });

  it('leaves non-propagating actions and missing pages alone', () => {
    assert.equal(needsRollout(top, tree, 'unlink'), false);
    assert.equal(needsRollout(top, tree, 'reconnect'), false);
    assert.equal(needsRollout(null, tree, 'rollout'), false);
  });
});
