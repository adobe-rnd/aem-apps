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
  contentTypes, extractSdl, starterQuery, toServedSdl,
} from '../../../../../tools/apps/graphiql/core/sdl.js';

const SDL = `type CitizenService @contentType(id: "citizen-service") {
  path: String!
  data: CitizenServiceData
}

type CitizenServiceData {
  title: String
  meta: JSON @source(key: "meta.data")
}

scalar JSON
`;

describe('extractSdl', () => {
  it('returns the decoded second code block of endpoint.html', () => {
    const html = '<body><main><div><pre><code>{"name": "x"}</code></pre>'
      + '<pre><code>type A @contentType(id: &quot;a&quot;) { b: [String] } # &lt;&amp;&gt;</code></pre>'
      + '</div></main></body>';
    assert.equal(extractSdl(html), 'type A @contentType(id: "a") { b: [String] } # <&>');
  });

  it('is undefined without an SDL block', () => {
    assert.equal(extractSdl('<pre><code>{}</code></pre>'), undefined);
    assert.equal(extractSdl('<pre><code>{}</code></pre><pre><code> \n</code></pre>'), undefined);
    assert.equal(extractSdl(undefined), undefined);
  });
});

describe('toServedSdl', () => {
  it('adds the list queries, pages and directives Content AI generates', () => {
    const served = toServedSdl(SDL);
    assert.deepEqual(contentTypes(served), ['CitizenService']);
    assert.match(served, /directive @contentType\(id: String!\) on OBJECT/);
    assert.match(served, /directive @source\(key: String!\) on FIELD_DEFINITION/);
    assert.equal(served.match(/^scalar JSON$/gm).length, 1);
    assert.match(served, /type CitizenServicePage \{\n {2}items: \[CitizenService!\]!\n {2}pageInfo: PageInfo!\n\}/);
    assert.match(served, /citizenServiceList\(search: String, filter: JSON, orderBy: \[JSON!\], first: Int, after: String\): CitizenServicePage/);
  });

  it('keeps a Query type valid without document types', () => {
    assert.match(toServedSdl('type A { b: String }'), /type Query \{\n {2}_empty: Boolean\n\}/);
  });
});

describe('starterQuery', () => {
  it('queries the first page of the first document type', () => {
    assert.match(starterQuery(SDL), /^\{\n {2}citizenServiceList\(first: 10\) \{/);
    assert.equal(starterQuery('type A { b: String }'), '{\n  \n}\n');
  });
});
