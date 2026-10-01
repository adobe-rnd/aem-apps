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
import { unwrapCodeblock, wrapCodeblock } from '../../../../../tools/apps/graphql/core/codeblock.js';

describe('codeblock', () => {
  it('round-trips text through a codeblock document', () => {
    const text = '{"a":"<b> & </code> \\"c\\""}';
    const html = wrapCodeblock(text);
    assert.ok(html.startsWith('<body><header></header><main><div><pre><code>{"a":"&lt;b&gt; &amp; &lt;/code&gt;'));
    assert.equal(unwrapCodeblock(html), text);
  });

  it('reads documents written by the schema editor and by DA', () => {
    assert.equal(unwrapCodeblock('<main><pre><code class="language-json">{"a":1}</code></pre></main>'), '{"a":1}');
    assert.equal(unwrapCodeblock('<CODE>\n{"a":1}\n</CODE >'), '\n{"a":1}\n');
    assert.equal(unwrapCodeblock('<code>{"a":"<b>bold</b><br/>"}</code>'), '{"a":"bold"}');
    assert.equal(unwrapCodeblock('<code><!-- x -->1</code><code>2</code>'), '1');
  });

  it('decodes entities like the browser', () => {
    assert.equal(unwrapCodeblock('<code>&quot;&#39;&apos;&#x41;&#66;&nbsp;&amp;lt;</code>'), '"\'\'AB\u00a0&lt;');
  });

  it('keeps unknown entities and invalid code points as written', () => {
    assert.equal(unwrapCodeblock('<code>&unknown; &#x110000;</code>'), '&unknown; &#x110000;');
  });

  it('is undefined without a code block', () => {
    assert.equal(unwrapCodeblock('<main><pre>{}</pre></main>'), undefined);
    assert.equal(unwrapCodeblock(undefined), undefined);
  });
});
