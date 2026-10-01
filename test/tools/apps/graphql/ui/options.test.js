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
import { createDraft } from '../../../../../tools/apps/graphql/ui/endpoint-screen/helpers/draft.js';
import {
  countChanges, filterSchemaOptions, getSchemaOptions, getSchemaStatus, sortSchemaOptions,
} from '../../../../../tools/apps/graphql/ui/schemas-panel/helpers/options.js';

const product = {
  type: 'object',
  properties: { title: { type: 'string' } },
};

const loaded = (id, schema = product) => ({
  id, status: 'loaded', schema, valid: true, issues: [],
});

describe('schema options', () => {
  it('lists schemas panel options including missing selections', () => {
    const draft = { ...createDraft(), schemas: ['gone', 'product'] };
    const schemas = [
      loaded('product', { ...product, title: 'Product' }),
      {
        id: 'broken', status: 'invalid-json', valid: false, issues: ['Bad JSON.'],
      },
    ];
    assert.deepEqual(getSchemaOptions({ draft, schemas }), [
      {
        id: 'product', title: 'Product', selected: true, usable: true, issues: [],
      },
      {
        id: 'broken', title: undefined, selected: false, usable: false, issues: ['Bad JSON.'],
      },
      {
        id: 'gone', selected: true, usable: false, missing: true, issues: ['This schema no longer exists.'],
      },
    ]);
  });

  it('marks schemas the draft adds or removes against the saved endpoint', () => {
    const draft = { ...createDraft(), schemas: ['article', 'product'] };
    const schemas = [loaded('article', product), loaded('product', product), loaded('page', product)];
    const changes = (saved) => getSchemaOptions({ draft, schemas, saved })
      .map(({ id, change }) => [id, change]);
    assert.deepEqual(changes(['product', 'page', 'gone']), [
      ['article', 'adding'], ['product', undefined], ['page', 'removing'], ['gone', 'removing'],
    ]);
    assert.deepEqual(changes(undefined), [
      ['article', undefined], ['product', undefined], ['page', undefined],
    ]);
    assert.deepEqual(countChanges(getSchemaOptions({ draft, schemas, saved: ['product', 'page', 'gone'] })), { adding: 1, removing: 2 });
  });

  it('filters schema options by id or title', () => {
    const options = [
      { id: 'product', title: 'Catalog Product' },
      { id: 'article', title: 'Blog Article' },
      { id: 'gone' },
    ];
    const ids = (query) => filterSchemaOptions({ options, query }).map(({ id }) => id);
    assert.deepEqual(ids(''), ['product', 'article', 'gone']);
    assert.deepEqual(ids('  '), ['product', 'article', 'gone']);
    assert.deepEqual(ids(undefined), ['product', 'article', 'gone']);
    assert.deepEqual(ids('PROD'), ['product']);
    assert.deepEqual(ids('blog'), ['article']);
    assert.deepEqual(ids(' on '), ['gone']);
    assert.deepEqual(ids('zzz'), []);
  });

  it('filters schema options by their status label', () => {
    const options = [
      { id: 'product', title: 'Product' },
      { id: 'article', title: 'Article' },
      { id: 'gone' },
    ];
    const labels = { product: 'Invalid', gone: 'Not found' };
    const ids = (query) => filterSchemaOptions({
      options, query, statusLabel: ({ id }) => labels[id],
    }).map(({ id }) => id);
    assert.deepEqual(ids('inval'), ['product']);
    assert.deepEqual(ids('NOT FOUND'), ['gone']);
    assert.deepEqual(ids('art'), ['article']);
  });

  it('sorts schema options by title, id and status', () => {
    const options = [
      { id: 'page', selected: true, usable: true },
      { id: 'Faq', title: 'faq', usable: true },
      {
        id: 'article', title: 'Blog Article', selected: true, usable: false,
      },
      {
        id: 'product', title: 'Catalog Product', selected: true, usable: true,
      },
      { id: 'event', title: 'Blog Article', usable: true },
      {
        id: 'news', title: 'News', selected: true, usable: true, change: 'adding',
      },
    ];
    const ids = (key, direction) => sortSchemaOptions({ options, key, direction })
      .map(({ id }) => id);
    assert.deepEqual(ids(), ['article', 'event', 'product', 'Faq', 'news', 'page']);
    assert.deepEqual(ids('id'), ['article', 'event', 'Faq', 'news', 'page', 'product']);
    assert.deepEqual(ids('id', 'descending'), ['product', 'page', 'news', 'Faq', 'event', 'article']);
    assert.deepEqual(ids('title', 'descending'), ['page', 'news', 'Faq', 'product', 'article', 'event']);
    assert.deepEqual(ids('status'), ['article', 'news', 'event', 'Faq', 'page', 'product']);
    assert.deepEqual(ids('status', 'descending'), ['news', 'article', 'event', 'Faq', 'page', 'product']);
    assert.equal(options[0].id, 'page');
  });

  it('derives the status of a schema row', () => {
    assert.equal(getSchemaStatus({ selected: true, usable: true }), undefined);
    assert.equal(getSchemaStatus({ selected: false, usable: true }), undefined);
    assert.equal(getSchemaStatus({ selected: true, usable: false }), 'invalid');
    assert.equal(getSchemaStatus({ selected: false, usable: false }), 'invalid');
    assert.equal(getSchemaStatus({ selected: true, usable: false, missing: true }), 'missing');
    assert.equal(getSchemaStatus({ selected: true, usable: true, change: 'adding' }), 'adding');
    assert.equal(getSchemaStatus({ usable: false, missing: true, change: 'removing' }), 'removing');
  });
});
