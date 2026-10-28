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
  parseLanguage,
  canTranslate,
  isSameBaseLanguage,
  defaultRefreshAction,
  languageLabel,
} from '../../../../tools/localization/core/language.js';

describe('parseLanguage', () => {
  it('parses a bare language', () => {
    assert.deepEqual(parseLanguage('es'), {
      tag: 'es', language: 'es', script: undefined, region: undefined,
    });
  });

  it('parses language + region', () => {
    assert.deepEqual(parseLanguage('es-MX'), {
      tag: 'es-MX', language: 'es', script: undefined, region: 'MX',
    });
  });

  it('parses numeric regions', () => {
    assert.equal(parseLanguage('es-419').region, '419');
  });

  it('parses scripts', () => {
    assert.equal(parseLanguage('zh-Hant-TW').script, 'Hant');
  });

  it('canonicalizes case and trims', () => {
    assert.equal(parseLanguage(' en-us ').tag, 'en-US');
  });

  it('returns null for invalid or empty codes', () => {
    ['', undefined, null, 'english', 'en_US', 'e', 'en-u-ca-gregory', 'de-x-foo'].forEach((code) => {
      assert.equal(parseLanguage(code), null, `expected null for ${code}`);
    });
  });
});

describe('isSameBaseLanguage', () => {
  it('ignores region', () => {
    assert.equal(isSameBaseLanguage('en-US', 'en-GB'), true);
    assert.equal(isSameBaseLanguage('en', 'en-GB'), true);
  });

  it('differs on language', () => {
    assert.equal(isSameBaseLanguage('en', 'es'), false);
  });

  it('treats script as part of the base language', () => {
    assert.equal(isSameBaseLanguage('zh-Hans', 'zh-Hant'), false);
  });

  it('is false for invalid codes', () => {
    assert.equal(isSameBaseLanguage('en', 'bogus'), false);
  });
});

describe('canTranslate', () => {
  it('allows when language differs', () => {
    assert.equal(canTranslate('en-US', 'es-ES'), true);
  });

  it('allows when only region differs', () => {
    assert.equal(canTranslate('en-US', 'en-GB'), true);
    assert.equal(canTranslate('en', 'en-GB'), true);
  });

  it('rejects identical languages, ignoring case', () => {
    assert.equal(canTranslate('es-ES', 'es-es'), false);
  });

  it('rejects invalid codes', () => {
    assert.equal(canTranslate('en', 'bogus'), false);
  });
});

describe('defaultRefreshAction', () => {
  it('translates when base language differs', () => {
    assert.equal(defaultRefreshAction('en', 'es'), 'translate');
    assert.equal(defaultRefreshAction('zh-Hans', 'zh-Hant'), 'translate');
  });

  it('rolls out when only region differs or same', () => {
    assert.equal(defaultRefreshAction('en-US', 'en-GB'), 'rollout');
    assert.equal(defaultRefreshAction('es-ES', 'es-ES'), 'rollout');
  });
});

describe('languageLabel', () => {
  it('names a bare language', () => {
    assert.equal(languageLabel('es'), 'Spanish');
  });

  it('names language + region', () => {
    assert.equal(languageLabel('es-MX'), 'Mexican Spanish');
  });

  it('uses the requested display locale', () => {
    assert.equal(languageLabel('de', 'de'), 'Deutsch');
  });

  it('falls back to the raw code when invalid', () => {
    assert.equal(languageLabel('bogus'), 'bogus');
    assert.equal(languageLabel('en-u-ca-gregory'), 'en-u-ca-gregory');
    assert.equal(languageLabel('de-x-foo'), 'de-x-foo');
  });
});
