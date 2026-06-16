import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFlexibleHtmlSearchPattern,
  createSearchRegex,
  findHtmlMatches,
  formatHTML,
  getMatchContext,
} from '../../../../../tools/apps/content-replace/core/search-utils.js';

describe('content replace search utilities', () => {
  it('escapes literal search terms in contains mode', () => {
    const regex = createSearchRegex('Price is $1.00?', 'contains', false);

    assert.equal('price is $1.00?'.match(regex)?.[0], 'price is $1.00?');
    assert.equal('Price is $10'.match(regex), null);
  });

  it('uses word boundaries in exact mode', () => {
    const regex = createSearchRegex('cat', 'exact', false);

    assert.equal('cat catalog scatter'.match(regex)?.[0], 'cat');
    assert.equal('catalog'.match(regex), null);
  });

  it('preserves regex search terms and capture groups', () => {
    const regex = createSearchRegex('(\\d{3})-(\\d{4})', 'regex', true);
    const match = regex.exec('Call 555-1234');

    assert.equal(match?.[0], '555-1234');
    assert.equal(match?.[1], '555');
    assert.equal(match?.[2], '1234');
  });

  it('builds flexible HTML patterns for equivalent paragraph wrapping', () => {
    const pattern = buildFlexibleHtmlSearchPattern('<div><p>Hello</p></div>');
    const regex = new RegExp(pattern, 'i');

    assert.equal(regex.test('<div>Hello</div>'), true);
    assert.equal(regex.test('<div>   <p>Hello</p>   </div>'), true);
  });

  it('finds HTML matches with line and context metadata', () => {
    const content = '<main>\n<div class="hero"><p>Hello</p></div>\n</main>';
    const matches = findHtmlMatches(content, '<div class="hero"><p>Hello</p></div>', 'contains', false);

    assert.equal(matches.length, 1);
    assert.equal(matches[0].line, 2);
    assert.equal(matches[0].sequenceOnLine, 1);
    assert.match(matches[0].context, /hero/);
  });

  it('formats adjacent HTML tags onto stable lines', () => {
    assert.equal(
      formatHTML('<main><div><p>Hello</p></div></main>'),
      '<main>\n  <div>\n    <p>Hello</p>\n    </div>\n  </main>',
    );
  });

  it('extracts bounded match context', () => {
    assert.equal(getMatchContext('abcdef', 3, 2), 'bcde');
    assert.equal(getMatchContext('abcdef', 0, 2), 'ab');
  });
});
