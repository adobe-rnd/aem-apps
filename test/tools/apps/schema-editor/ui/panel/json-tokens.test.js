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
import { expect } from '../../expect.js';
import { jsonTokens } from '../../../../../../tools/apps/schema-editor/ui/panel/json-tokens.js';

const typed = (json) => jsonTokens(json).filter((t) => t.type).map((t) => [t.type, t.text]);

describe('JSON tokens', () => {
  it('types keys, strings, numbers and literals and keeps every character', () => {
    const value = {
      a: 'x', n: -1.5e3, b: true, c: null,
    };
    const json = JSON.stringify(value, null, 2);
    expect(jsonTokens(json).map((t) => t.text).join('')).to.equal(json);
    expect(typed(json)).to.deep.equal([
      ['key', '"a"'], ['string', '"x"'],
      ['key', '"n"'], ['number', '-1500'],
      ['key', '"b"'], ['literal', 'true'],
      ['key', '"c"'], ['literal', 'null'],
    ]);
  });

  it('keeps escaped quotes, colons and digits inside one string', () => {
    const json = JSON.stringify(['say "a": 1', 'true']);
    expect(typed(json)).to.deep.equal([['string', '"say \\"a\\": 1"'], ['string', '"true"']]);
  });
});
