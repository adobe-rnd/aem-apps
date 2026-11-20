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
import { DOMParser } from 'linkedom';
import createStore from '../../../../tools/plugins/proposals/store.js';

global.DOMParser ??= DOMParser;

const json = (body, status = 200, headers = {}) => new Response(
  JSON.stringify(body),
  { status, headers },
);
const record = (id, extra = {}) => ({
  id, status: 'open', title: id, pages: [{ target: '/a.html', draftPath: '/d.html', baseVersionId: 'v1' }], ...extra,
});

function setup(routes) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    const route = routes.find(({ match }) => match(url, init));
    return route ? route.reply(url, init) : new Response('', { status: 404 });
  };
  return { store: createStore({ org: 'o', site: 's', fetch }), requests };
}

describe('listProposals', () => {
  it('reads the record of every proposal folder and skips broken ones', async () => {
    const { store } = setup([
      {
        match: (url) => url.includes('/list/o/s/drafts/proposals'),
        reply: () => json([
          { path: '/o/s/drafts/proposals/a', name: 'a' },
          { path: '/o/s/drafts/proposals/b', name: 'b' },
          { path: '/o/s/drafts/proposals/c', name: 'c' },
          { path: '/o/s/drafts/proposals/note.txt', name: 'note', ext: 'txt' },
        ]),
      },
      { match: (url) => url.endsWith('/proposals/a/proposal.json'), reply: () => json(record('a'), 200, { etag: 'W/"1"' }) },
      { match: (url) => url.endsWith('/proposals/b/proposal.json'), reply: () => new Response('not json') },
    ]);
    const { proposals, problems } = await store.listProposals();
    assert.deepEqual(proposals.map((item) => item.proposal.id), ['a']);
    assert.equal(proposals[0].etag, '"1"');
    assert.equal(proposals[0].raw.title, 'a');
    assert.deepEqual(problems.map((item) => item.id), ['b', 'c']);
    assert.match(problems[0].reason, /not valid JSON/);
    assert.match(problems[1].reason, /no proposal.json/);
  });

  it('returns nothing when the folder does not exist', async () => {
    const { store } = setup([]);
    assert.deepEqual(await store.listProposals(), { proposals: [], problems: [] });
  });
});

describe('writes', () => {
  it('saves the record with If-Match', async () => {
    const { store, requests } = setup([{ match: () => true, reply: () => new Response('', { status: 200 }) }]);
    await store.saveRecord('a', record('a'), '"1"');
    assert.equal(requests[0].url, 'https://admin.da.live/source/o/s/drafts/proposals/a/proposal.json');
    assert.equal(requests[0].init.headers['If-Match'], '"1"');
    assert.equal(requests[0].init.method, 'POST');
  });

  it('explains a conflict', async () => {
    const { store } = setup([{ match: () => true, reply: () => new Response('', { status: 412 }) }]);
    await assert.rejects(store.saveRecord('a', record('a'), '"1"'), /changed while it was being updated/);
  });

  it('writes the preview page under the proposal', async () => {
    const { store, requests } = setup([{ match: () => true, reply: () => new Response('', { status: 200 }) }]);
    await store.savePreview('a', '/en-ca/x.html', '<body></body>');
    assert.equal(requests[0].url, 'https://admin.da.live/source/o/s/drafts/proposals/a/preview/en-ca/x.html');
  });
});

describe('versions', () => {
  const list = [
    {
      url: '/versionsource/f/v1.html', versionId: 'v1', timestamp: 1, label: 'base',
    },
    { url: '/versionsource/f/v2.html', versionId: 'v2', timestamp: 2 },
  ];

  it('reads a version by id', async () => {
    const { store } = setup([
      { match: (url) => url.includes('/versionlist/o/s/t.html'), reply: () => json(list) },
      { match: (url) => url.endsWith('/versionsource/f/v1.html'), reply: () => new Response('<body>old</body>') },
    ]);
    assert.equal(await store.readVersion('/t.html', 'v1'), '<body>old</body>');
  });

  it('reads a version by its label', async () => {
    const labelled = [
      ...list,
      {
        url: '/versionsource/f/v3.html', versionId: 'v3', timestamp: 3, label: 'proposal-x-base',
      },
      {
        url: '/versionsource/f/v4.html', versionId: 'v4', timestamp: 4, label: 'proposal-x-base',
      },
    ];
    const { store } = setup([
      { match: (url) => url.includes('/versionlist/o/s/t.html'), reply: () => json(labelled) },
      { match: (url) => url.endsWith('/versionsource/f/v4.html'), reply: () => new Response('<body>newest</body>') },
    ]);
    assert.equal(await store.readVersion('/t.html', 'label:proposal-x-base'), '<body>newest</body>');
    assert.equal(await store.readVersion('/t.html', 'proposal-x-base'), '<body>newest</body>');
    assert.equal(
      await store.readVersion('/t.html', 'proposal-x-base (/versionsource/o/s/t.html)'),
      '<body>newest</body>',
    );
  });

  it('lists the saved labels when the base version is missing', async () => {
    const { store } = setup([{ match: (url) => url.includes('/versionlist/'), reply: () => json(list) }]);
    await assert.rejects(
      store.readVersion('/t.html', 'other (/versionsource/o/s/t.html)'),
      /Base version "other \(\/versionsource\/o\/s\/t.html\)" of \/t.html was not found. Labels saved on this page: base\./,
    );
  });

  it('fails clearly for an unknown version', async () => {
    const { store } = setup([{ match: (url) => url.includes('/versionlist/'), reply: () => json(list) }]);
    await assert.rejects(store.readVersion('/t.html', 'nope'), /Base version "nope" of \/t.html was not found/);
  });

  it('creates a labelled version', async () => {
    const { store, requests } = setup([{ match: () => true, reply: () => new Response('', { status: 201 }) }]);
    await store.createVersion('/t.html', 'Merged from /d.html');
    assert.equal(requests[0].url, 'https://admin.da.live/versionsource/o/s/t.html');
    assert.equal(requests[0].init.body, JSON.stringify({ label: 'Merged from /d.html' }));
  });
});
