import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSiteExists, fetchCugRows, generateCugHeaders, livePageUrl, saveCugRows, siteFromHash,
} from '../../../../tools/apps/cug/data.js';

describe('livePageUrl', () => {
  it('builds the live page URL from the selected org/site and trimmed path', () => {
    assert.equal(
      livePageUrl(' /org/site/ ', ' /partners/google '),
      'https://main--site--org.aem.live/partners/google',
    );
    assert.equal(livePageUrl('/org/site', '/'), 'https://main--site--org.aem.live/');
    assert.equal(
      livePageUrl('org/site', '/partners?q=gold#details'),
      'https://main--site--org.aem.live/partners?q=gold#details',
    );
  });

  it('rejects invalid org/site and non-page paths', () => {
    assert.throws(() => livePageUrl('org', '/'), /Enter an org\/site/);
    ['', '  ', 'partners', '//other.example/a', '/\\other.example/a'].forEach((path) => {
      assert.throws(() => livePageUrl('org/site', path), /Enter a page path/);
    });
  });
});

describe('assertSiteExists', () => {
  it('checks the organization site list rather than the potentially empty site root', async () => {
    await assertSiteExists('/org/site', async (url, options) => {
      assert.equal(url, 'https://admin.da.live/list/org/');
      assert.deepEqual(options, { cache: 'no-store' });
      return { ok: true, json: async () => [{ name: 'site', path: '/org/site' }] };
    });
  });

  it('reports nonexistent sites and organizations', async () => {
    await Promise.all([[], [{ name: 'other' }], [{ name: 'site', ext: 'json' }]].map((sites) => (
      assert.rejects(assertSiteExists('org/site', async () => ({
        ok: true, json: async () => sites,
      })), /Org\/site \/org\/site was not found/)
    )));
    await assert.rejects(assertSiteExists('org/site', async () => ({
      ok: false, status: 404,
    })), /was not found/);
  });

  it('reports access failures separately from nonexistent sites', async () => {
    await Promise.all([401, 403, 500].map((status) => (
      assert.rejects(assertSiteExists('org/site', async () => ({
        ok: false, status,
      })), new RegExp(`Could not check org/site.*HTTP ${status}`))
    )));
    await assert.rejects(assertSiteExists('org/site', async () => ({
      ok: true, json: async () => ({}),
    })), /invalid site list/);
  });

  it('rejects invalid org/site input without a request', async () => {
    await assert.rejects(assertSiteExists('org', () => assert.fail('Unexpected request')), /Enter an org\/site/);
  });
});

describe('CUG org/site initialization', () => {
  it('prefills the field from the forwarded DA hash, including the leading slash', () => {
    assert.equal(siteFromHash('#/jckautzmann/jck-ew1'), '/jckautzmann/jck-ew1');
  });

  it('leaves the field empty when no site hash is supplied', () => {
    assert.equal(siteFromHash(''), '');
  });

  it('ignores unrelated URL fragments', () => {
    assert.equal(siteFromHash('#section'), '');
  });
});

describe('saveCugRows', () => {
  it('generates headers from the saved app spreadsheet format for the selected site', async () => {
    let posted;
    await generateCugHeaders('/org/site', {
      data: [
        { Path: '/members/**', Authentication: 'true', Groups: '' },
        { Path: '/partners/**', Authentication: '', Groups: 'gold,silver' },
      ],
    }, async (url, options) => {
      if (options.method === 'POST') {
        assert.equal(url, 'https://admin.hlx.page/config/org/sites/site/headers.json');
        posted = JSON.parse(options.body);
        return { ok: true };
      }
      return { ok: true, json: async () => ({ headers: {} }) };
    });
    assert.deepEqual(posted, {
      '/members/**': [{ key: 'x-aem-cug-required', value: 'true' }],
      '/partners/**': [{ key: 'x-aem-cug-groups', value: 'gold,silver' }],
    });
  });

  it('saves ordered browser values as multipart JSON and preserves sheet metadata', async () => {
    const source = {
      total: 1,
      limit: 1,
      offset: 0,
      data: [],
      ':colWidths': [102, 127, 182],
      ':sheetname': 'data',
      ':type': 'sheet',
    };
    let saved;
    await saveCugRows('/org/site', [
      { path: '/changed/**', authentication: true, groups: ['gold', 'silver'] },
      { path: '/other/**', authentication: false, groups: ['bronze'] },
      { path: '', authentication: false, groups: [] },
    ], async (url, options) => {
      assert.equal(url, 'https://admin.da.live/source/org/site/.da/cug/cug.json');
      if (options.method === 'PUT') {
        assert.ok(options.body instanceof FormData);
        saved = JSON.parse(await options.body.get('data').text());
        return { ok: true };
      }
      assert.equal(options.cache, 'no-store');
      return { ok: true, json: async () => source };
    });
    assert.deepEqual(saved, {
      ...source,
      total: 3,
      limit: 3,
      data: [
        { Path: '/changed/**', Authentication: 'true', Groups: 'gold,silver' },
        { Path: '/other/**', Authentication: '', Groups: 'bronze' },
        { Path: '', Authentication: '', Groups: '' },
      ],
    });
  });

  it('saves an empty table as an empty sheet', async () => {
    await saveCugRows('org/site', [], async (url, options) => {
      if (options.method === 'PUT') {
        const sheet = JSON.parse(await options.body.get('data').text());
        assert.deepEqual(sheet.data, []);
        assert.equal(sheet.total, 0);
        assert.equal(sheet.limit, 0);
        return { ok: true };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    });
  });

  it('creates a missing sheet when saving new rules', async () => {
    let saved;
    await saveCugRows('org/site', [
      { path: '/members/**', authentication: true, groups: [] },
    ], async (url, options) => {
      if (options.method === 'PUT') {
        saved = JSON.parse(await options.body.get('data').text());
        return { ok: true };
      }
      return { ok: false, status: 404 };
    });
    assert.deepEqual(saved, {
      total: 1,
      limit: 1,
      offset: 0,
      data: [{ Path: '/members/**', Authentication: 'true', Groups: '' }],
      ':sheetname': 'data',
      ':type': 'sheet',
    });
  });

  it('surfaces failed saves and never writes if the source cannot be read', async () => {
    await assert.rejects(saveCugRows('org/site', [], async (url, options) => (
      options.method === 'PUT'
        ? { ok: false, status: 403 }
        : { ok: true, json: async () => ({ data: [] }) }
    )), /save failed.*403/);
    await assert.rejects(saveCugRows('org/site', [], async (url, options) => {
      assert.notEqual(options.method, 'PUT');
      return { ok: false, status: 403 };
    }), /request failed.*403/);
  });
});

describe('fetchCugRows', () => {
  const sourceRows = [
    { Path: '/members/**', Authentication: 'true', Groups: '' },
    { Path: '/partners/**', Authentication: 'true', Groups: 'gold,silver' },
    { Path: '/partners/gold**', Authentication: '', Groups: 'gold' },
    { Path: '/partners/silver**', Authentication: '', Groups: 'silver' },
  ];
  const respond = (data) => async () => ({ ok: true, json: async () => ({ data }) });

  it('fetches DA source and maps all actual spreadsheet rows in order', async () => {
    let requestedUrl;
    let requestedOptions;
    const rows = await fetchCugRows('/jckautzmann/jck-ew1', async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return { ok: true, json: async () => ({ data: sourceRows }) };
    });
    assert.equal(requestedUrl, 'https://admin.da.live/source/jckautzmann/jck-ew1/.da/cug/cug.json');
    assert.deepEqual(requestedOptions, { cache: 'no-store' });
    assert.deepEqual(rows, [
      { path: '/members/**', authentication: true, groups: [] },
      { path: '/partners/**', authentication: true, groups: ['gold', 'silver'] },
      { path: '/partners/gold**', authentication: false, groups: ['gold'] },
      { path: '/partners/silver**', authentication: false, groups: ['silver'] },
    ]);
  });

  it('accepts org/site without leading slash and boolean authentication values', async () => {
    const rows = await fetchCugRows(' org/site/ ', respond([
      { Path: '/a', Authentication: false, Groups: 'gold, silver' },
      { Path: '/b', Authentication: true, Groups: '' },
    ]));
    assert.deepEqual(rows, [
      { path: '/a', authentication: false, groups: ['gold', 'silver'] },
      { path: '/b', authentication: true, groups: [] },
    ]);
  });

  it('preserves duplicate paths and blank rows without adding extra rows', async () => {
    const rows = await fetchCugRows('org/site', respond([
      { Path: '/a', Authentication: '' },
      { Path: '/a', Authentication: '' },
      {},
    ]));
    assert.deepEqual(rows.map((row) => row.path), ['/a', '/a', '']);
    assert.deepEqual(await fetchCugRows('org/site', respond([])), []);
  });

  it('rejects invalid site paths before making a request', async () => {
    await assert.rejects(fetchCugRows('/org/site/extra', () => {
      assert.fail('Should not fetch invalid input');
    }), /Enter an org\/site/);
  });

  it('treats a missing sheet as having no rules without parsing the error body', async () => {
    const rows = await fetchCugRows('org/site', async () => ({
      ok: false,
      status: 404,
      json: () => assert.fail('A missing sheet has no JSON source to parse'),
    }));
    assert.deepEqual(rows, []);
  });

  it('reports a missing or stale Authentication header instead of rendering empty values', async () => {
    await assert.rejects(fetchCugRows('org/site', respond([
      { Path: '/members/**', Authenticaction: 'true', Groups: '' },
    ])), /Missing Authentication column in row 1/);
  });

  it('surfaces HTTP, network, and malformed spreadsheet errors', async () => {
    await assert.rejects(fetchCugRows('org/site', async () => ({ ok: false, status: 403 })), /HTTP 403/);
    await assert.rejects(fetchCugRows('org/site', async () => { throw new Error('Network failed'); }), /Network failed/);
    await assert.rejects(fetchCugRows('org/site', respond(null)), /data sheet/);
    await assert.rejects(fetchCugRows('org/site', respond([null])), /row 1/);
    await assert.rejects(fetchCugRows('org/site', respond([{ Authentication: 'yes' }])), /Authentication/);
    await assert.rejects(fetchCugRows('org/site', respond([{ Authentication: '', Groups: 42 }])), /must be text/);
  });
});
