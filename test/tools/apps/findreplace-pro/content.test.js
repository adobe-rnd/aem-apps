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
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  getMatchContext, createSearchRegex, createHTMLSearchRegex, formatHTML,
} from '../../../../tools/apps/findreplace-pro/findreplace-pro-utils.js';

const source = readFileSync(new URL('../../../../tools/apps/findreplace-pro/findreplace-pro.js', import.meta.url), 'utf8');

function loadContent(options = {}) {
  const definitions = [
    source.slice(source.indexOf('function filterContentByTarget('), source.indexOf('async function scanFiles(')),
    source.slice(source.indexOf('function replaceSelectedMatches('), source.indexOf('async function executeReplace(')),
  ].join('\n');
  return vm.runInNewContext(`${definitions}\n({
    searchAndReplaceHTML, searchInContent, replaceSelectedMatches
  })`, {
    getMatchContext,
    createSearchRegex,
    createHTMLSearchRegex,
    formatHTML,
    document: {
      getElementById: (id) => ({
        'target-type': { value: 'all' },
        'search-type': { value: 'contains' },
        'case-sensitive': { checked: false },
        'html-mode': { checked: false },
        'exclude-urls': { checked: false },
        ...options,
      }[id]),
    },
  });
}

it('escapes literal searches and preserves exact-match word boundaries', () => {
  assert.deepEqual(Array.from('A+B a+b AAB'.match(createSearchRegex('a+b', 'contains', false))), ['A+B', 'a+b']);
  assert.deepEqual(Array.from('cat cats Cat'.match(createSearchRegex('cat', 'exact', true))), ['cat']);
});

it('preserves regex capture groups, flags, and invalid-pattern errors', () => {
  const regex = createSearchRegex('(hello) (world)', 'regex', false);
  assert.equal(regex.flags, 'gi');
  assert.equal('HELLO world'.replace(regex, '$2, $1'), 'world, HELLO');
  assert.throws(() => createSearchRegex('[', 'regex', false), { name: 'SyntaxError' });
});

it('replaces HTML without reformatting raw replacement output', () => {
  const { searchAndReplaceHTML } = loadContent();
  const content = '<main><div>Hello</div></main>';
  const result = searchAndReplaceHTML(content, '<div>Hello</div>', '<section>New</section>');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].index, 6);
  assert.equal(result.matches[0].line, 1);
  assert.equal(result.matches[0].sequenceOnLine, 1);
  assert.equal(result.updatedContent, '<main><section>New</section></main>');
  const regexSearch = loadContent({ 'search-type': { value: 'regex' } }).searchAndReplaceHTML;
  const regexResult = regexSearch('<p>Old</p><p>old</p>', '<p>(Old)</p>', '<h2>$1</h2>', true);
  assert.equal(regexResult.matches.length, 1);
  assert.equal(regexResult.updatedContent, '<h2>Old</h2><p>old</p>');
});

it('preserves match line and sequence identifiers for selective replacement', () => {
  const { searchInContent, replaceSelectedMatches } = loadContent();
  const content = '<p>hello hello</p>';
  const result = searchInContent(content, 'hello');
  const identities = Array.from(
    result.matches,
    ({ line, sequenceOnLine }) => [line, sequenceOnLine],
  );
  assert.deepEqual(identities, [
    [1, 1], [1, 2],
  ]);
  result.matches[0].selected = false;
  result.matches[1].selected = true;
  assert.equal(replaceSelectedMatches(content, result.matches, 'hello', 'world'), '<p>hello world</p>');
});

it('finishes text and HTML searches with zero-width and mixed regex matches', () => {
  const { searchInContent, searchAndReplaceHTML } = loadContent({
    'search-type': { value: 'regex' },
  });
  const fixtures = [
    { pattern: '(?=a)', matches: [['', 0], ['', 2]], replacement: '|ab|a' },
    { pattern: 'a|$', matches: [['a', 0], ['a', 2], ['', 3]], replacement: '|b||' },
  ];
  [searchInContent, searchAndReplaceHTML].forEach((search) => {
    fixtures.forEach((fixture) => {
      const result = search('aba', fixture.pattern, '|');
      assert.deepEqual(
        Array.from(result.matches, (match) => [match.match, match.index]),
        fixture.matches,
      );
      assert.equal(result.updatedContent, fixture.replacement);
    });
  });
});
