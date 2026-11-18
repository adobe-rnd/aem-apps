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
  folderIndex, folderState, setFolder, hasSeveralSites, folderPath,
} from '../../../../tools/apps/msm-next/data/folders.js';

const node = (path, site = 's') => ({ key: `${site}:${path}`, site, path });

const pages = [
  node('/index.html'),
  node('/products/a.html'),
  node('/products/b.html'),
  node('/products/shoes/x.html'),
  node('/products-old/z.html'),
  node('/about/team/y.html'),
];

describe('folderPath', () => {
  it('returns the folder segments of a page path', () => {
    assert.deepEqual(folderPath('/a/b/c.html'), ['a', 'b']);
    assert.deepEqual(folderPath('/index.html'), []);
  });
});

describe('folderIndex', () => {
  const folders = folderIndex(pages);

  it('lists every folder once, with sub-folders next to their parent', () => {
    assert.deepEqual(folders.map((folder) => folder.path), [
      '/about', '/about/team', '/products', '/products/shoes', '/products-old',
    ]);
  });

  it('counts pages in sub-folders too', () => {
    const products = folders.find((folder) => folder.path === '/products');
    assert.equal(products.keys.size, 3);
    assert.equal(products.depth, 0);
    assert.equal(folders.find((folder) => folder.path === '/products/shoes').depth, 1);
    assert.equal(folders.find((folder) => folder.path === '/about').keys.size, 1);
  });

  it('does not mix a folder with a sibling that shares a prefix', () => {
    const old = folders.find((folder) => folder.path === '/products-old');
    assert.deepEqual([...old.keys], ['s:/products-old/z.html']);
  });

  it('has no folder for root pages', () => {
    assert.equal(folderIndex([node('/index.html')]).length, 0);
  });

  it('keeps folders of different sites apart', () => {
    const mixed = folderIndex([node('/a/x.html', 's1'), node('/a/y.html', 's2')]);
    assert.equal(mixed.length, 2);
    assert.equal(hasSeveralSites(mixed), true);
    assert.equal(hasSeveralSites(folders), false);
  });
});

describe('folder selection', () => {
  const folders = folderIndex(pages);
  const products = folders.find((folder) => folder.path === '/products');
  const shoes = folders.find((folder) => folder.path === '/products/shoes');

  it('selects every page below a folder', () => {
    const picked = setFolder(new Set(), products, true);
    assert.deepEqual([...picked].sort(), [
      's:/products/a.html', 's:/products/b.html', 's:/products/shoes/x.html',
    ]);
  });

  it('keeps pages that were already picked elsewhere', () => {
    const picked = setFolder(new Set(['s:/index.html']), shoes, true);
    assert.equal(picked.has('s:/index.html'), true);
    assert.equal(picked.has('s:/products/shoes/x.html'), true);
  });

  it('unselects only the pages of the folder', () => {
    const start = new Set(['s:/index.html', 's:/products/a.html', 's:/products/b.html', 's:/products/shoes/x.html']);
    const picked = setFolder(start, products, false);
    assert.deepEqual([...picked], ['s:/index.html']);
    assert.equal(start.size, 4);
  });

  it('reports none, some and all', () => {
    assert.equal(folderState(products, new Set()), 'none');
    assert.equal(folderState(products, new Set(['s:/products/a.html'])), 'some');
    assert.equal(folderState(products, setFolder(new Set(), products, true)), 'all');
    assert.equal(folderState(products, setFolder(new Set(), shoes, true)), 'some');
  });

  it('shows a parent as all once every page below is picked one by one', () => {
    const picked = setFolder(setFolder(new Set(['s:/products/a.html', 's:/products/b.html']), shoes, true), shoes, true);
    assert.equal(folderState(products, picked), 'all');
  });
});
