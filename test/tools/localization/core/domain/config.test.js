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

const row = (fields) => ({
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

const global = (...rows) => parseConfig({ sites: { global: rows } });

const codes = (model) => model.issues.map((issue) => issue.code);
const issuesFor = (model, id) => model.issues
  .filter((issue) => issue.id === id)
  .map((issue) => issue.code);

describe('parseConfig: locations', () => {
  it('parses a site config row into a location keyed by site:path', () => {
    const model = global(row({ path: '/en', language: 'en-US', label: 'Global English' }));
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
      valid: true,
      resolved: true,
    });
    assert.deepEqual(model.issues, []);
  });

  it('combines locations from several sites', () => {
    const model = parseConfig({
      sites: {
        global: [row({ path: '/en', language: 'en' })],
        'brand-b': [row({ path: '/', language: 'en' })],
      },
    });
    assert.deepEqual([...model.locations.keys()], ['global:/en', 'brand-b:/']);
  });

  it('ignores a site column', () => {
    const model = global(row({ site: 'other', path: '/en', language: 'en' }));
    assert.ok(model.locations.has('global:/en'));
    assert.deepEqual(model.issues, []);
  });

  it('accepts unreadable sites as null', () => {
    const model = parseConfig({ sites: { global: null } });
    assert.equal(model.locations.size, 0);
    assert.deepEqual(model.issues, []);
  });

  it('errors on invalid site names', () => {
    const model = parseConfig({ sites: { 'bad site': [row({ path: '/en', language: 'en' })] } });
    assert.deepEqual(codes(model), ['invalid-site']);
    assert.equal(model.locations.size, 0);
  });

  it('lowercases site names', () => {
    const model = parseConfig({ sites: { 'Brand-B': [row({ path: '/', language: 'en' })] } });
    assert.ok(model.locations.has('brand-b:/'));
  });

  it('skips blank rows', () => {
    const model = global(row({}));
    assert.equal(model.locations.size, 0);
    assert.deepEqual(model.issues, []);
  });

  it('errors on a duplicate location', () => {
    const englishRow = row({ path: '/en', language: 'en' });
    const model = global(englishRow, englishRow);
    assert.deepEqual(codes(model), ['duplicate-location']);
    assert.equal(model.locations.get('global:/en').valid, false);
  });
});

describe('parseConfig: paths', () => {
  const pathOf = (path) => global(row({ path, language: 'en' }));

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
    ['en', '/en/../fr', '/./en', '/en//fr'].forEach((path) => {
      assert.deepEqual(codes(pathOf(path)), ['invalid-path'], path);
    });
  });
});

describe('parseConfig: language and label', () => {
  it('canonicalizes the language', () => {
    assert.equal(global(row({ path: '/en', language: 'en-us' })).locations.get('global:/en').language, 'en-US');
  });

  it('errors on an invalid or missing language and marks the location invalid', () => {
    ['', 'english'].forEach((language) => {
      const model = global(row({ path: '/en', language }));
      assert.deepEqual(issuesFor(model, 'global:/en'), ['invalid-language'], language);
      assert.equal(model.locations.get('global:/en').valid, false);
    });
  });

  it('falls back to a generated label', () => {
    assert.equal(global(row({ path: '/mx', language: 'es-MX' })).locations.get('global:/mx').label, 'Mexican Spanish');
  });
});

describe('parseConfig: source', () => {
  const withSource = (source, extra = {}) => global(
    row({ path: '/en', language: 'en-US' }),
    row({
      path: '/uk', language: 'en-GB', source, ...extra,
    }),
  );

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
    ['en', 'global /en', 'global:', ':/en', 'global:/en/../x'].forEach((source) => {
      assert.deepEqual(codes(withSource(source)), ['invalid-source'], source);
    });
  });

  it('applies conservative defaults to a relationship', () => {
    const location = withSource('/en').locations.get('global:/uk');
    assert.deepEqual(location.actions, ['rollout']);
    assert.equal(location.missingPages, 'none');
    assert.deepEqual(location.conflictBehavior, ['merge']);
    assert.equal(location.onComplete, 'none');
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
  const settings = (extra) => global(
    row({ path: '/en', language: 'en-US' }),
    row({
      path: '/uk', language: 'en-GB', source: '/en', ...extra,
    }),
  );

  it('parses actions as a trimmed, lowercased, deduped list', () => {
    const location = settings({ actions: ' Link, rollout ,TRANSLATE, link' }).locations.get('global:/uk');
    assert.deepEqual(location.actions, ['link', 'rollout', 'translate']);
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
    const location = settings({ conflictBehavior: 'overwrite, merge' }).locations.get('global:/uk');
    assert.deepEqual(location.conflictBehavior, ['overwrite', 'merge']);
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
    const model = global(row({ path: '/en', language: 'en', actions: 'link' }));
    assert.deepEqual(codes(model), ['root-has-relationship-settings']);
    assert.equal(model.locations.get('global:/en').valid, false);
  });
});

describe('parseConfig: lenient headers', () => {
  it('matches headers ignoring case, spaces, dashes and underscores', () => {
    const model = global(
      { Path: '/en', LANGUAGE: 'en' },
      {
        PATH: '/uk',
        Language: 'en-GB',
        Source: '/en',
        'Missing Pages': 'linked',
        conflict_behavior: 'overwrite',
        'on-complete': 'preview',
        Actions: 'link',
      },
    );
    const location = model.locations.get('global:/uk');
    assert.equal(location.missingPages, 'linked');
    assert.deepEqual(location.conflictBehavior, ['overwrite']);
    assert.equal(location.onComplete, 'preview');
    assert.deepEqual(location.actions, ['link']);
  });
});

describe('parseConfig: issues', () => {
  it('include level, code, site, row, id, field and message', () => {
    const model = global(row({ path: '/en', language: 'nope' }));
    const [issue] = model.issues;
    assert.equal(issue.level, 'error');
    assert.equal(issue.code, 'invalid-language');
    assert.equal(issue.site, 'global');
    assert.equal(issue.row, 0);
    assert.equal(issue.id, 'global:/en');
    assert.equal(issue.field, 'language');
    assert.equal(typeof issue.message, 'string');
  });
});
