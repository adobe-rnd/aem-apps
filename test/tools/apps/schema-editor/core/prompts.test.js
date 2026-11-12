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
import { ARTICLE } from '../fixtures.js';
import { parseSchema } from '../../../../../tools/apps/schema-editor/core/model/parse.js';
import { askPrompt, fixPrompt, createPrompt } from '../../../../../tools/apps/schema-editor/core/prompts.js';

const { model } = parseSchema(ARTICLE, { name: 'article' });
const PATH = '/o/s/.da/forms/schemas/article.html';

describe('prompts', () => {
  it('points an open question at the saved schema', () => {
    const text = askPrompt({
      org: 'o', site: 's', model, dirty: false,
    });
    expect(text).to.include(`"article" (${PATH})`);
    expect(text).to.include(`save it back to ${PATH}`);
    expect(text).not.to.include('```json');
  });

  it('hands over the unsaved draft', () => {
    const text = askPrompt({
      org: 'o', site: 's', model, dirty: true,
    });
    expect(text).to.include('unsaved version');
    expect(text).to.include('"title": "Article"');
  });

  it('lists the issues to fix with their location and the current schema', () => {
    const issues = [{ severity: 'error', message: 'Key is missing.', schemaPath: '/properties/x' }];
    const text = fixPrompt({
      org: 'o', site: 's', model, issues,
    });
    expect(text).to.include('- error: Key is missing. (at /properties/x)');
    expect(text).to.include('"title": "Article"');
    expect(text).to.include(`Save the result back to ${PATH}.`);
  });

  it('asks for a new schema in the site schemas folder', () => {
    const text = createPrompt({ org: 'o', site: 's' });
    expect(text).to.include('/o/s/.da/forms/schemas');
    expect(text.endsWith('It should model: ')).to.equal(true);
  });
});
