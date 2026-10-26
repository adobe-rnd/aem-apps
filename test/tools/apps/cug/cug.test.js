/* global AggregateError */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSiteExists, fetchCugState, generateCugHeaders,
  migrateCugSheet, saveCugRows, siteFromHash, siteKey,
} from '../../../../tools/apps/cug/data.js';

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

  it('rejects unsupported and malformed page URLs before making a request', async () => {
    await Promise.all([
      'https://example.com/path',
      'https://main--site--org.aem.live.example.com/path',
      'https://main--site.aem.page/path',
      'http://main--site--org.aem.live/path',
      'https://user:password@main--site--org.aem.live/path',
      'https://main--site--org.aem.live:8080/path',
      'https://',
    ].map((site) => (
      assert.rejects(assertSiteExists(site, () => assert.fail('Unexpected request')), /Enter an org\/site/)
    )));
  });
});

describe('CUG org/site initialization', () => {
  it('prefills the field from the forwarded DA hash without the leading slash', () => {
    assert.equal(siteFromHash('#/myOrg/mySite'), 'myOrg/mySite');
  });

  it('also accepts a site hash without a leading slash', () => {
    assert.equal(siteFromHash('#myOrg/mySite'), 'myOrg/mySite');
  });

  it('leaves the field empty when no site hash is supplied', () => {
    assert.equal(siteFromHash(''), '');
  });

  it('ignores unrelated URL fragments', () => {
    ['#section', '#/org', '#/org/site/extra', '#//org/site', 'org/site'].forEach((hash) => {
      assert.equal(siteFromHash(hash), '');
    });
  });
});

describe('CUG site identity', () => {
  it('uses the same key for equivalent org/site inputs and AEM URLs', () => {
    [
      'org/site', '/org/site', ' /org/site/ ',
      'https://main--site--org.aem.page/path',
      'https://branch--site--org.aem.live/other?query=value#section',
    ].forEach((site) => assert.equal(siteKey(site), 'org/site'));
    assert.notEqual(siteKey('org/other'), siteKey('org/site'));
    assert.notEqual(siteKey('other/site'), siteKey('org/site'));
  });

  it('reports invalid site inputs', () => {
    assert.throws(() => siteKey('invalid'), /Enter an org\/site/);
  });
});

describe('CUG org/site field formats', () => {
  [
    '/org/site',
    'org/site',
    'https://main--site--org.aem.page/path',
    'https://main--site--org.aem.live/path',
    ' https://feature-branch--site--org.aem.live/path?query=value#section ',
    'https://MAIN--SITE--ORG.aem.page/',
  ].forEach((site) => {
    it(`supports checking, loading, saving, and applying headers for ${site}`, async () => {
      const request = async (url, options) => {
        if (url === 'https://admin.da.live/list/org/') {
          return { ok: true, json: async () => [{ name: 'site' }] };
        }
        if (url === 'https://admin.da.live/source/org/site/.da/cug/cug.json') {
          return options.method === 'PUT'
            ? { ok: true }
            : {
              ok: true,
              json: async () => ({
                data: [{ Path: '/members/**', Authentication: 'true', Groups: '' }],
              }),
            };
        }
        if (url === 'https://admin.hlx.page/config/org/aggregated/site.json') {
          return { ok: true, json: async () => ({ headers: {} }) };
        }
        assert.equal(url, 'https://admin.hlx.page/config/org/sites/site/headers.json');
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), {
          '/members/**': [{ key: 'x-aem-cug-required', value: 'true' }],
        });
        return { ok: true };
      };
      await assertSiteExists(site, request);
      const { rows } = await fetchCugState(site, request);
      const sheet = await saveCugRows(site, rows, request);
      assert.deepEqual(await generateCugHeaders(site, sheet, request), {
        cugPaths: 1, totalPaths: 1,
      });
    });
  });

  it('infers hyphenated org/site names from an AEM URL and ignores its path', async () => {
    await assertSiteExists(
      'https://main--my-site--my-org.aem.live/path',
      async (url) => {
        assert.equal(url, 'https://admin.da.live/list/my-org/');
        return { ok: true, json: async () => [{ name: 'my-site' }] };
      },
    );
  });
});

describe('saveCugRows', () => {
  it('rejects every row with empty authentication and groups before any request', async () => {
    const rows = [
      { path: '/empty/**', authentication: '', groups: [] },
      { path: '/public/**', authentication: 'false', groups: [] },
      { path: '/whitespace/**', authentication: '', groups: [' ', ''] },
    ];
    const messages = [1, 3].map((index) => (
      `Invalid rule in row ${index}. Set Authentication or add at least one group.`
    ));
    const checkErrors = (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors.map((detail) => detail.message), messages);
      return true;
    };
    const request = () => assert.fail('Empty rules must not trigger requests');
    await assert.rejects(saveCugRows('org/site', rows, request), checkErrors);
    await assert.rejects(generateCugHeaders('org/site', {
      data: rows.map(({ path, authentication, groups }) => ({
        Path: path, Authentication: authentication, Groups: groups.join(','),
      })),
    }, request), checkErrors);
  });

  it('reports every malformed row in source order before any save or config request', async () => {
    const rows = [
      { path: 'members/**', authentication: 'true', groups: [] },
      { path: '/valid/**', authentication: 'true', groups: [] },
      { path: '', authentication: 'false', groups: [] },
      { path: '/public/**', authentication: 'false', groups: [] },
      { path: 'partners/**', authentication: '', groups: ['gold'] },
    ];
    const messages = [1, 3, 5].map((index) => (
      `Invalid Path in row ${index}. Enter a path starting with /.`
    ));
    const checkErrors = (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, messages.join(' '));
      assert.deepEqual(error.errors.map((detail) => detail.message), messages);
      return true;
    };
    const request = () => assert.fail('Invalid rules must not trigger requests');
    await assert.rejects(saveCugRows('org/site', rows, request), checkErrors);
    await assert.rejects(generateCugHeaders('org/site', {
      data: rows.map(({ path, authentication, groups }) => ({
        Path: path, Authentication: authentication, Groups: groups.join(','),
      })),
    }, request), checkErrors);
  });

  it('rejects malformed paths before saving or making any request', async () => {
    await Promise.all(['members/**', ' members/** ', 'https://example.com/members'].map((path) => (
      assert.rejects(
        saveCugRows('org/site', [
          { path: '/valid/**', authentication: 'true', groups: [] },
          { path, authentication: 'true', groups: [] },
        ], () => assert.fail('Invalid paths must not trigger requests')),
        /Invalid Path in row 2.*starting with \//,
      )
    )));
  });

  it('always rejects empty paths regardless of authentication or groups', async () => {
    await Promise.all(['', ' \t ', undefined, null].flatMap((path) => [
      { path, authentication: 'true', groups: [] },
      { path, authentication: 'false', groups: [] },
      { path, authentication: true, groups: [] },
      { path, authentication: false, groups: [] },
      { path, authentication: '', groups: ['gold'] },
      { path, authentication: '', groups: [] },
    ]).map(async (row) => {
      const request = () => assert.fail('Empty paths must not trigger requests');
      await assert.rejects(
        saveCugRows('org/site', [row], request),
        /Invalid Path in row 1.*starting with \//,
      );
      await assert.rejects(
        generateCugHeaders('org/site', {
          data: [{
            Path: row.path,
            Authentication: row.authentication,
            Groups: row.groups.join(','),
          }],
        }, request),
        /Invalid Path in row 1.*starting with \//,
      );
    }));
  });

  it('rejects invalid saved paths before reading or replacing live headers', async () => {
    await Promise.all(['members/**', '', '   '].map((Path) => (
      assert.rejects(
        generateCugHeaders('org/site', {
          data: [
            { Path: '/valid/**', Authentication: 'true', Groups: '' },
            { Path, Authentication: 'true', Groups: '' },
          ],
        }, () => assert.fail('Invalid rules must not trigger config requests')),
        /Invalid Path in row 2.*starting with \//,
      )
    )));
  });

  it('trims valid paths when applying headers', async () => {
    await generateCugHeaders('org/site', {
      data: [
        { Path: ' /members/** ', Authentication: 'true', Groups: '' },
      ],
    }, async (url, options) => {
      if (options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), {
          '/members/**': [{ key: 'x-aem-cug-required', value: 'true' }],
        });
        return { ok: true };
      }
      assert.equal(options.method, undefined);
      return { ok: true, json: async () => ({ headers: {} }) };
    });
  });

  it('generates headers from the saved app spreadsheet format for the selected site', async () => {
    let posted;
    await generateCugHeaders('/org/site', {
      data: [
        { Path: '/members/**', Authentication: 'true', Groups: '' },
        { Path: '/public/**', Authentication: 'false', Groups: '' },
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
      '/public/**': [{ key: 'x-aem-cug-required', value: 'false' }],
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
      total: 2,
      limit: 2,
      data: [
        { Path: '/changed/**', Authentication: 'true', Groups: 'gold,silver' },
        { Path: '/other/**', Authentication: 'false', Groups: 'bronze' },
      ],
    });
  });

  it('round-trips all three authentication values without converting false to empty', async () => {
    const rows = [
      { path: '/required', authentication: 'true', groups: [] },
      { path: '/not-required', authentication: 'false', groups: [] },
      { path: '/unset', authentication: '', groups: ['gold'] },
    ];
    let sheet = { data: [] };
    const request = async (url, options) => {
      if (options.method === 'PUT') {
        sheet = JSON.parse(await options.body.get('data').text());
        return { ok: true };
      }
      return { ok: true, json: async () => sheet };
    };
    const saved = await saveCugRows('org/site', rows, request);
    assert.deepEqual(saved.data.map((row) => row.Authentication), ['true', 'false', '']);
    assert.deepEqual((await fetchCugState('org/site', request)).rows, rows);
  });

  it('rejects invalid authentication values instead of silently saving a different state', async () => {
    await Promise.all(['yes', 0, '0'].map((authentication) => (
      assert.rejects(saveCugRows('org/site', [
        { path: '/a', authentication, groups: [] },
      ], async (url, options) => {
        assert.notEqual(options.method, 'PUT');
        return { ok: true, json: async () => ({ data: [] }) };
      }), /Invalid Authentication value in row 1/)
    )));
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

describe('migrateCugSheet', () => {
  const currentUrl = 'https://admin.da.live/source/org/site/.da/cug/cug.json';
  const legacyUrl = 'https://admin.da.live/source/org/site/closed-user-groups.json';
  const missing = { ok: false, status: 404 };

  it('translates legacy columns and preserves rules through loading, editing, saving, and applying', async () => {
    const legacy = {
      total: 3,
      limit: 3,
      offset: 0,
      ':sheetname': 'data',
      ':type': 'sheet',
      ':colWidths': [200, 100, 150, 200],
      data: [
        {
          url: '/partners/**',
          'cug-required': ' TRUE ',
          'cug-groups': 'gold, silver',
          'cug-login-path': 'https://idp.example.com/login',
          Extra: 'preserved',
        },
        { url: '/public/**', 'cug-required': false },
        { url: '/groups/**', 'cug-groups': 'gold' },
      ],
    };
    const original = JSON.stringify(legacy);
    let destination = null;
    let posted;
    const request = async (url, options = {}) => {
      if (url === currentUrl) {
        if (options.method === 'PUT') {
          destination = JSON.parse(await options.body.get('data').text());
          return { ok: true };
        }
        return destination === null ? missing : { ok: true, json: async () => destination };
      }
      if (url === legacyUrl) {
        assert.equal(options.method, undefined);
        return { ok: true, json: async () => legacy };
      }
      if (url === 'https://admin.hlx.page/config/org/aggregated/site.json') {
        return { ok: true, json: async () => ({ headers: {} }) };
      }
      assert.equal(url, 'https://admin.hlx.page/config/org/sites/site/headers.json');
      assert.equal(options.method, 'POST');
      posted = JSON.parse(options.body);
      return { ok: true };
    };
    await migrateCugSheet('org/site', request);
    assert.deepEqual(Object.keys(destination.data[0]), [
      'Path', 'Authentication', 'Groups', 'Extra',
    ]);
    assert.deepEqual(destination, {
      ...legacy,
      data: [
        {
          Path: '/partners/**',
          Authentication: 'true',
          Groups: 'gold, silver',
          Extra: 'preserved',
        },
        { Path: '/public/**', Authentication: 'false', Groups: '' },
        { Path: '/groups/**', Authentication: '', Groups: 'gold' },
      ],
    });
    assert.equal(JSON.stringify(legacy), original);
    const { rows } = await fetchCugState('org/site', request);
    assert.deepEqual(rows, [
      {
        path: '/partners/**',
        authentication: 'true',
        groups: ['gold', 'silver'],
      },
      { path: '/public/**', authentication: 'false', groups: [] },
      { path: '/groups/**', authentication: '', groups: ['gold'] },
    ]);
    rows[0].path = '/renamed/**';
    const saved = await saveCugRows('org/site', [rows[1], rows[0], ...rows.slice(2)], request);
    assert.equal(Object.hasOwn(saved.data[1], 'Login Path'), false);
    assert.equal(Object.hasOwn(saved.data[1], 'cug-login-path'), false);
    await generateCugHeaders('org/site', saved, request);
    assert.deepEqual(posted, {
      '/public/**': [{ key: 'x-aem-cug-required', value: 'false' }],
      '/renamed/**': [
        { key: 'x-aem-cug-required', value: 'true' },
        { key: 'x-aem-cug-groups', value: 'gold,silver' },
      ],
      '/groups/**': [{ key: 'x-aem-cug-groups', value: 'gold' }],
    });
  });

  it('rejects malformed legacy rules before writing a destination', async () => {
    await Promise.all([
      { data: [null] },
      { data: [{ url: 'members/**', 'cug-required': 'true' }] },
      { data: [{ url: '', 'cug-required': 'true' }] },
      { data: [{ url: ' \t ', 'cug-required': false }] },
      { data: [{ 'cug-groups': 'gold' }] },
      { data: [{ url: '/members/**', 'cug-required': 'yes' }] },
      { data: [{ url: '/members/**', 'cug-groups': 42 }] },
      { data: [{ url: '/members/**', 'cug-required': '', 'cug-groups': '' }] },
      { data: [{ url: '/members/**', 'cug-login-path': '/login' }] },
      { data: [{}] },
      { data: [{ url: '/members/**', Path: '/different/**' }] },
      { data: [{ Unknown: 'not a rule' }] },
    ].map((legacy) => (
      assert.rejects(migrateCugSheet('org/site', async (url, options) => {
        assert.notEqual(options.method, 'PUT');
        return url === currentUrl ? missing : { ok: true, json: async () => legacy };
      }), /row 1/)
    )));
  });

  it('omits legacy login paths, including sheets using app columns', async () => {
    const legacy = {
      data: [
        { url: '/members/**', 'cug-required': true, 'cug-login-path': 42 },
        { Path: '/public/**', Authentication: 'false', 'cug-login-path': '/other-login' },
      ],
    };
    const original = JSON.stringify(legacy);
    await migrateCugSheet('org/site', async (url, options) => {
      if (options.method === 'PUT') {
        const saved = JSON.parse(await options.body.get('data').text());
        assert.deepEqual(saved.data, [
          { Path: '/members/**', Authentication: 'true', Groups: '' },
          { Path: '/public/**', Authentication: 'false' },
        ]);
        return { ok: true };
      }
      return url === currentUrl ? missing : { ok: true, json: async () => legacy };
    });
    assert.equal(JSON.stringify(legacy), original);
  });

  it('preserves duplicate paths while normalizing legacy authentication', async () => {
    const legacy = {
      data: [
        { url: '/members/**', 'cug-required': true },
        { url: '/members/**', 'cug-required': ' FALSE ' },
      ],
    };
    await migrateCugSheet('org/site', async (url, options) => {
      if (options.method === 'PUT') {
        const saved = JSON.parse(await options.body.get('data').text());
        assert.deepEqual(saved.data, [
          { Path: '/members/**', Authentication: 'true', Groups: '' },
          { Path: '/members/**', Authentication: 'false', Groups: '' },
        ]);
        return { ok: true };
      }
      return url === currentUrl ? missing : { ok: true, json: async () => legacy };
    });
  });

  it('retains spreadsheets already using app columns and loads through the existing parser', async () => {
    const legacy = {
      total: 3,
      limit: 3,
      offset: 0,
      ':sheetname': 'data',
      ':type': 'sheet',
      ':colWidths': [200, 100, 150],
      data: [
        {
          Path: '/members/**', Authentication: true, Groups: '', Extra: 'preserved',
        },
        { Path: '/partners/**', Authentication: false, Groups: 'gold, silver' },
        { Path: '/public/**', Authentication: 'false', Groups: '' },
      ],
    };
    const original = JSON.stringify(legacy);
    const requested = [];
    let copied = null;
    const request = async (url, options) => {
      requested.push({ url, method: options.method ?? 'GET' });
      if (options.method === 'PUT') {
        assert.equal(url, currentUrl);
        assert.equal(options.body.get('data').type, 'application/json');
        copied = JSON.parse(await options.body.get('data').text());
        return { ok: true };
      }
      assert.equal(options.cache, 'no-store');
      if (url === currentUrl) {
        return copied === null ? missing : { ok: true, json: async () => copied };
      }
      assert.equal(url, legacyUrl);
      return { ok: true, json: async () => legacy };
    };
    const result = await migrateCugSheet('https://main--site--org.aem.page/path', request);
    assert.deepEqual(result, legacy);
    assert.deepEqual(copied, legacy);
    assert.equal(JSON.stringify(legacy), original);
    assert.deepEqual(requested, [
      { url: currentUrl, method: 'GET' },
      { url: legacyUrl, method: 'GET' },
      { url: currentUrl, method: 'PUT' },
    ]);
    assert.deepEqual((await fetchCugState('/org/site', request)).rows, [
      { path: '/members/**', authentication: 'true', groups: [] },
      { path: '/partners/**', authentication: 'false', groups: ['gold', 'silver'] },
      { path: '/public/**', authentication: 'false', groups: [] },
    ]);
  });

  it('copies an empty spreadsheet without synthesizing or changing metadata', async () => {
    const legacy = { data: [], ':sheetname': 'data' };
    await migrateCugSheet('org/site', async (url, options) => {
      if (options.method === 'PUT') {
        assert.equal(url, currentUrl);
        assert.deepEqual(JSON.parse(await options.body.get('data').text()), legacy);
        return { ok: true };
      }
      return url === currentUrl ? missing : { ok: true, json: async () => legacy };
    });
  });

  it('refuses to overwrite an existing destination, including an empty one', async () => {
    await Promise.all([[], [{ Path: '/existing', Authentication: 'true' }]].map((data) => (
      assert.rejects(migrateCugSheet('org/site', async (url, options) => {
        assert.equal(url, currentUrl);
        assert.notEqual(options.method, 'PUT');
        return { ok: true, json: async () => ({ data }) };
      }), /already exists.*Click Load/)
    )));
  });

  it('does not write if the legacy spreadsheet has disappeared', async () => {
    await assert.rejects(migrateCugSheet('/org/site', async (url, options) => {
      assert.notEqual(options.method, 'PUT');
      return missing;
    }), /legacy spreadsheet was not found/);
  });

  it('surfaces access and server failures at either read without writing', async () => {
    await Promise.all([currentUrl, legacyUrl].flatMap((target) => (
      [401, 403, 500].map((status) => (
        assert.rejects(migrateCugSheet('org/site', async (url, options) => {
          assert.notEqual(options.method, 'PUT');
          return url === target ? { ok: false, status } : missing;
        }), new RegExp(`HTTP ${status}`))
      ))
    )));
  });

  it('does not write malformed spreadsheets', async () => {
    await assert.rejects(migrateCugSheet('org/site', async (url, options) => {
      assert.notEqual(options.method, 'PUT');
      return url === currentUrl ? missing : { ok: true, json: async () => ({}) };
    }), /must contain a data sheet/);
  });

  it('reports copy write failures', async () => {
    await Promise.all([403, 500].map((status) => (
      assert.rejects(migrateCugSheet('org/site', async (url, options) => {
        if (options.method === 'PUT') {
          assert.equal(url, currentUrl);
          return { ok: false, status };
        }
        return url === currentUrl ? missing : { ok: true, json: async () => ({ data: [] }) };
      }), new RegExp(`save failed.*${status}`))
    )));
  });

  it('surfaces network failures instead of reporting success', async () => {
    await assert.rejects(migrateCugSheet('org/site', async (url, options) => {
      if (options.method === 'PUT') throw new Error('Network failed');
      return url === currentUrl ? missing : { ok: true, json: async () => ({ data: [] }) };
    }), /Network failed/);
  });

  it('validates the site before making requests', async () => {
    await assert.rejects(migrateCugSheet('invalid', () => assert.fail('Unexpected request')), /Enter an org\/site/);
  });
});

describe('fetchCugState legacy detection', () => {
  const currentUrl = 'https://admin.da.live/source/org/site/.da/cug/cug.json';
  const legacyUrl = 'https://admin.da.live/source/org/site/closed-user-groups.json';
  const missing = () => ({
    ok: false,
    status: 404,
    json: () => assert.fail('Do not parse missing spreadsheet responses'),
  });

  it('detects a legacy sheet only when the new sheet is missing, without loading legacy rules', async () => {
    const requested = [];
    const state = await fetchCugState('https://main--site--org.aem.live/path', async (url, options) => {
      requested.push(url);
      assert.deepEqual(options, { cache: 'no-store' });
      if (url === currentUrl) return missing();
      assert.equal(url, legacyUrl);
      return {
        ok: true,
        json: async () => ({ data: [{ url: '/members/**', 'cug-required': 'true' }] }),
      };
    });
    assert.deepEqual(requested, [currentUrl, legacyUrl]);
    assert.deepEqual(state, { rows: [], hasLegacySheet: true });
  });

  it('recognizes an empty legacy sheet as existing', async () => {
    const state = await fetchCugState('org/site', async (url) => (
      url === currentUrl ? missing() : { ok: true, json: async () => ({ data: [] }) }
    ));
    assert.deepEqual(state, { rows: [], hasLegacySheet: true });
  });

  it('does not check the legacy sheet when a new sheet exists, even if empty', async () => {
    await Promise.all([[], [{ Path: '/a', Authentication: 'false', Groups: '' }]].map(async (data) => {
      const state = await fetchCugState('/org/site', async (url) => {
        assert.equal(url, currentUrl);
        return { ok: true, json: async () => ({ data }) };
      });
      assert.equal(state.hasLegacySheet, false);
      assert.equal(state.rows.length, data.length);
    }));
  });

  it('reports no legacy sheet when both spreadsheets are missing', async () => {
    const requested = [];
    const state = await fetchCugState('org/site', async (url) => {
      requested.push(url);
      return missing();
    });
    assert.deepEqual(state, { rows: [], hasLegacySheet: false });
    assert.deepEqual(requested, [currentUrl, legacyUrl]);
  });

  it('does not treat current-sheet access or server errors as missing', async () => {
    await Promise.all([401, 403, 500].map((status) => (
      assert.rejects(fetchCugState('org/site', async (url) => {
        assert.equal(url, currentUrl);
        return { ok: false, status };
      }), new RegExp(`HTTP ${status}`))
    )));
  });

  it('surfaces legacy-sheet access and server errors instead of reporting absence', async () => {
    await Promise.all([401, 403, 500].map((status) => (
      assert.rejects(fetchCugState('org/site', async (url) => (
        url === currentUrl ? missing() : { ok: false, status }
      )), new RegExp(`HTTP ${status}`))
    )));
  });

  it('reports malformed current and legacy spreadsheets', async () => {
    await Promise.all([currentUrl, legacyUrl].map((target) => (
      assert.rejects(fetchCugState('org/site', async (url) => (
        url === target ? { ok: true, json: async () => ({}) } : missing()
      )), /must contain a data sheet/)
    )));
  });

  it('surfaces network failures when reading either spreadsheet', async () => {
    await Promise.all([currentUrl, legacyUrl].map((target) => (
      assert.rejects(fetchCugState('org/site', async (url) => {
        if (url === target) throw new Error('Network failed');
        return missing();
      }), /Network failed/)
    )));
  });
});

describe('fetchCugState row parsing', () => {
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
    const { rows } = await fetchCugState('/myOrg/mySite', async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return { ok: true, json: async () => ({ data: sourceRows }) };
    });
    assert.equal(requestedUrl, 'https://admin.da.live/source/myOrg/mySite/.da/cug/cug.json');
    assert.deepEqual(requestedOptions, { cache: 'no-store' });
    assert.deepEqual(rows, [
      { path: '/members/**', authentication: 'true', groups: [] },
      { path: '/partners/**', authentication: 'true', groups: ['gold', 'silver'] },
      { path: '/partners/gold**', authentication: '', groups: ['gold'] },
      { path: '/partners/silver**', authentication: '', groups: ['silver'] },
    ]);
  });

  it('accepts org/site without leading slash and boolean authentication values', async () => {
    const { rows } = await fetchCugState(' org/site/ ', respond([
      { Path: '/a', Authentication: false, Groups: 'gold, silver' },
      { Path: '/b', Authentication: true, Groups: '' },
    ]));
    assert.deepEqual(rows, [
      { path: '/a', authentication: 'false', groups: ['gold', 'silver'] },
      { path: '/b', authentication: 'true', groups: [] },
    ]);
  });

  it('distinguishes true, false, and empty text values', async () => {
    const { rows } = await fetchCugState('org/site', respond([
      { Authentication: 'true' },
      { Authentication: 'false' },
      { Authentication: '' },
      {},
    ]));
    assert.deepEqual(rows.map((row) => row.authentication), ['true', 'false', '', '']);
  });

  it('preserves duplicate paths and blank rows without adding extra rows', async () => {
    const { rows } = await fetchCugState('org/site', respond([
      { Path: '/a', Authentication: '' },
      { Path: '/a', Authentication: '' },
      {},
    ]));
    assert.deepEqual(rows.map((row) => row.path), ['/a', '/a', '']);
    assert.deepEqual((await fetchCugState('org/site', respond([]))).rows, []);
  });

  it('rejects invalid site paths before making a request', async () => {
    await assert.rejects(fetchCugState('/org/site/extra', () => {
      assert.fail('Should not fetch invalid input');
    }), /Enter an org\/site/);
  });

  it('treats a missing sheet as having no rules without parsing the error body', async () => {
    const { rows } = await fetchCugState('org/site', async () => ({
      ok: false,
      status: 404,
      json: () => assert.fail('A missing sheet has no JSON source to parse'),
    }));
    assert.deepEqual(rows, []);
  });

  it('reports a missing or stale Authentication header instead of rendering empty values', async () => {
    await assert.rejects(fetchCugState('org/site', respond([
      { Path: '/members/**', Authenticaction: 'true', Groups: '' },
    ])), /Missing Authentication column in row 1/);
  });

  it('surfaces HTTP, network, and malformed spreadsheet errors', async () => {
    await assert.rejects(fetchCugState('org/site', async () => ({ ok: false, status: 403 })), /HTTP 403/);
    await assert.rejects(fetchCugState('org/site', async () => { throw new Error('Network failed'); }), /Network failed/);
    await assert.rejects(fetchCugState('org/site', respond(null)), /data sheet/);
    await assert.rejects(fetchCugState('org/site', respond([null])), /row 1/);
    await assert.rejects(fetchCugState('org/site', respond([{ Authentication: 'yes' }])), /Authentication/);
    await assert.rejects(fetchCugState('org/site', respond([{ Authentication: '', Groups: 42 }])), /must be text/);
  });
});
