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
import { getDeliveryUrl, rendererPath } from '../../blocks/structured-content/structured-content.js';

describe('rendererPath', () => {
  it('maps a schema name to its renderer module', () => {
    global.window = { hlx: { codeBasePath: '' } };
    assert.equal(rendererPath('Person'), '/blocks/structured-content/renderers/person.js');
    delete global.window;
  });

  it('rejects missing or unsafe schema names', () => {
    assert.equal(rendererPath(undefined), null);
    assert.equal(rendererPath('../x'), null);
    assert.equal(rendererPath('a/b'), null);
  });
});

describe('getDeliveryUrl', () => {
  const href = 'https://main--web--acme.aem.page/coffees/morning-muse';

  it('uses preview on aem.page and localhost', () => {
    const expected = 'https://da-sc.adobeaem.workers.dev/preview/acme/web/coffees/morning-muse';
    assert.equal(getDeliveryUrl(href, 'main--web--acme.aem.page'), expected);
    assert.equal(getDeliveryUrl(href, 'localhost'), expected);
  });

  it('uses live elsewhere and strips extensions', () => {
    assert.equal(
      getDeliveryUrl('https://main--web--acme.aem.live/coffees/a.html', 'www.acme.com'),
      'https://da-sc.adobeaem.workers.dev/live/acme/web/coffees/a',
    );
  });

  it('rejects non-EDS or invalid links', () => {
    assert.equal(getDeliveryUrl('https://example.com/a', 'localhost'), null);
    assert.equal(getDeliveryUrl('not a url', 'localhost'), null);
    assert.equal(getDeliveryUrl('https://main--web--acme.aem.page/', 'localhost'), null);
  });
});
