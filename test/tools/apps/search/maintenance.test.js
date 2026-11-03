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
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  createSearchRegex, createHTMLSearchRegex, getMatchContext,
} from '../../../../tools/apps/search/search-utils.js';

const moduleUrl = new URL('../../../../tools/apps/search/search.js', import.meta.url);
const source = readFileSync(moduleUrl, 'utf8');

function loadFunctions(start, end, names, scope) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'Function extraction markers must exist');
  return vm.runInNewContext(
    `${source.slice(first, last)}\n({${names.join(',')}})`,
    scope,
  );
}

function loadVersionFunctions(fetch, errors = []) {
  return loadFunctions(
    'async function createVersion(',
    'async function bulkRevertLastReplacement(',
    ['revertToPreFindReplaceVersion'],
    {
      app: { token: 'test-token' },
      API: {
        SOURCE: 'https://admin.da.live/source',
        VERSION_CREATE: 'https://admin.da.live/versionsource',
        VERSION_LIST: 'https://admin.da.live/versionlist',
      },
      fetch,
      Blob,
      FormData,
      console: {
        error: (...args) => errors.push(args),
        warn: (...args) => errors.push(args),
      },
    },
  );
}

function versionRequestFixture(backupResponse, saveStatus = 200) {
  const calls = [];
  const errors = [];
  const versions = [
    { url: '/versionsource/older', label: 'Older', timestamp: 100 },
    { url: '/versionsource/autosave', timestamp: 300 },
    { url: '/versionsource/newer', label: 'Newer', timestamp: 200 },
  ];
  const functions = loadVersionFunctions(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith('https://admin.da.live/versionlist/')) return Response.json(versions);
    if (url === 'https://admin.da.live/versionsource/newer') {
      return new Response('<p>Restore target</p>');
    }
    if (url.startsWith('https://admin.da.live/versionsource/')) {
      versions.push({ url: '/versionsource/safety-backup', label: 'Backup', timestamp: 400 });
      return backupResponse();
    }
    assert.ok(url.startsWith('https://admin.da.live/source/'), 'Only expected DA endpoints are used');
    return new Response(null, { status: saveStatus });
  }, errors);
  return { ...functions, calls, errors };
}

[
  ['HTTP 500', () => new Response(null, { status: 500 })],
  ['network error', () => { throw new Error('Offline'); }],
  ['explicit API rejection', () => Response.json({ success: false })],
].forEach(([name, response]) => {
  it(`skips revert without a content write when backup creation fails: ${name}`, async () => {
    const fixture = versionRequestFixture(response);
    const result = await fixture.revertToPreFindReplaceVersion('/example/website/page.html');
    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.equal(fixture.calls.length, 3);
    assert.equal(fixture.calls[1].url, 'https://admin.da.live/versionsource/newer');
    assert.equal(fixture.calls[2].options.method, 'POST');
    assert.equal(JSON.parse(fixture.calls[2].options.body).label, 'Revert(Newer)');
    assert.equal(fixture.errors.length, 1);
    assert.equal(fixture.calls.some(({ url }) => url.startsWith('https://admin.da.live/source/')), false);
  });
});

it('fetches the intended version before creating a backup and only then restores', async () => {
  const fixture = versionRequestFixture(() => new Response(null, { status: 201 }));
  const result = await fixture.revertToPreFindReplaceVersion('/example/website/page.html');
  assert.equal(result.success, true);
  assert.equal(result.skipped, false);
  assert.deepEqual(fixture.calls.map(({ url, options }) => [url, options.method || 'GET']), [
    ['https://admin.da.live/versionlist/example/website/page.html', 'GET'],
    ['https://admin.da.live/versionsource/newer', 'GET'],
    ['https://admin.da.live/versionsource/example/website/page.html', 'POST'],
    ['https://admin.da.live/source/example/website/page.html', 'POST'],
  ]);
  assert.equal(await fixture.calls[3].options.body.get('data').text(), '<p>Restore target</p>');
});

it('distinguishes a failed restore write from a skipped backup', async () => {
  const fixture = versionRequestFixture(() => Response.json({ id: 'backup' }), 500);
  const result = await fixture.revertToPreFindReplaceVersion('/example/website/page.html');
  assert.equal(result.success, false);
  assert.equal(result.skipped, false);
  assert.equal(fixture.calls.length, 4);
});

it('reports separate success, skipped-backup, and failure counts for bulk revert', async () => {
  const messages = [];
  const outcomes = {
    'restored.html': { success: true, skipped: false },
    'skipped.html': { success: false, skipped: true },
    'failed.html': { success: false, skipped: false },
  };
  const { bulkRevertLastReplacement } = loadFunctions(
    'async function bulkRevertLastReplacement(',
    'function filterContentByTarget(',
    ['bulkRevertLastReplacement'],
    {
      app: {
        results: Object.keys(outcomes).map((name) => ({
          selected: true, file: { path: `/example/website/${name}` },
        })),
        fileCache: new Map(),
      },
      confirm: () => true,
      updateProgress() {},
      showMessage: (...args) => messages.push(args),
      revertToPreFindReplaceVersion: async (path) => outcomes[path.split('/').pop()],
    },
  );
  await bulkRevertLastReplacement();
  assert.equal(messages.length, 1);
  assert.equal(messages[0][1], 'warning');
  assert.equal(
    messages[0][0],
    'Reverted 1/3 files. Skipped 1 (backup creation failed): skipped.html. Failed 1: failed.html.',
  );
});

['backup failure', 'save failure', 'success'].forEach((scenario) => {
  it(`uses explicit backup status and accurate replacement feedback: ${scenario}`, async () => {
    const messages = [];
    const saved = [];
    const { executeReplace } = loadFunctions(
      'async function executeReplace(',
      'async function handleSingleFileOperation(',
      ['executeReplace'],
      {
        app: {
          results: [{
            file: { path: '/example/website/page.html' },
            selected: true,
            matches: [{ selected: true }],
            originalContent: '<p>Old</p>',
          }],
          fileCache: new Map(),
        },
        document: {
          getElementById: (id) => ({
            'search-term': { value: 'Old' },
            'replace-term': { value: 'New' },
            'html-mode': { checked: true },
          }[id]),
        },
        confirm: () => true,
        createVersion: async () => ({ success: scenario !== 'backup failure' }),
        saveContent: async (path, content) => {
          saved.push([path, content]);
          return scenario !== 'save failure';
        },
        createHTMLSearchRegex,
        updateProgress() {},
        showMessage: (...args) => messages.push(args),
      },
    );
    await executeReplace();
    assert.equal(saved.length, scenario === 'backup failure' ? 0 : 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0][1], scenario === 'success' ? 'success' : 'warning');
    if (scenario === 'backup failure') assert.match(messages[0][0], /Skipped 1 files/);
    if (scenario === 'save failure') assert.match(messages[0][0], /Failed 1 files while saving/);
    if (scenario === 'success') {
      assert.deepEqual(saved[0], ['/example/website/page.html', '<p>New</p>']);
      assert.match(messages[0][0], /Updated 1\/1 files successfully/);
    }
  });
});

it('keeps JSON scanning read-only and handles zero-width regex matches', async () => {
  const raw = '{"text":"aba"}';
  const messages = [];
  const app = {
    searchPaths: [], results: [], selectedFiles: new Set(), token: 'test-token',
  };
  const elements = {
    'search-term': { value: 'a|$' },
    'search-type': { value: 'regex' },
    'find-json-files': { checked: true },
  };
  const { scanFiles } = loadFunctions(
    'async function scanFiles(',
    'function escapeHtml(',
    ['scanFiles'],
    {
      app,
      document: {
        getElementById: (id) => {
          if (!elements[id]) elements[id] = {};
          return elements[id];
        },
        querySelector: (selector) => (
          selector === '.results-container' ? { style: {} } : { textContent: 'All Content' }
        ),
      },
      resetPagination() {},
      validateOrgSite: () => true,
      parseOrgSite: () => ({ org: 'example', site: 'website' }),
      showMessage: (...args) => messages.push(args),
      updateProgress() {},
      fetchFilesForJson: async () => [{ path: '/example/website/data.json', name: 'data.json' }],
      API: { SOURCE: 'https://admin.da.live/source' },
      fetch: async (url, options) => {
        assert.equal(url, 'https://admin.da.live/source/example/website/data.json');
        assert.equal(options.method || 'GET', 'GET');
        return new Response(raw);
      },
      createSearchRegex,
      getMatchContext,
      displayResults() {},
      setAccordionExpanded() {},
      console: { error: assert.fail },
    },
  );
  await scanFiles();
  assert.equal(app.results.length, 1);
  assert.equal(app.results[0].isJsonFile, true);
  assert.deepEqual(
    Array.from(app.results[0].matches, (match) => [match.match, match.index]),
    [['a', raw.indexOf('a')], ['a', raw.lastIndexOf('a')], ['', raw.length]],
  );
  assert.ok(app.results[0].matches.every((match) => match.selected));
  assert.equal(elements['execute-btn'].disabled, true);
  assert.equal(messages.at(-1)[1], 'success');
});
