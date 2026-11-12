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
  schemaPath, schemasFolder, wrapSchemaHtml, unwrapSchemaHtml,
} from '../../../../../tools/apps/schema-editor/core/codeblock.js';

describe('schema documents', () => {
  it('locates schemas in the site forms folder', () => {
    expect(schemasFolder('o', 's')).to.equal('/o/s/.da/forms/schemas');
    expect(schemaPath('o', 's', 'article')).to.equal('/o/s/.da/forms/schemas/article.html');
  });

  it('round-trips JSON with markup characters', () => {
    const json = { title: 'A <b> & "c"', pattern: '^<a>$' };
    const html = wrapSchemaHtml(json);
    expect(html).to.contain('<pre><code>');
    expect(html).to.not.contain('<b>');
    expect(unwrapSchemaHtml(html)).to.deep.equal({ json, raw: JSON.stringify(json, null, 2) });
  });

  it('reads the code block of documents saved by DA', () => {
    const html = '<body><main><div><pre><code class="language-json">{&#x22;a&#x22;: &#34;&lt;1&gt;&#34;}</code></pre></div></main></body>';
    expect(unwrapSchemaHtml(html).json).to.deep.equal({ a: '<1>' });
  });

  it('reports missing, invalid and non-object JSON', () => {
    expect(unwrapSchemaHtml('<body></body>').error).to.contain('no JSON');
    expect(unwrapSchemaHtml(undefined).error).to.contain('no JSON');
    const invalid = unwrapSchemaHtml('<code>{ nope</code>');
    expect(invalid).to.include({ raw: '{ nope' });
    expect(invalid.error).to.contain('not valid JSON');
    expect(unwrapSchemaHtml('<code>[1]</code>').error).to.contain('not a JSON object');
  });
});
