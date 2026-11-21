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
  getEditorPathRoots, fetchConfigRoots, listSchemas, sourceUrl, toSitePath,
  parseScDocument, flattenForPreview, scanDocuments, buildBlockHtml,
} from '../../../../tools/plugins/structured-content/sc-source.js';

// Minimal DOM-like element: tagName, className, children, textContent.
function el(tagName, className, content = []) {
  const children = typeof content === 'string' ? [] : content;
  return {
    tagName: tagName.toUpperCase(),
    className,
    children,
    get textContent() {
      return typeof content === 'string' ? content : children.map((c) => c.textContent).join('');
    },
  };
}
const p = (text) => el('p', '', text);
const row = (key, value) => el('div', '', [el('div', '', [p(key)]), el('div', '', [value])]);
const block = (cls, rows) => el('div', cls, rows);
const main = (blocks) => el('main', '', [el('div', '', blocks)]);

describe('getEditorPathRoots', () => {
  const sheet = (rows) => ({ data: { data: rows } });

  it('reads editor.path rows for the current site', () => {
    const configs = [sheet([
      { key: 'editor.path', value: '/acme/web/coffees=https://da.live/form#' },
      { key: 'editor.path', value: '/acme/other/x=https://da.live/form#' },
      { key: 'editor.path', value: '/acme/web/docs=https://example.com/editor#' },
      { key: 'something', value: '/acme/web/y=https://da.live/form#' },
    ])];
    assert.deepEqual(getEditorPathRoots(configs, 'acme', 'web'), ['/coffees']);
  });

  it('accepts single-sheet configs, dedupes and collapses nested roots', () => {
    const configs = [
      { data: [{ key: 'editor.path', value: '/acme/web/products/=https://da.live/form#' }] },
      sheet([
        { key: 'editor.path', value: '/acme/web/products/shoes=https://da.live/form#' },
        { key: 'editor.path', value: '/acme/web/products=https://da.live/form#' },
        { key: 'editor.path', value: '/acme/webshop/a=https://da.live/form#' },
      ]),
    ];
    assert.deepEqual(getEditorPathRoots(configs, 'acme', 'web'), ['/products']);
  });

  it('maps a whole-site entry to the root', () => {
    const configs = [sheet([
      { key: 'editor.path', value: '/acme/web=https://da.live/form#' },
      { key: 'editor.path', value: '/acme/web/a=https://da.live/form#' },
    ])];
    assert.deepEqual(getEditorPathRoots(configs, 'acme', 'web'), ['']);
  });

  it('returns nothing for missing or malformed config', () => {
    assert.deepEqual(getEditorPathRoots([{}, sheet([{ key: 'editor.path', value: 'nope' }])], 'acme', 'web'), []);
  });
});

describe('fetchConfigRoots', () => {
  it('combines org and site config and tolerates failures', async () => {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (url.endsWith('/acme/')) {
        return { ok: true, json: async () => ({ data: { data: [{ key: 'editor.path', value: '/acme/web/a=https://da.live/form#' }] } }) };
      }
      return { ok: false };
    };
    const roots = await fetchConfigRoots({
      org: 'acme', repo: 'web', token: 't', fetchFn,
    });
    assert.deepEqual(roots, ['/a']);
    assert.deepEqual(calls, ['https://admin.da.live/config/acme/', 'https://admin.da.live/config/acme/web/']);
  });
});

describe('listSchemas', () => {
  it('returns sorted html schema names', async () => {
    const list = async (path) => {
      assert.equal(path, '/.da/forms/schemas');
      return {
        ok: true,
        items: [
          { name: 'product', ext: 'html' }, { name: 'coffee', ext: 'html' }, { name: 'x', ext: 'json' }, { name: 'sub' },
        ],
      };
    };
    assert.deepEqual(await listSchemas(list), ['coffee', 'product']);
  });
});

describe('urls', () => {
  it('builds source urls for both backends', () => {
    const args = { org: 'acme', repo: 'web', path: '/coffees/a' };
    assert.equal(sourceUrl({ ...args, hlx6: false }), 'https://admin.da.live/source/acme/web/coffees/a.html');
    assert.equal(sourceUrl({ ...args, hlx6: true }), 'https://api.aem.live/acme/sites/web/source/coffees/a.html');
  });

  it('converts list item paths to site paths', () => {
    assert.equal(toSitePath('/acme/web/coffees/a.html', 'acme', 'web'), '/coffees/a');
  });
});

describe('parseScDocument', () => {
  it('reads schema name and typed data', () => {
    const doc = main([
      block('da-form', [row('x-schema-name', p('coffee'))]),
      block('coffee', [
        row('name', p('Morning Muse')),
        row('price', p('9.5')),
        row('code', p('007')),
        row('organic', p('true')),
        row('notes', el('ul', '', [el('li', '', 'citrus'), el('li', '', 'cocoa')])),
        row('origin', p('self://#origin-1')),
      ]),
      block('coffee origin-1', [row('country', p('Kenya'))]),
    ]);
    assert.deepEqual(parseScDocument(doc), {
      schemaName: 'coffee',
      data: {
        name: 'Morning Muse',
        price: 9.5,
        code: '007',
        organic: true,
        notes: ['citrus', 'cocoa'],
        origin: { country: 'Kenya' },
      },
    });
  });

  it('returns null for regular documents', () => {
    assert.equal(parseScDocument(main([block('hero', [row('a', p('b'))])])), null);
    assert.equal(parseScDocument(null), null);
  });
});

describe('flattenForPreview', () => {
  it('flattens nested data into path/value rows', () => {
    assert.deepEqual(flattenForPreview({
      a: 1, b: { c: 'x' }, d: ['y', { e: false }], f: [],
    }), [
      ['a', '1'], ['b.c', 'x'], ['d[0]', 'y'], ['d[1].e', 'false'], ['f', ''],
    ]);
  });
});

describe('scanDocuments', () => {
  it('keeps SC documents only, survives load errors, reports progress', async () => {
    const progress = [];
    const docs = await scanDocuments({
      paths: ['/b', '/a', '/err', '/plain'],
      load: async (path) => {
        if (path === '/err') throw new Error('boom');
        if (path === '/plain') return null;
        return { schemaName: 's', data: { path } };
      },
      concurrency: 2,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    assert.deepEqual(docs.map((d) => d.path), ['/a', '/b']);
    assert.equal(progress.at(-1), '4/4');
  });
});

describe('buildBlockHtml', () => {
  it('emits an escaped structured-content block table', () => {
    assert.equal(
      buildBlockHtml('https://main--web--acme.aem.page/a?x="1"&y'),
      '<table><tbody><tr><td>structured-content</td></tr><tr><td><a href="https://main--web--acme.aem.page/a?x=&quot;1&quot;&amp;y">https://main--web--acme.aem.page/a?x=&quot;1&quot;&amp;y</a></td></tr></tbody></table>',
    );
  });
});
