import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCugHeaders, fetchExistingNonCugHeaders, postHeaders, transformToHeadersConfig,
} from '../../../../tools/plugins/cug/headers.js';

describe('CUG header generation', () => {
  it('emits true and false for boolean values and omits empty authentication headers', () => {
    assert.deepEqual(transformToHeadersConfig([
      { url: '/required', 'cug-required': true },
      { url: '/not-required', 'cug-required': false },
      { url: '/unset', 'cug-required': '' },
      { url: '/null', 'cug-required': null },
      { url: '/groups-only', 'cug-required': '', 'cug-groups': 'gold' },
      { url: '/login-only', 'cug-login-path': '/login' },
    ]), {
      '/required': [{ key: 'x-aem-cug-required', value: 'true' }],
      '/not-required': [{ key: 'x-aem-cug-required', value: 'false' }],
      '/groups-only': [{ key: 'x-aem-cug-groups', value: 'gold' }],
      '/login-only': [{ key: 'x-aem-cug-login-path', value: '/login' }],
    });
  });

  it('preserves plugin column semantics, login paths, and first valid duplicate', () => {
    assert.deepEqual(transformToHeadersConfig([
      {
        url: ' /members/** ', 'cug-required': ' TRUE ', 'cug-groups': 'gold,silver', 'cug-login-path': '/login',
      },
      { url: '/members/**', 'cug-required': 'false' },
      { url: '/public/**', 'cug-required': 'false' },
      { url: 'invalid', 'cug-required': 'true' },
      { url: '/empty' },
    ]), {
      '/members/**': [
        { key: 'x-aem-cug-required', value: 'true' },
        { key: 'x-aem-cug-groups', value: 'gold,silver' },
        { key: 'x-aem-cug-login-path', value: '/login' },
      ],
      '/public/**': [{ key: 'x-aem-cug-required', value: 'false' }],
    });
  });

  it('replaces stale CUG headers and preserves all unrelated headers', async () => {
    let posted;
    const result = await applyCugHeaders('org', 'site', [
      { url: '/members/**', 'cug-required': 'true', 'cug-groups': 'gold' },
    ], async (url, options) => {
      if (options.method === 'POST') {
        assert.equal(url, 'https://admin.hlx.page/config/org/sites/site/headers.json');
        posted = JSON.parse(options.body);
        return { ok: true };
      }
      assert.equal(url, 'https://admin.hlx.page/config/org/aggregated/site.json');
      return {
        ok: true,
        json: async () => ({
          headers: {
            '/members/**': [
              { key: 'cache-control', value: 'no-cache' },
              { key: 'x-aem-cug-required', value: 'false' },
              { key: 'x-aem-cug-login-path', value: '/old-login' },
            ],
            '/old/**': [{ key: 'x-aem-cug-groups', value: 'old' }],
            '/other/**': [{ key: 'x-custom', value: 'keep' }],
          },
        }),
      };
    });
    assert.deepEqual(posted, {
      '/members/**': [
        { key: 'cache-control', value: 'no-cache' },
        { key: 'x-aem-cug-required', value: 'true' },
        { key: 'x-aem-cug-groups', value: 'gold' },
      ],
      '/other/**': [{ key: 'x-custom', value: 'keep' }],
    });
    assert.deepEqual(result, { cugPaths: 1, totalPaths: 2 });
  });

  it('replaces true with explicit false and removes the required header when unset', async () => {
    await applyCugHeaders('org', 'site', [
      { url: '/not-required', 'cug-required': 'false' },
      { url: '/unset', 'cug-required': '', 'cug-groups': 'gold' },
    ], async (url, options) => {
      if (options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), {
          '/not-required': [{ key: 'x-aem-cug-required', value: 'false' }],
          '/unset': [
            { key: 'cache-control', value: 'no-cache' },
            { key: 'x-aem-cug-groups', value: 'gold' },
          ],
        });
        return { ok: true };
      }
      return {
        ok: true,
        json: async () => ({
          headers: {
            '/not-required': [{ key: 'x-aem-cug-required', value: 'true' }],
            '/unset': [
              { key: 'cache-control', value: 'no-cache' },
              { key: 'x-aem-cug-required', value: 'false' },
            ],
          },
        }),
      };
    });
  });

  it('deletes an empty header map and accepts only a DELETE 404 as success', async () => {
    await applyCugHeaders('org', 'site', [], async (url, options) => {
      if (options.method === 'DELETE') {
        assert.equal(options.body, undefined);
        return { ok: false, status: 404 };
      }
      return { ok: false, status: 404 };
    });
    await assert.rejects(postHeaders('org', 'site', {
      '/a': [{ key: 'x-aem-cug-required', value: 'true' }],
    }, async () => ({ ok: false, status: 404, text: async () => 'Not found' })), /POST failed.*404/);
  });

  it('reports config reads and writes failing without clearing existing configuration', async () => {
    await assert.rejects(fetchExistingNonCugHeaders('org', 'site', async () => ({
      ok: false, status: 403, text: async () => 'Forbidden',
    })), /read site config.*403/);
    await assert.rejects(applyCugHeaders('org', 'site', [], async (url, options) => {
      assert.notEqual(options.method, 'DELETE');
      throw new Error('Network failed');
    }), /Network failed/);
    await assert.rejects(postHeaders('org', 'site', {}, async () => ({
      ok: false, status: 500, text: async () => 'Failed',
    })), /DELETE failed.*500/);
  });

  it('keeps non-CUG headers when removing all rules', async () => {
    await applyCugHeaders('org', 'site', [], async (url, options) => {
      if (options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), {
          '/*': [{ key: 'x-custom', value: 'keep' }],
        });
        return { ok: true };
      }
      return {
        ok: true,
        json: async () => ({
          headers: {
            '/*': [{ key: 'x-custom', value: 'keep' }, { key: 'x-aem-cug-groups', value: 'old' }],
          },
        }),
      };
    });
  });
});
