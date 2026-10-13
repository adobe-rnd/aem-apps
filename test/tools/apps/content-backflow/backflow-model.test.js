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
  parseSite, formatSite, sameSite, ext, mimeType, isText, isExcluded, rewriteRefs,
  normalizeSelection, planCopy, summarize, snapshotLabel, toAemUrl, mediaFolder, expandSelection,
  runPool,
} from '../../../../tools/apps/content-backflow/backflow-model.js';

const SOURCE = { org: 'acme', site: 'site' };
const DEV = { org: 'acme', site: 'site-dev' };
const STAGE = { org: 'acme', site: 'site-stage' };
const OTHER_ORG = { org: 'acme-lower', site: 'site' };

describe('parseSite / formatSite / sameSite', () => {
  it('parses /org/site with or without slashes, rejects anything else', () => {
    assert.deepEqual(parseSite('/acme/site'), SOURCE);
    assert.deepEqual(parseSite(' acme/site/ '), SOURCE);
    ['', 'acme', '/acme/', '/acme/site/x', '//site'].forEach((value) => assert.equal(parseSite(value), null, value));
    assert.equal(formatSite(SOURCE), '/acme/site');
    assert.equal(formatSite(null), '');
    assert.ok(sameSite(SOURCE, { org: 'acme', site: 'site' }));
    assert.ok(!sameSite(SOURCE, DEV));
  });
});

describe('ext / mimeType / isText', () => {
  it('maps extensions to mime types, unknown to octet-stream', () => {
    assert.equal(ext('/a/b.HTML'), 'html');
    assert.equal(ext('/a/.b/c'), '');
    assert.equal(mimeType('/a.html'), 'text/html');
    assert.equal(mimeType('/a.json'), 'application/json');
    assert.equal(mimeType('/.a/m.jpg'), 'image/jpeg');
    assert.equal(mimeType('/a.svg'), 'image/svg+xml');
    assert.equal(mimeType('/a.xyz'), 'application/octet-stream');
    assert.ok(isText('/a.html') && isText('/a.json'));
    assert.ok(!isText('/a.png'));
  });
});

describe('isExcluded', () => {
  it('excludes .da and drafts, and nothing that merely shares a prefix', () => {
    ['/.da', '/.da/config.json', '/drafts', '/drafts/a.html', '/drafts/x/y.html']
      .forEach((path) => assert.ok(isExcluded(path), path));
    ['/blog/a.html', '/draftsman.html', '/drafts-old/a.html', '/blog/drafts/a.html', '/blog/.page/m.png']
      .forEach((path) => assert.ok(!isExcluded(path), path));
  });
});

describe('rewriteRefs', () => {
  const text = [
    'https://content.da.live/acme/site/blog/.news/m.png',
    'https://admin.da.live/source/acme/site/blog/a.html',
    'https://main--site--acme.aem.page/blog/a',
    '"https://main--site--acme.aem.live/blog/b"',
  ].join('\n');

  it('points DA URLs and aem hosts at the target', () => {
    assert.equal(rewriteRefs(text, SOURCE, DEV), [
      'https://content.da.live/acme/site-dev/blog/.news/m.png',
      'https://admin.da.live/source/acme/site-dev/blog/a.html',
      'https://main--site-dev--acme.aem.page/blog/a',
      '"https://main--site-dev--acme.aem.live/blog/b"',
    ].join('\n'));
  });

  it('rewrites the org too when the target is in another org', () => {
    assert.equal(rewriteRefs(text, SOURCE, OTHER_ORG), [
      'https://content.da.live/acme-lower/site/blog/.news/m.png',
      'https://admin.da.live/source/acme-lower/site/blog/a.html',
      'https://main--site--acme-lower.aem.page/blog/a',
      '"https://main--site--acme-lower.aem.live/blog/b"',
    ].join('\n'));
  });

  it('leaves similarly named sites alone and is idempotent', () => {
    const lower = 'https://content.da.live/acme/site-stage/x.png main--site-dev--acme.aem.page';
    assert.equal(rewriteRefs(lower, SOURCE, DEV), lower);
    const once = rewriteRefs(text, SOURCE, DEV);
    assert.equal(rewriteRefs(once, SOURCE, DEV), once);
    assert.equal(rewriteRefs(lower, SOURCE, STAGE), lower);
  });

  it('leaves other orgs and unrelated text alone', () => {
    const other = 'https://content.da.live/other/site/x.png main--site--acme-x.aem.page site';
    assert.equal(rewriteRefs(other, SOURCE, DEV), other);
  });
});

describe('normalizeSelection', () => {
  it('drops paths inside a selected folder', () => {
    assert.deepEqual(
      normalizeSelection(['/blog/news/a.html', '/blog/news', '/blog/news', '/blog/team', '/blog/newsroom.html']),
      ['/blog/news', '/blog/newsroom.html', '/blog/team'],
    );
  });
});

describe('planCopy', () => {
  const sourceFiles = ['/blog/a.html', '/blog/b.html', '/blog/.b/m.png', '/drafts/x.html'];
  const targetFiles = ['/blog/b.html', '/blog/.b/m.png', '/blog/old.html', '/other/z.html', '/drafts/y.html'];
  const actions = (rows) => Object.fromEntries(rows.map((row) => [row.path, row.action]));

  it('add: creates missing files, skips existing ones', () => {
    const rows = planCopy({
      sourceFiles, targetFiles, mode: 'add', selectedFolders: ['/blog'],
    });
    assert.deepEqual(actions(rows), {
      '/blog/.b/m.png': 'skip', '/blog/a.html': 'create', '/blog/b.html': 'skip',
    });
    assert.ok(rows.every((row) => !row.irreversible));
  });

  it('update: creates and overwrites; binary overwrite is irreversible', () => {
    const rows = planCopy({
      sourceFiles, targetFiles, mode: 'update', selectedFolders: ['/blog'],
    });
    assert.deepEqual(actions(rows), {
      '/blog/.b/m.png': 'overwrite', '/blog/a.html': 'create', '/blog/b.html': 'overwrite',
    });
    assert.deepEqual(rows.filter((row) => row.irreversible).map((row) => row.path), ['/blog/.b/m.png']);
  });

  it('mirror: also deletes target-only files inside selected folders only, never excluded', () => {
    const rows = planCopy({
      sourceFiles, targetFiles, mode: 'mirror', selectedFolders: ['/blog'],
    });
    assert.deepEqual(actions(rows), {
      '/blog/.b/m.png': 'overwrite',
      '/blog/a.html': 'create',
      '/blog/b.html': 'overwrite',
      '/blog/old.html': 'delete',
    });
    assert.equal(rows.find((row) => row.action === 'delete').irreversible, true);
  });

  it('mirror without selected folders deletes nothing', () => {
    const rows = planCopy({ sourceFiles, targetFiles, mode: 'mirror' });
    assert.ok(rows.every((row) => row.action !== 'delete'));
  });

  it('excluded paths never appear, even with root selected', () => {
    const rows = planCopy({
      sourceFiles: [...sourceFiles, '/.da/config.json'],
      targetFiles: [...targetFiles, '/.da/other.json'],
      mode: 'mirror',
      selectedFolders: ['/'],
    });
    assert.ok(rows.every((row) => !isExcluded(row.path)));
    assert.ok(rows.some((row) => row.path === '/other/z.html' && row.action === 'delete'));
  });

  it('summarize counts actions and irreversible rows', () => {
    const rows = planCopy({
      sourceFiles, targetFiles, mode: 'mirror', selectedFolders: ['/blog'],
    });
    assert.deepEqual(summarize(rows), {
      create: 1, skip: 0, overwrite: 2, delete: 1, irreversible: 2,
    });
  });
});

describe('snapshotLabel', () => {
  it('names the source and time', () => {
    assert.equal(
      snapshotLabel(SOURCE, new Date('2026-01-02T03:04:05Z')),
      'Content backflow from /acme/site 2026-01-02T03:04:05.000Z',
    );
  });
});

describe('toAemUrl', () => {
  const base = 'https://main--site-dev--acme.aem.page';
  it('strips .html, maps index to its folder, keeps json and media extensions', () => {
    assert.equal(toAemUrl('/blog/news/a.html', DEV), `${base}/blog/news/a`);
    assert.equal(toAemUrl('/blog/index.html', DEV), `${base}/blog/`);
    assert.equal(toAemUrl('/index.html', DEV), `${base}/`);
    assert.equal(toAemUrl('/blog/reindex.html', DEV), `${base}/blog/reindex`);
    assert.equal(toAemUrl('/blog/nav.json', DEV), `${base}/blog/nav.json`);
    assert.equal(toAemUrl('/blog/.a/m.png', DEV), `${base}/blog/.a/m.png`);
  });
});

describe('mediaFolder / expandSelection', () => {
  it('maps pages to their media folder', () => {
    assert.equal(mediaFolder('/blog/news/a.html'), '/blog/news/.a');
    assert.equal(mediaFolder('/a.html'), '/.a');
    assert.equal(mediaFolder('/a.json'), null);
  });

  it('expands folders recursively with page media, skipping excluded paths', async () => {
    const tree = {
      '/blog': [
        { path: '/blog/a.html', isFolder: false },
        { path: '/blog/sub', isFolder: true },
      ],
      '/blog/.a': [{ path: '/blog/.a/m.png', isFolder: false }],
      '/blog/sub': [{ path: '/blog/sub/s.json', isFolder: false }],
      '/drafts': [{ path: '/drafts/d.html', isFolder: false }],
      '/one/.p': [{ path: '/one/.p/x.jpg', isFolder: false }],
    };
    const listed = [];
    const list = async (path) => { listed.push(path); return tree[path] || []; };
    const files = await expandSelection(list, [
      { path: '/blog', isFolder: true },
      { path: '/one/p.html', isFolder: false },
      { path: '/drafts', isFolder: true },
    ]);
    assert.deepEqual(files.sort((a, b) => a.localeCompare(b)), [
      '/blog/.a/m.png', '/blog/a.html', '/blog/sub/s.json', '/one/.p/x.jpg', '/one/p.html',
    ]);
    assert.ok(!listed.some((path) => isExcluded(path)));
  });

  it('lists media folders after regular folders and reports listed/pending as it goes', async () => {
    const tree = {
      '/a': [{ path: '/a/p.html', isFolder: false }, { path: '/a/b', isFolder: true }],
      '/a/b': [{ path: '/a/b/y.json', isFolder: false }],
    };
    const listed = [];
    const progress = [];
    const list = async (path) => { listed.push(path); return tree[path] || []; };
    await expandSelection(list, [{ path: '/a', isFolder: true }], (p) => progress.push(p), 1);
    assert.deepEqual(listed, ['/a', '/a/b', '/a/.p']);
    assert.deepEqual(progress, [
      { done: 1, pending: 2 }, { done: 2, pending: 1 }, { done: 3, pending: 0 },
    ]);
  });
});

describe('runPool', () => {
  it('settles every item in order within the limit', async () => {
    let active = 0;
    let peak = 0;
    const results = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      active -= 1;
      if (n === 3) throw new Error('boom');
      return n * 10;
    });
    assert.equal(peak, 2);
    assert.deepEqual(results.map((r) => r.value ?? r.reason.message), [10, 20, 'boom', 40, 50, 60]);
  });

  it('handles an empty list', async () => {
    assert.deepEqual(await runPool([], 4, async () => 1), []);
  });
});
