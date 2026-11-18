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
  parseProposal, proposalsForPage, mergeCheck, applyMerged, applyRejected, canvasUrl, previewPath,
  pagePathFrom, isDraftPath, typeLabel,
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

describe('proposalsForPage', () => {
  const list = [
    parseProposal(raw(), 'a'),
    parseProposal(raw({ id: 'b', status: 'merged' }), 'b'),
    parseProposal(raw({ id: 'c', createdAt: '2026-11-19T10:00:00Z' }), 'c'),
    parseProposal(raw({
      id: 'd', pages: [{ target: '/fr-ca/index-ready.html', draftPath: '/drafts/d' }],
    }), 'd'),
  ];

  it('returns open proposals that target the page, newest first', () => {
    const { targeting } = proposalsForPage(list, '/en-ca/index-ready');
    assert.deepEqual(targeting.map((entry) => entry.proposal.id), ['c', '20261118-1902-hero']);
  });

  it('keeps only the changes for this page', () => {
    const { targeting } = proposalsForPage([parseProposal(raw({
      changes: [
        { target: '/en-ca/index-ready.html', type: 'a', rationale: '' },
        { target: '/fr-ca/index-ready.html', type: 'b', rationale: '' },
      ],
    }), 'a')], '/en-ca/index-ready.html');
    assert.equal(targeting[0].changes.length, 1);
  });

  it('skips pages that were already merged', () => {
    const merged = parseProposal(raw({
      status: 'partially-merged',
      pages: [{
        target: '/en-ca/index-ready.html', draftPath: '/d', mergeMode: 'smart',
      }, { target: '/fr-ca/index-ready.html', draftPath: '/e' }],
    }), 'm');
    assert.equal(proposalsForPage([merged], '/en-ca/index-ready.html').targeting.length, 0);
    assert.equal(proposalsForPage([merged], '/fr-ca/index-ready.html').targeting.length, 1);
  });

  it('reports proposals the page is the source of', () => {
    const { targeting, sourceOf } = proposalsForPage(list, '/index-ready.html');
    assert.equal(targeting.length, 0);
    assert.equal(sourceOf.length, 3);
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
