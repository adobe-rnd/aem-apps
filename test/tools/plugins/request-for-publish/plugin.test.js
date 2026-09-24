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
  createHandle,
  findPendingRequest,
  mergePendingRequests,
  requestPathsFor,
  toSitePath,
} from '../../../../tools/plugins/request-for-publish/plugin.js';

const CONTEXT = { org: 'bpauli', site: 'frescopa', path: '/bpauli/frescopa' };
const CTX = { org: 'bpauli', site: 'frescopa', token: 'ctx-token' };

function pending(path, extra = {}) {
  return {
    requester: 'pauli@adobe.com',
    approver: 'approver@adobe.com',
    path,
    comment: 'This is one example request',
    status: 'pending',
    created: '2026-09-22T13:30:12.892Z',
    ...extra,
  };
}

function item(sitePath) {
  return {
    path: `/bpauli/frescopa${sitePath}.html`,
    previewPath: `/bpauli/frescopa${sitePath}`,
    sitePath,
  };
}

/** A handle whose listing is injected, so no test touches the network. */
function handleWith(requests, spy = {}) {
  return createHandle({
    context: CONTEXT,
    token: 'init-token',
    loadRequests: async (params) => {
      spy.calls = (spy.calls || 0) + 1;
      spy.params = params;
      return requests;
    },
  });
}

describe('toSitePath', () => {
  it('prefers the site-relative path the host supplies', () => {
    assert.equal(toSitePath(item('/tea2')), '/tea2');
  });

  it('falls back to stripping the two-segment org/site prefix', () => {
    assert.equal(toSitePath({ previewPath: '/bpauli/frescopa/de/tea2' }), '/de/tea2');
    assert.equal(toSitePath({ path: '/bpauli/frescopa/tea2.html' }), '/tea2');
  });

  it('returns empty for an item with no usable path', () => {
    assert.equal(toSitePath({}), '');
    assert.equal(toSitePath({ path: '/bpauli/frescopa' }), '');
  });
});

describe('requestPathsFor', () => {
  it('matches a plain page on its own path', () => {
    assert.deepEqual(requestPathsFor('/tea2'), ['/tea2']);
  });

  it('also matches a folder index stored as the folder', () => {
    assert.deepEqual(requestPathsFor('/de/index'), ['/de/index', '/de']);
  });

  it('maps the site root index to the site root', () => {
    assert.deepEqual(requestPathsFor('/index'), ['/index', '/']);
  });
});

describe('mergePendingRequests', () => {
  it('dedupes a row the caller sees as both requester and approver', () => {
    const merged = mergePendingRequests([[pending('/tea2')], [pending('/tea2')]]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].path, '/tea2');
  });

  it('keeps rows only one role returns', () => {
    const merged = mergePendingRequests([[pending('/tea2')], [pending('/de/index')]]);
    assert.deepEqual(merged.map((r) => r.path), ['/tea2', '/de/index']);
  });

  it('drops rows that are not pending', () => {
    assert.deepEqual(mergePendingRequests([[pending('/tea2', { status: 'approved' })]]), []);
  });
});

describe('findPendingRequest', () => {
  it('prefers the exact stored path over the folder form', () => {
    const rows = [pending('/de'), pending('/de/index', { comment: 'index row' })];
    assert.equal(findPendingRequest(rows, '/de/index').comment, 'index row');
  });

  it('returns null when nothing matches', () => {
    assert.equal(findPendingRequest([pending('/tea2')], '/tea3'), null);
  });
});

describe('getStatus', () => {
  it('returns a pending status for a matching sitePath', async () => {
    const { getStatus } = handleWith([pending('/tea2')]);
    const status = await getStatus(item('/tea2'), CTX);

    assert.equal(status.state, 'pending');
    assert.equal(status.label, 'In Review');
    assert.equal(status.icon, 'clock');
    assert.match(status.href, /publish-requests-inbox\?org=bpauli&site=frescopa$/);
    assert.deepEqual(
      status.detail.map((d) => d.label),
      ['Requested by', 'Approver', 'Comment', 'Requested'],
    );
    assert.equal(status.detail[0].value, 'pauli@adobe.com');
    assert.equal(status.detail[2].value, 'This is one example request');
  });

  it('returns null for a page with no request', async () => {
    const { getStatus } = handleWith([pending('/tea2')]);
    assert.equal(await getStatus(item('/tea3'), CTX), null);
  });

  it('matches a folder index stored as the folder path', async () => {
    const { getStatus } = handleWith([pending('/de')]);
    const status = await getStatus(item('/de/index'), CTX);
    assert.equal(status.state, 'pending');
  });

  it('matches a folder index stored with the /index suffix', async () => {
    const { getStatus } = handleWith([pending('/de/index')]);
    const status = await getStatus(item('/de/index'), CTX);
    assert.equal(status.state, 'pending');
  });

  it('omits popover rows the request row does not carry', async () => {
    const { getStatus } = handleWith([pending('/tea2', { comment: '', created: '' })]);
    const status = await getStatus(item('/tea2'), CTX);
    assert.deepEqual(status.detail.map((d) => d.label), ['Requested by', 'Approver']);
  });

  it('lists the requests once for the whole list', async () => {
    const spy = {};
    const { getStatus } = handleWith([pending('/tea2')], spy);

    await getStatus(item('/tea2'), CTX);
    await getStatus(item('/tea3'), CTX);
    await getStatus(item('/de/index'), CTX);

    assert.equal(spy.calls, 1);
    assert.deepEqual(spy.params, { org: 'bpauli', site: 'frescopa', token: 'ctx-token' });
  });

  it('returns null for an item with no usable path', async () => {
    const { getStatus } = handleWith([pending('/tea2')]);
    assert.equal(await getStatus({}, CTX), null);
  });

  it('falls back to the init context when ctx carries no org or site', async () => {
    const spy = {};
    const { getStatus } = handleWith([pending('/tea2')], spy);
    const status = await getStatus(item('/tea2'), {});

    assert.equal(status.state, 'pending');
    assert.deepEqual(spy.params, { org: 'bpauli', site: 'frescopa', token: 'init-token' });
  });

  it('derives org and site from the browsed path when only it is given', async () => {
    const spy = {};
    const handle = createHandle({
      context: { path: '/bpauli/frescopa' },
      token: 'init-token',
      loadRequests: async (params) => {
        spy.params = params;
        return [pending('/tea2')];
      },
    });

    await handle.getStatus(item('/tea2'), {});
    assert.deepEqual(spy.params, { org: 'bpauli', site: 'frescopa', token: 'init-token' });
  });
});
