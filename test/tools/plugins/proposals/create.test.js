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
import { targetRows, buildPrompt, sendToChat } from '../../../../tools/plugins/proposals/create.js';
import createMockLocalization from '../../../../tools/apps/msm-next/data/mock/mock-localization.js';
import { MOCK_SITE } from '../../../../tools/apps/msm-next/data/mock/fixture.js';
import { togglePick } from '../../../../tools/plugins/msm-next/model.js';

describe('targetRows', () => {
  it('lists the target locations of a source page, nested ones deeper', async () => {
    const model = await createMockLocalization().orgModel();
    const rows = targetRows(model, MOCK_SITE, '/global/index.html');
    assert.ok(rows.length > 1);
    assert.equal(rows[0].depth, 0);
    assert.equal(rows[0].parentId, null);
    assert.ok(rows.some((row) => row.depth > 0 && row.parentId));
    assert.ok(rows.every((row) => row.path && row.label && row.language));
    assert.ok(rows.every((row) => row.path !== '/global/index.html'));
  });

  it('is empty for a page that has no targets', async () => {
    const model = await createMockLocalization().orgModel();
    assert.deepEqual(targetRows(model, 'unknown-site', '/x.html'), []);
  });

  it('works with togglePick: ticking a child ticks its parents', async () => {
    const model = await createMockLocalization().orgModel();
    const rows = targetRows(model, MOCK_SITE, '/global/index.html');
    const child = rows.find((row) => row.parentId);
    const picked = togglePick(rows, new Set(), child.id, true);
    assert.equal(picked.has(child.parentId), true);
  });
});

describe('buildPrompt', () => {
  it('names the page and every target with its language and path', () => {
    const text = buildPrompt({
      source: '/index-ready',
      targets: [
        { label: 'Canada (English)', language: 'en-CA', path: '/en-ca/index-ready.html' },
        { label: 'Canada (French)', language: 'fr-CA', path: '/fr-ca/index-ready.html' },
      ],
    });
    assert.match(text, /^Create a content proposal for the latest changes on \/index-ready\.html\./);
    assert.match(text, /- Canada \(English\) \(en-CA\): \/en-ca\/index-ready\.html/);
    assert.match(text, /- Canada \(French\) \(fr-CA\): \/fr-ca\/index-ready\.html/);
    assert.match(text, /Do not write to the target pages\./);
  });
});

describe('sendToChat', () => {
  it('sets the chat prompt and sends it', async () => {
    const calls = [];
    const result = await sendToChat({ setPrompt: (...args) => calls.push(args) }, 'hello');
    assert.equal(result, 'sent');
    assert.deepEqual(calls, [['hello', { autoSend: true }]]);
  });

  it('only fills the prompt when asked not to send', async () => {
    const calls = [];
    const result = await sendToChat({ setPrompt: (...args) => calls.push(args) }, 'hello', { autoSend: false });
    assert.equal(result, 'filled');
    assert.deepEqual(calls, [['hello', { autoSend: false }]]);
  });

  it('copies to the clipboard when the host has no chat prompt', async () => {
    const copied = [];
    const result = await sendToChat({}, 'hello', { clipboard: { writeText: async (text) => copied.push(text) } });
    assert.equal(result, 'copied');
    assert.deepEqual(copied, ['hello']);
  });

  it('reports when nothing is available', async () => {
    assert.equal(await sendToChat({}, 'hello', { clipboard: {} }), 'unsupported');
  });
});
