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
import { parseConfig } from '../../../../../tools/localization/core/domain/config.js';

const loc = (site, path, language, source = '', actions = '') => ({
  site, path, language, source, actions,
});

const org = (...rows) => {
  const sites = {};
  rows.forEach(({ site, ...rest }) => {
    sites[site] ??= [];
    sites[site].push(rest);
  });
  return parseConfig({ sites });
};

const issuesFor = (model, id) => model.issues.filter((i) => i.id === id);
const codesFor = (model, id) => issuesFor(model, id).map((i) => i.code);

// global /en          en-US   (root)
// ├── global /uk      en-GB
// ├── global /emea/en en
// │   └── global /emea/es  es-ES
// │       └── brand-b /es  es-ES
// └── brand-b /       en-US
const tree = [
  loc('global', '/en', 'en-US'),
  loc('global', '/uk', 'en-GB', '/en', 'link, rollout, translate'),
  loc('global', '/emea/en', 'en', '/en', 'link, rollout'),
  loc('global', '/emea/es', 'es-ES', '/emea/en', 'rollout, translate'),
  loc('brand-b', '/es', 'es-ES', 'global:/emea/es', 'link, rollout'),
  loc('brand-b', '/', 'en-US', 'global:/en', 'link, rollout'),
];

describe('validation: valid tree', () => {
  it('reports no issues and marks every location valid and resolved', () => {
    const model = org(...tree);
    assert.deepEqual(model.issues, []);
    model.locations.forEach((l) => {
      assert.equal(l.valid, true, l.id);
      assert.equal(l.resolved, true, l.id);
    });
  });
});

describe('validation: sources', () => {
  it('errors on an unknown source in a loaded site', () => {
    const model = org(loc('global', '/uk', 'en-GB', '/en'));
    assert.deepEqual(codesFor(model, 'global:/uk'), ['unknown-source']);
    assert.equal(model.locations.get('global:/uk').valid, false);
  });

  it('allows a cross-site source defined in the source site', () => {
    const model = org(loc('global', '/en', 'en'), loc('brand-b', '/', 'en', 'global:/en'));
    assert.deepEqual(model.issues, []);
  });
});

describe('validation: unresolved sources', () => {
  [
    ['not loaded', { 'brand-b': [{ path: '/', language: 'en', source: 'global:/en' }, { path: '/x', language: 'en', source: '/' }] }],
    ['unreadable', { global: null, 'brand-b': [{ path: '/', language: 'en', source: 'global:/en' }, { path: '/x', language: 'en', source: '/' }] }],
  ].forEach(([label, sites]) => {
    const model = parseConfig({ sites });

    it(`warns and marks unresolved when the source site is ${label}`, () => {
      const issues = issuesFor(model, 'brand-b:/');
      assert.deepEqual(issues.map((i) => [i.level, i.code]), [['warning', 'source-unresolved']]);
      const location = model.locations.get('brand-b:/');
      assert.equal(location.valid, true);
      assert.equal(location.resolved, false);
    });

    it(`propagates unresolved to descendants when the source site is ${label}`, () => {
      const issues = issuesFor(model, 'brand-b:/x');
      assert.deepEqual(issues.map((i) => [i.level, i.code]), [['warning', 'ancestor-unresolved']]);
      assert.equal(model.locations.get('brand-b:/x').resolved, false);
      assert.equal(model.locations.get('brand-b:/x').valid, true);
    });
  });
});

describe('validation: cycles', () => {
  it('errors on a self-source', () => {
    const model = org(loc('global', '/en', 'en', '/en'));
    assert.deepEqual(codesFor(model, 'global:/en'), ['cycle']);
  });

  it('errors on every location in a cycle, and invalid-ancestor below it', () => {
    const model = org(
      loc('global', '/a', 'en', '/b'),
      loc('global', '/b', 'en', '/a'),
      loc('global', '/c', 'en', '/a'),
    );
    assert.deepEqual(codesFor(model, 'global:/a'), ['cycle']);
    assert.deepEqual(codesFor(model, 'global:/b'), ['cycle']);
    assert.deepEqual(codesFor(model, 'global:/c'), ['invalid-ancestor']);
  });
});

describe('validation: depth', () => {
  const chain = (n) => Array.from({ length: n }, (_, i) => loc('global', `/l${i + 1}`, 'en', i ? `/l${i}` : ''));

  it('allows 5 levels including the root', () => {
    assert.deepEqual(org(...chain(5)).issues, []);
  });

  it('errors on the 6th level and invalid-ancestor beyond', () => {
    const model = org(...chain(7));
    assert.deepEqual(codesFor(model, 'global:/l5'), []);
    assert.deepEqual(codesFor(model, 'global:/l6'), ['max-depth']);
    assert.deepEqual(codesFor(model, 'global:/l7'), ['invalid-ancestor']);
  });
});

describe('validation: languages', () => {
  it('errors on translate between identical languages', () => {
    const model = org(
      loc('global', '/es', 'es-ES'),
      loc('brand-b', '/es', 'es-es', 'global:/es', 'rollout, translate'),
    );
    assert.deepEqual(codesFor(model, 'brand-b:/es'), ['translate-same-language']);
  });

  it('allows translate when only region differs', () => {
    const model = org(
      loc('global', '/en', 'en'),
      loc('global', '/uk', 'en-GB', '/en', 'translate'),
    );
    assert.deepEqual(model.issues, []);
  });

  it('warns on link or rollout across base languages', () => {
    ['link', 'rollout'].forEach((action) => {
      const model = org(
        loc('global', '/en', 'en'),
        loc('global', '/es', 'es', '/en', action),
      );
      const issues = issuesFor(model, 'global:/es');
      assert.deepEqual(issues.map((i) => [i.level, i.code]), [['warning', 'cross-language']], action);
      assert.equal(model.locations.get('global:/es').valid, true);
    });
  });

  it('does not warn for translate-only across languages', () => {
    const model = org(
      loc('global', '/en', 'en'),
      loc('global', '/es', 'es', '/en', 'translate'),
    );
    assert.deepEqual(model.issues, []);
  });

  it('does not warn for link or rollout when translate is also allowed', () => {
    const model = org(
      loc('global', '/en', 'en'),
      loc('global', '/es', 'es', '/en', 'link, rollout, translate'),
    );
    assert.deepEqual(model.issues, []);
  });

  it('skips language checks when a language is invalid', () => {
    const model = org(
      loc('global', '/en', 'nope'),
      loc('global', '/es', 'es', '/en', 'link'),
    );
    assert.deepEqual(codesFor(model, 'global:/es'), ['invalid-ancestor']);
  });
});

describe('validation: invalid ancestors', () => {
  it('propagates down the whole chain and names the ancestor', () => {
    const model = org(
      loc('global', '/en', 'nope'),
      loc('global', '/uk', 'en-GB', '/en'),
      loc('global', '/ie', 'en-IE', '/uk'),
    );
    const [uk] = issuesFor(model, 'global:/uk');
    const [ie] = issuesFor(model, 'global:/ie');
    assert.equal(uk.code, 'invalid-ancestor');
    assert.equal(uk.ancestor, 'global:/en');
    assert.equal(ie.code, 'invalid-ancestor');
    assert.equal(ie.ancestor, 'global:/en');
    assert.equal(model.locations.get('global:/ie').valid, false);
  });

  it('also reports invalid-ancestor on descendants with their own errors', () => {
    const model = org(
      loc('global', '/en', 'nope'),
      loc('global', '/uk', 'en-GB', '/en', 'bogus'),
    );
    assert.deepEqual(codesFor(model, 'global:/uk'), ['invalid-actions', 'invalid-ancestor']);
  });
});
