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
import { parseSite, siteHash } from '../../../../tools/apps/msm-next/data/site-input.js';

describe('parseSite', () => {
  it('reads org and site with or without a leading slash', () => {
    assert.deepEqual(parseSite('/acme/web'), { org: 'acme', site: 'web' });
    assert.deepEqual(parseSite('acme/web'), { org: 'acme', site: 'web' });
    assert.deepEqual(parseSite('  /acme/web/  '), { org: 'acme', site: 'web' });
  });

  it('reads a location hash', () => {
    assert.deepEqual(parseSite('#/acme/web'), { org: 'acme', site: 'web' });
    assert.deepEqual(parseSite('#acme/web'), { org: 'acme', site: 'web' });
  });

  it('reads a da.live url and ignores the page path', () => {
    assert.deepEqual(parseSite('https://da.live/#/acme/web'), { org: 'acme', site: 'web' });
    assert.deepEqual(parseSite('https://da.live/edit#/acme/web/en/index'), { org: 'acme', site: 'web' });
  });

  it('lowercases names', () => {
    assert.deepEqual(parseSite('/Acme/Web'), { org: 'acme', site: 'web' });
  });

  it('returns null without both an org and a site', () => {
    assert.equal(parseSite(''), null);
    assert.equal(parseSite(undefined), null);
    assert.equal(parseSite('#'), null);
    assert.equal(parseSite('/acme'), null);
    assert.equal(parseSite('https://da.live/'), null);
  });

  it('returns null for names with invalid characters', () => {
    assert.equal(parseSite('/acme corp/web'), null);
    assert.equal(parseSite('/acme/web?x=1'), null);
  });
});

describe('siteHash', () => {
  it('builds the hash for an org and site', () => {
    assert.equal(siteHash({ org: 'acme', site: 'web' }), '#/acme/web');
  });
});
