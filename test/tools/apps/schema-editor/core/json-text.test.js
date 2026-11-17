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
  jsonProblem, parseJsonText, parseSchemaText, lineBreakAt, offsetAt,
} from '../../../../../tools/apps/schema-editor/core/json-text.js';

describe('JSON text', () => {
  it('reads valid JSON', () => {
    expect(parseJsonText('{ "a": [1, true] }')).to.deep.equal({ json: { a: [1, true] } });
  });

  it('says what breaks and where, as 1-based line and column', () => {
    expect(parseJsonText('{\n  "a": 1\n  "b": 2\n}')).to.deep.equal({
      error: 'Not valid JSON: Expected \',\' or \'}\' after property value', line: 3, column: 3,
    });
    expect(parseJsonText('{\n  "a":')).to.deep.equal({
      error: 'Not valid JSON: Unexpected end of JSON input', line: 2, column: 7,
    });
  });

  it('drops the quoted text V8 repeats, even cut short', () => {
    expect(parseJsonText('[1,]')).to.deep.equal({ error: 'Not valid JSON: Unexpected token \']\'' });
    expect(jsonProblem('', 'Unexpected token \' \', ..."b": tru }" is not valid JSON').error)
      .to.equal('Not valid JSON: Unexpected token \' \'');
  });

  it('reads Firefox and Safari messages too', () => {
    const text = '{\n  "a": 1\n  "b": 2\n}';
    expect(jsonProblem(text, 'JSON.parse: expected \',\' or \'}\' after property value in object at line 3 column 3 of the JSON data'))
      .to.deep.equal({
        error: 'Not valid JSON: Expected \',\' or \'}\' after property value in object', line: 3, column: 3,
      });
    expect(jsonProblem('{"a"', 'JSON Parse error: Unexpected EOF'))
      .to.deep.equal({ error: 'Not valid JSON: Unexpected EOF', line: 1, column: 5 });
    expect(jsonProblem(text, 'JSON Parse error: Expected \'}\''))
      .to.deep.equal({ error: 'Not valid JSON: Expected \'}\'' });
  });

  it('takes only an object as a schema', () => {
    expect(parseSchemaText('{}')).to.deep.equal({ json: {} });
    expect(parseSchemaText('[]').error).to.equal('The schema must be a JSON object: { … }.');
    expect(parseSchemaText('null').error).to.equal('The schema must be a JSON object: { … }.');
    expect(parseSchemaText('{').line).to.equal(1);
  });
});

describe('offsetAt', () => {
  it('finds a 1-based line and column, kept within the line and the text', () => {
    const text = '{\n  "a": 1\n}';
    expect(offsetAt(text, { line: 2, column: 3 })).to.equal(4);
    expect(offsetAt(text, { line: 2, column: 99 })).to.equal(10);
    expect(offsetAt(text, { line: 9, column: 1 })).to.equal(11);
    expect(offsetAt(text, {})).to.equal(0);
  });
});

describe('Enter in JSON text', () => {
  // `|` marks the caret, before and after.
  const press = (marked) => {
    const caret = marked.indexOf('|');
    const text = marked.replace('|', '');
    const edit = lineBreakAt(text, caret);
    const result = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
    return `${result.slice(0, edit.caret)}|${result.slice(edit.caret)}`;
  };

  it('keeps the line\'s indent', () => {
    expect(press('{\n  "a": 1,|')).to.equal('{\n  "a": 1,\n  |');
    expect(press('|"a"')).to.equal('\n|"a"');
  });

  it('indents one level after an opening brace or bracket', () => {
    expect(press('{\n  "a": {|')).to.equal('{\n  "a": {\n    |');
    expect(press('{ |')).to.equal('{ \n  |');
  });

  it('puts the closing brace of an empty pair on its own line', () => {
    expect(press('{|}')).to.equal('{\n  |\n}');
    expect(press('  "a": {|  }')).to.equal('  "a": {\n    |\n  }');
  });

  it('replaces the selection', () => {
    expect(lineBreakAt('{"a": 1}', 1, 7)).to.deep.equal({
      from: 1, to: 7, text: '\n  \n', caret: 4,
    });
  });
});
