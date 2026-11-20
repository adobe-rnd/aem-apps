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
  parseProposal, involvement, groupByProposal, cardKey, pageState, mergeCheck, applyMerged,
  applyRejected, canvasUrl, previewPath,
  pagePathFrom, isDraftPath, typeLabel, roleSummary,
} from '../../../../tools/plugins/proposals/model.js';

const raw = (extra = {}) => ({
  kind: 'content-proposal',
  id: '20261118-1902-hero',
  createdAt: '2026-11-18T19:02:00Z',
  status: 'open',
  title: 'Hero line',
  summary: 'A line.',
  source: { path: '/index-ready.html', language: 'en' },
  pages: [
    {
      target: '/en-ca/index-ready.html', draftPath: '/drafts/proposals/x/en-ca/index-ready.html', baseVersionId: 'v1',
    },
  ],
  changes: [{ target: '/en-ca/index-ready.html', type: 'text-adaptation', rationale: 'Spelling.' }],
  ...extra,
});

describe('pagePathFrom', () => {
  it('adds html and index', () => {
    assert.equal(pagePathFrom('/en-ca/page'), '/en-ca/page.html');
    assert.equal(pagePathFrom('/en-ca/'), '/en-ca/index.html');
    assert.equal(pagePathFrom(''), '/index.html');
  });
});

describe('parseProposal', () => {
  it('normalizes a record', () => {
    const proposal = parseProposal(raw(), 'fallback');
    assert.equal(proposal.id, '20261118-1902-hero');
    assert.equal(proposal.pages[0].target, '/en-ca/index-ready.html');
    assert.equal(proposal.pages[0].baseVersionId, 'v1');
    assert.equal(proposal.changes[0].type, 'text-adaptation');
  });

  it('uses the folder name when the record has no id, and defaults the status', () => {
    const proposal = parseProposal(raw({ id: undefined, status: undefined }), 'folder-id');
    assert.equal(proposal.id, 'folder-id');
    assert.equal(proposal.status, 'open');
  });

  it('rejects records without pages', () => {
    assert.equal(parseProposal({ pages: [] }, 'x'), null);
    assert.equal(parseProposal(null, 'x'), null);
    assert.equal(parseProposal(raw({ pages: [{ target: 'a' }] }), 'x'), null);
  });
});

describe('involvement', () => {
  const list = [
    parseProposal(raw(), 'a'),
    parseProposal(raw({ id: 'b', status: 'merged' }), 'b'),
    parseProposal(raw({ id: 'c', createdAt: '2026-11-19T10:00:00Z' }), 'c'),
    parseProposal(raw({
      id: 'd', pages: [{ target: '/fr-ca/index-ready.html', draftPath: '/drafts/d' }],
    }), 'd'),
  ];

  it('returns open proposals for a target page, newest first, and closed ones apart', () => {
    const { open, closed } = involvement(list, '/en-ca/index-ready');
    assert.deepEqual(open.map((item) => item.proposal.id), ['c', '20261118-1902-hero']);
    assert.deepEqual(closed.map((item) => item.proposal.id), ['b']);
    assert.equal(open[0].role, 'target');
    assert.equal(open[0].actionable, true);
    assert.equal(closed[0].actionable, false);
  });

  it('keeps only the changes for this page', () => {
    const { open } = involvement([parseProposal(raw({
      changes: [
        { target: '/en-ca/index-ready.html', type: 'a', rationale: '' },
        { target: '/fr-ca/index-ready.html', type: 'b', rationale: '' },
      ],
    }), 'a')], '/en-ca/index-ready.html');
    assert.equal(open[0].changes.length, 1);
  });

  it('treats an already merged page of a partly merged proposal as closed', () => {
    const merged = parseProposal(raw({
      status: 'partially-merged',
      pages: [{
        target: '/en-ca/index-ready.html', draftPath: '/d', mergeMode: 'smart',
      }, { target: '/fr-ca/index-ready.html', draftPath: '/e' }],
    }), 'm');
    const en = involvement([merged], '/en-ca/index-ready.html');
    assert.equal(en.open.length, 0);
    assert.equal(en.closed[0].state, 'merged');
    const fr = involvement([merged], '/fr-ca/index-ready.html');
    assert.equal(fr.open.length, 1);
    assert.equal(fr.open[0].actionable, true);
  });

  it('shows a proposal on its source page, one actionable item per target page', () => {
    const { open } = involvement(list, '/index-ready.html');
    assert.equal(open.length, 3);
    assert.ok(open.every((item) => item.role === 'source' && item.actionable && item.page));
  });

  it('gives a source page one item per target of a multi-page proposal', () => {
    const multi = parseProposal(raw({
      pages: [
        { target: '/en-ca/index-ready.html', draftPath: '/d1', baseVersionId: 'v1' },
        { target: '/fr-ca/index-ready.html', draftPath: '/d2', baseVersionId: 'v2' },
      ],
      changes: [
        { target: '/en-ca/index-ready.html', type: 'a', rationale: '' },
        { target: '/fr-ca/index-ready.html', type: 'b', rationale: '' },
      ],
    }), 'multi');
    const { open } = involvement([multi], '/index-ready.html');
    assert.deepEqual(open.map((item) => item.page.target), [
      '/en-ca/index-ready.html', '/fr-ca/index-ready.html',
    ]);
    assert.deepEqual(open.map((item) => item.changes[0].type), ['a', 'b']);
    const groups = groupByProposal(open);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 2);
    assert.equal(
      cardKey(multi, multi.pages[0]),
      '20261118-1902-hero|/en-ca/index-ready.html',
    );
  });

  it('splits a partly merged proposal on the source page into open and closed items', () => {
    const partly = parseProposal(raw({
      status: 'partially-merged',
      pages: [
        { target: '/en-ca/index-ready.html', draftPath: '/d1', mergeMode: 'smart' },
        { target: '/fr-ca/index-ready.html', draftPath: '/d2' },
      ],
    }), 'p');
    const { open, closed } = involvement([partly], '/index-ready.html');
    assert.deepEqual(open.map((item) => item.page.target), ['/fr-ca/index-ready.html']);
    assert.deepEqual(closed.map((item) => item.page.target), ['/en-ca/index-ready.html']);
  });

  it('recognizes the draft page and the diff view page, with actions for that target', () => {
    const one = [parseProposal(raw({
      id: 'x',
      pages: [{
        target: '/en-ca/index-ready.html',
        draftPath: '/drafts/proposals/x/en-ca/index-ready.html',
        baseVersionId: 'v1',
      }],
    }), 'x')];
    const draft = involvement(one, '/drafts/proposals/x/en-ca/index-ready.html').open[0];
    assert.equal(draft.role, 'draft');
    assert.equal(draft.actionable, true);
    assert.equal(draft.page.target, '/en-ca/index-ready.html');
    const preview = involvement(one, '/drafts/proposals/x/preview/en-ca/index-ready').open[0];
    assert.equal(preview.role, 'preview');
    assert.equal(preview.actionable, true);
  });

  it('finds nothing for an unrelated page', () => {
    const { open, closed } = involvement(list, '/de/other.html');
    assert.equal(open.length + closed.length, 0);
  });

  it('classifies a rejected proposal as closed on every role', () => {
    const rejected = parseProposal(raw({ status: 'rejected' }), 'r');
    assert.equal(pageState(rejected, rejected.pages[0]), 'rejected');
    assert.equal(involvement([rejected], '/index-ready.html').closed.length, 1);
  });
});

describe('mergeCheck', () => {
  it('describes the outcomes', () => {
    assert.equal(mergeCheck({ skipped: 0 }).label, 'Merges cleanly');
    assert.equal(mergeCheck({ skipped: 2 }).tone, 'notice');
    assert.match(mergeCheck({ skipped: 1 }).label, /1 block also changed/);
    assert.equal(mergeCheck({ unchanged: true }).label, 'Already up to date');
    assert.equal(mergeCheck(null).label, 'Not checked');
  });
});

describe('record updates', () => {
  it('marks the merged page and keeps the status partial while others remain', () => {
    const source = raw({
      pages: [
        { target: '/en-ca/index-ready.html', draftPath: '/a' },
        { target: '/fr-ca/index-ready.html', draftPath: '/b' },
      ],
    });
    const next = applyMerged(source, [{ target: '/en-ca/index-ready.html', mode: 'smart' }], 'T');
    assert.equal(next.status, 'partially-merged');
    assert.equal(next.pages[0].mergeMode, 'smart');
    assert.equal(next.pages[1].mergeMode, undefined);
    assert.equal(next.mergedAt, 'T');
    assert.equal(source.status, 'open');
  });

  it('sets merged when the last page is done', () => {
    const next = applyMerged(raw(), [{ target: '/en-ca/index-ready.html', mode: 'smart' }], 'T');
    assert.equal(next.status, 'merged');
  });

  it('records a rejection with an optional reason', () => {
    assert.deepEqual(
      { ...applyRejected(raw(), 'Wrong claim', 'T') },
      {
        ...raw(), status: 'rejected', rejectedAt: 'T', reason: 'Wrong claim',
      },
    );
    assert.equal('reason' in applyRejected(raw(), '', 'T'), false);
  });
});

describe('paths', () => {
  it('builds canvas and preview paths', () => {
    assert.equal(previewPath('id', '/en-ca/x'), '/drafts/proposals/id/preview/en-ca/x.html');
    assert.equal(
      canvasUrl('o', 's', previewPath('id', '/en-ca/x.html')),
      'https://da.live/canvas#/o/s/drafts/proposals/id/preview/en-ca/x',
    );
  });

  it('recognizes draft paths', () => {
    assert.equal(isDraftPath('/drafts/a.html'), true);
    assert.equal(isDraftPath('/drafts'), true);
    assert.equal(isDraftPath('/draftsy/a.html'), false);
  });

  it('labels change types', () => {
    assert.equal(typeLabel('claim-adjusted'), 'Claim adjusted');
    assert.equal(typeLabel('weird'), 'weird');
  });
});

describe('roleSummary', () => {
  const proposal = parseProposal(raw());
  it('says where the proposal goes from the source page', () => {
    assert.match(roleSummary('source', proposal), /^Sent from this page to /);
  });

  it('names the source on the target, draft and diff view pages', () => {
    assert.equal(roleSummary('target', proposal), 'Proposed for this page, from /index-ready.html');
    assert.match(roleSummary('draft', proposal), /^Draft for .+, from \/index-ready\.html$/);
    assert.match(roleSummary('preview', proposal), /^Diff view for /);
  });

  it('counts the pages when there are several targets', () => {
    const many = { ...proposal, pages: [proposal.pages[0], proposal.pages[0]] };
    assert.equal(roleSummary('source', many), 'Sent from this page to 2 pages');
  });
});
