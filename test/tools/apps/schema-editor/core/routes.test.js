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
import { expect } from '../expect.js';
import {
  SCREENS, parseRoute, routeHash, sameRoute,
} from '../../../../../tools/apps/schema-editor/core/routes.js';

describe('schema routes', () => {
  it('maps a missing hash or site to the none screen', () => {
    expect(parseRoute(null)).to.deep.equal({ screen: SCREENS.NONE });
    expect(parseRoute({ org: 'adobe', site: null })).to.deep.equal({ screen: SCREENS.NONE });
  });

  it('maps org/site to the browse screen', () => {
    expect(parseRoute({ org: 'adobe', site: 'docs', path: null }))
      .to.deep.equal({ screen: SCREENS.BROWSE, org: 'adobe', site: 'docs' });
  });

  it('maps org/site/name to the author screen, stripping .html', () => {
    const route = parseRoute({ org: 'adobe', site: 'docs', path: 'product-card.html' });
    expect(route).to.deep.equal({
      screen: SCREENS.AUTHOR, org: 'adobe', site: 'docs', name: 'product-card',
    });
  });

  it('falls back to browse for an invalid schema name', () => {
    const route = parseRoute({ org: 'adobe', site: 'docs', path: 'Bad Name' });
    expect(route.screen).to.equal(SCREENS.BROWSE);
    expect(route.invalidName).to.equal('Bad Name');
  });

  it('builds hashes back', () => {
    expect(routeHash({ org: 'adobe', site: 'docs' })).to.equal('#/adobe/docs');
    expect(routeHash({ org: 'adobe', site: 'docs', name: 'card' })).to.equal('#/adobe/docs/card');
    expect(routeHash({})).to.equal('#');
  });

  it('round-trips through parseRoute', () => {
    const route = {
      screen: SCREENS.AUTHOR, org: 'a', site: 'b', name: 'c',
    };
    const [, org, site, path] = routeHash(route).split('/');
    expect(sameRoute(parseRoute({ org, site, path }), route)).to.equal(true);
  });

  it('compares routes', () => {
    const a = { screen: SCREENS.BROWSE, org: 'a', site: 'b' };
    expect(sameRoute(a, { ...a })).to.equal(true);
    expect(sameRoute(a, { ...a, site: 'c' })).to.equal(false);
    expect(sameRoute(a, undefined)).to.equal(false);
  });
});
