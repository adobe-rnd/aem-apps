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
import { parseConfig } from '../../../../tools/localization/core/config.js';

const row = (fields) => ({
  site: '',
  path: '',
  language: '',
  label: '',
  source: '',
  actions: '',
  missingPages: '',
  conflictBehavior: '',
  onComplete: '',
  ...fields,
});

const codes = (model) => model.issues.map((i) => i.code);
const issuesFor = (model, id) => model.issues.filter((i) => i.id === id).map((i) => i.code);

describe('parseConfig: locations', () => {
  it('parses an org config row into a location keyed by site:path', () => {
    const model = parseConfig({
      org: [row({
        site: 'global', path: '/en', language: 'en-US', label: 'Global English',
      })],
      sites: {},
    });
    assert.deepEqual(model.locations.get('global:/en'), {
      id: 'global:/en',
      site: 'global',
      path: '/en',
      language: 'en-US',
      label: 'Global English',
      source: null,
      actions: [],
      missingPages: null,
      conflictBehavior: [],
      onComplete: null,
      scope: 'org',
      valid: true,
      resolved: true,
    });
    assert.deepEqual(model.issues, []);
    assert.equal(model.incomplete, false);
  });

  it('implies site from the site config key', () => {
    const model = parseConfig({
      org: [],
      sites: { global: [row({ path: '/en', language: 'en' })] },
    });
    const loc = model.locations.get('global:/en');
    assert.equal(loc.site, 'global');
    assert.equal(loc.scope, 'site');
  });

  it('accepts a matching site column in a site config', () => {
    const model = parseConfig({
      org: [],
      sites: { global: [row({ site: 'global', path: '/en', language: 'en' })] },
    });
    assert.deepEqual(model.issues, []);
  });

  it('errors on a mismatched site column in a site config', () => {
    const model = parseConfig({
      org: [],
      sites: { global: [row({ site: 'other', path: '/en', language: 'en' })] },
    });
    assert.deepEqual(codes(model), ['site-mismatch']);
  });

  it('errors on a missing site in org config', () => {
    const model = parseConfig({ org: [row({ path: '/en', language: 'en' })], sites: {} });
    assert.deepEqual(codes(model), ['missing-site']);
    assert.equal(model.locations.size, 0);
  });

  it('errors on invalid site names and drops the row', () => {
    const orgModel = parseConfig({
      org: [row({ site: 'bad_site', path: '/en', language: 'en' })],
      sites: {},
    });
    assert.deepEqual(codes(orgModel), ['invalid-site']);
    assert.equal(orgModel.locations.size, 0);

    const siteModel = parseConfig({
      org: [],
      sites: { 'bad site': [row({ path: '/en', language: 'en' })] },
    });
    assert.deepEqual(codes(siteModel), ['invalid-site']);
    assert.equal(siteModel.locations.size, 0);
  });

  it('skips blank rows', () => {
    const model = parseConfig({ org: [row({})], sites: {} });
    assert.equal(model.locations.size, 0);
    assert.deepEqual(model.issues, []);
  });

  it('marks incomplete when org config is unreadable', () => {
    const model = parseConfig({ org: null, sites: {} });
    assert.equal(model.incomplete, true);
  });
});

describe('parseConfig: paths', () => {
  const pathOf = (path) => parseConfig({
    org: [row({ site: 'global', path, language: 'en' })],
    sites: {},
  });

  it('strips trailing slashes and whitespace', () => {
    assert.ok(pathOf(' /emea/en/ ').locations.has('global:/emea/en'));
  });

  it('keeps / as the whole site', () => {
    assert.ok(pathOf('/').locations.has('global:/'));
  });

  it('defaults an empty path to the whole site', () => {
    assert.ok(pathOf('').locations.has('global:/'));
  });

  it('errors on relative or dot-segment paths', () => {
    ['en', '/en/../fr', '/./en', '/en//fr'].forEach((p) => {
      assert.deepEqual(codes(pathOf(p)), ['invalid-path'], p);
    });
  });

  it('lowercases sites', () => {
    const model = parseConfig({
      org: [row({ site: 'Brand-B', path: '/', language: 'en' })],
      sites: {},
    });
    assert.ok(model.locations.has('brand-b:/'));
  });
});

describe('parseConfig: language and label', () => {
  it('canonicalizes the language', () => {
    const model = parseConfig({
      org: [row({ site: 'global', path: '/en', language: 'en-us' })],
      sites: {},
    });
    assert.equal(model.locations.get('global:/en').language, 'en-US');
  });

  it('errors on an invalid or missing language and marks the location invalid', () => {
    ['', 'english'].forEach((language) => {
      const model = parseConfig({
        org: [row({ site: 'global', path: '/en', language })],
        sites: {},
      });
      assert.deepEqual(issuesFor(model, 'global:/en'), ['invalid-language'], language);
      assert.equal(model.locations.get('global:/en').valid, false);
    });
  });

  it('falls back to a generated label', () => {
    const model = parseConfig({
      org: [row({ site: 'global', path: '/mx', language: 'es-MX' })],
      sites: {},
    });
    assert.equal(model.locations.get('global:/mx').label, 'Mexican Spanish');
  });
});

describe('parseConfig: source', () => {
  const withSource = (source, extra = {}) => parseConfig({
    org: [
      row({ site: 'global', path: '/en', language: 'en-US' }),
      row({
        site: 'global', path: '/uk', language: 'en-GB', source, ...extra,
      }),
    ],
    sites: {},
  });

  it('parses site:/path', () => {
    assert.equal(withSource('brand-a:/en').locations.get('global:/uk').source, 'brand-a:/en');
  });

  it('treats a bare path as the same site', () => {
    assert.equal(withSource('/en/').locations.get('global:/uk').source, 'global:/en');
  });

  it('lowercases the source site', () => {
    assert.equal(withSource('Brand-A:/').locations.get('global:/uk').source, 'brand-a:/');
  });

  it('errors on malformed sources', () => {
    ['en', 'global /en', 'global:', ':/en', 'global:/en/../x'].forEach((s) => {
      assert.deepEqual(codes(withSource(s)), ['invalid-source'], s);
    });
  });

  it('applies conservative defaults to a relationship', () => {
    const loc = withSource('/en').locations.get('global:/uk');
    assert.deepEqual(loc.actions, ['rollout']);
    assert.equal(loc.missingPages, 'none');
    assert.deepEqual(loc.conflictBehavior, ['merge']);
    assert.equal(loc.onComplete, 'none');
  });

  it('does not share default lists between locations or calls', () => {
    const first = withSource('/en').locations.get('global:/uk');
    first.actions.push('translate');
    first.conflictBehavior.push('overwrite');
    const second = withSource('/en').locations.get('global:/uk');
    assert.deepEqual(second.actions, ['rollout']);
    assert.deepEqual(second.conflictBehavior, ['merge']);
  });
});

describe('parseConfig: relationship settings', () => {
  const settings = (extra) => parseConfig({
    org: [
      row({ site: 'global', path: '/en', language: 'en-US' }),
      row({
        site: 'global', path: '/uk', language: 'en-GB', source: '/en', ...extra,
      }),
    ],
    sites: {},
  });

  it('parses actions as a trimmed, lowercased, deduped list', () => {
    const loc = settings({ actions: ' Link, rollout ,TRANSLATE, link' }).locations.get('global:/uk');
    assert.deepEqual(loc.actions, ['link', 'rollout', 'translate']);
  });

  it('errors on unknown actions', () => {
    assert.deepEqual(codes(settings({ actions: 'link, skip' })), ['invalid-actions']);
  });

  it('parses missingPages', () => {
    assert.equal(settings({ missingPages: 'Linked' }).locations.get('global:/uk').missingPages, 'linked');
  });

  it('errors on unknown missingPages', () => {
    assert.deepEqual(codes(settings({ missingPages: 'copy' })), ['invalid-missing-pages']);
  });

  it('keeps conflictBehavior order (first = default)', () => {
    const loc = settings({ conflictBehavior: 'overwrite, merge' }).locations.get('global:/uk');
    assert.deepEqual(loc.conflictBehavior, ['overwrite', 'merge']);
  });

  it('errors on unknown conflictBehavior', () => {
    assert.deepEqual(codes(settings({ conflictBehavior: 'merge, replace' })), ['invalid-conflict-behavior']);
  });

  it('parses onComplete', () => {
    assert.equal(settings({ onComplete: 'Publish' }).locations.get('global:/uk').onComplete, 'publish');
  });

  it('errors on unknown onComplete', () => {
    assert.deepEqual(codes(settings({ onComplete: 'live' })), ['invalid-on-complete']);
  });

  it('errors when a root sets relationship settings', () => {
    const model = parseConfig({
      org: [row({
        site: 'global', path: '/en', language: 'en', actions: 'link',
      })],
      sites: {},
    });
    assert.deepEqual(codes(model), ['root-has-relationship-settings']);
    assert.equal(model.locations.get('global:/en').valid, false);
  });
});

describe('parseConfig: lenient headers', () => {
  it('matches headers ignoring case, spaces, dashes and underscores', () => {
    const model = parseConfig({
      org: [{
        Site: 'global',
        PATH: '/uk',
        Language: 'en-GB',
        Source: '/en',
        'Missing Pages': 'linked',
        conflict_behavior: 'overwrite',
        'on-complete': 'preview',
        Actions: 'link',
      }],
      sites: {},
    });
    const loc = model.locations.get('global:/uk');
    assert.equal(loc.missingPages, 'linked');
    assert.deepEqual(loc.conflictBehavior, ['overwrite']);
    assert.equal(loc.onComplete, 'preview');
    assert.deepEqual(loc.actions, ['link']);
  });
});

describe('parseConfig: merging scopes', () => {
  const en = row({ site: 'global', path: '/en', language: 'en' });

  it('errors on a duplicate location within one scope', () => {
    const model = parseConfig({ org: [en, en], sites: {} });
    assert.deepEqual(codes(model), ['duplicate-location']);
    assert.equal(model.locations.get('global:/en').valid, false);
  });

  it('allows an identical definition in org and site config', () => {
    const model = parseConfig({
      org: [en],
      sites: { global: [row({ path: '/en/', language: 'EN' })] },
    });
    assert.deepEqual(model.issues, []);
    assert.equal(model.locations.get('global:/en').scope, 'org');
  });

  it('errors on a conflicting definition in org and site config', () => {
    const model = parseConfig({
      org: [en],
      sites: { global: [row({ path: '/en', language: 'en-US' })] },
    });
    assert.deepEqual(codes(model), ['scope-conflict']);
    assert.equal(model.locations.get('global:/en').valid, false);
  });

  it('ignores label differences when comparing scopes', () => {
    const model = parseConfig({
      org: [en],
      sites: { global: [row({ path: '/en', language: 'en', label: 'English' })] },
    });
    assert.deepEqual(model.issues, []);
  });
});

describe('parseConfig: issues', () => {
  it('include level, code, id, field and message', () => {
    const model = parseConfig({
      org: [row({ site: 'global', path: '/en', language: 'nope' })],
      sites: {},
    });
    const [issue] = model.issues;
    assert.equal(issue.level, 'error');
    assert.equal(issue.code, 'invalid-language');
    assert.equal(issue.id, 'global:/en');
    assert.equal(issue.field, 'language');
    assert.equal(typeof issue.message, 'string');
  });
});
