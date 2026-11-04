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
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLibraryPresentation, applyLibraryPresentation,
} from '../../../../tools/apps/block-library-generator/library-presentation.js';
import { createCardsRequest, CARDS_SOURCE_PATHS } from '../../../../tools/apps/block-library-generator/cards-analysis.js';
import { buildCardsPage } from '../../../../tools/apps/block-library-generator/library-dry-run.js';

const image = 'https://content.da.live/msagolj/ew/.index/image.jpg';
const recipe = (id, body) => ({
  id,
  name: `${id}: querySelector image predicate`,
  description: 'After normalization, children.length === 1; cards.js L10. Unverified.',
  options: [],
  body,
  evidence: [CARDS_SOURCE_PATHS[0]],
  assumptions: ['Source-only diagnostic notes.'],
});
const analysis = () => ({
  blockName: 'cards',
  analysisScope: {},
  structure: {},
  contentRules: {},
  optionAnalysis: { status: 'none-found', supportedOptions: [] },
  derivedBehavior: {},
  sharedBehavior: {},
  warnings: ['Implementation warning.'],
  unknowns: [],
  examples: [
    recipe('not-a-hardcoded-baseline-id', [['image', 'text']]),
    recipe('not-a-hardcoded-text-id', [['text']]),
    recipe('not-a-hardcoded-diagnostic-id', [['mixed']]),
  ],
});
const textNode = (textContent) => ({ nodeType: 3, textContent });
const element = (tagName, attrs = {}, childNodes = []) => ({
  nodeType: 1,
  tagName,
  childNodes,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  hasAttribute: (name) => Object.hasOwn(attrs, name),
  getAttribute: (name) => attrs[name] ?? null,
});
// Structural fixtures test presentation policy; real parser coverage is separate.
function parseHTML(markup) {
  const img = element('IMG', { src: image, alt: '' });
  const p = element('P', {}, [textNode('Author content')]);
  const nodes = {
    image: [img],
    text: [p],
    mixed: [img, p],
  }[markup];
  if (!nodes) throw new Error('Unexpected fixture markup');
  return {
    children: nodes,
    childNodes: nodes,
    textContent: nodes.includes(p) ? 'Author content' : '',
    querySelectorAll: () => nodes,
  };
}

describe('Author-facing library presentation', () => {
  it('provides short copy separate from technical analysis, using content rather than recipe IDs', () => {
    const value = analysis();
    const before = JSON.stringify(value);
    const presentation = createLibraryPresentation(value, parseHTML);
    assert.deepEqual(
      presentation.map((item) => item.name),
      ['Image and text cards', 'Text cards', 'Mixed-content cards'],
    );
    assert.deepEqual(presentation.map((item) => item.advanced), [false, false, true]);
    assert.deepEqual(presentation.map((item) => item.selected), [true, true, false]);
    assert.ok(presentation.every((item) => !/querySelector|children|L10|Unverified/.test(item.description)));
    assert.equal(JSON.stringify(value), before);
  });

  it('uses only explicit author copy for selected output without losing internal evidence', () => {
    const value = analysis();
    const presentation = createLibraryPresentation(value, parseHTML);
    presentation[0].description = 'A reusable set of image-led cards.';
    const projected = applyLibraryPresentation(
      value,
      presentation,
      presentation.filter((item) => item.selected).map((item) => item.id),
    );
    assert.equal(projected.examples.length, 2);
    assert.equal(projected.examples[0].description, 'A reusable set of image-led cards.');
    assert.equal(projected.examples[0].name, 'Image and text cards');
    assert.deepEqual(projected.examples[0].body, value.examples[0].body);
    assert.deepEqual(projected.examples[0].evidence, value.examples[0].evidence);
    assert.match(value.examples[0].description, /querySelector|children/);
    assert.equal(value.examples.length, 3);
  });

  it('preserves meaningful generic variant names without copying technical descriptions', () => {
    const value = {
      ...analysis(),
      blockName: 'commerce-orders-list',
      examples: [
        { ...recipe('full', [['text', 'text']]), name: 'Orders: Full View' },
        { ...recipe('minified', [['text', 'text']]), name: 'Orders: Minified View' },
      ],
    };
    const presentation = createLibraryPresentation(value, parseHTML);
    assert.deepEqual(presentation.map((item) => item.name), ['Orders: Full View', 'Orders: Minified View']);
    assert.ok(presentation.every((item) => !/querySelector|children|L10|Unverified/.test(item.description)));
    assert.ok(presentation.every((item) => item.selected && !item.advanced));
    assert.deepEqual(value.examples.map((example) => example.name), ['Orders: Full View', 'Orders: Minified View']);
  });

  it('does not describe empty automatic component baselines as authored text content', () => {
    const value = {
      ...analysis(),
      blockName: 'commerce-login',
      examples: [{ ...recipe('default', [['']]), name: 'Sign In Form' }],
    };
    const presentation = createLibraryPresentation(value, () => ({
      textContent: '', querySelectorAll: () => [],
    }));
    assert.equal(presentation[0].name, 'Sign In Form');
    assert.doesNotMatch(presentation[0].description, /authored text content/i);
    value.examples[0].name = '';
    assert.throws(() => createLibraryPresentation(value, parseHTML), /name/i);
  });

  it('requires valid author copy and a nonempty known selection rather than falling back to technical text', () => {
    const value = analysis();
    const presentation = createLibraryPresentation(value, parseHTML);
    assert.throws(() => applyLibraryPresentation(value, presentation, []), /select at least one/i);
    assert.throws(() => applyLibraryPresentation(value, presentation, ['missing']), /selection/i);
    presentation[0].description = '';
    assert.throws(() => applyLibraryPresentation(value, presentation, [presentation[0].id]), /description|copy/i);
    assert.throws(() => applyLibraryPresentation(value, [], [value.examples[0].id]), /name and description/i);
  });

  it('can explicitly include an advanced example, and distinguishes similar default names', () => {
    const value = analysis();
    value.examples.push(recipe('another-text', [['text']]));
    const presentation = createLibraryPresentation(value, parseHTML);
    assert.equal(new Set(presentation.map((item) => item.name)).size, 4);
    const projected = applyLibraryPresentation(value, presentation, [value.examples[2].id]);
    assert.equal(projected.examples[0].name, 'Mixed-content cards');
    assert.equal(projected.examples[0].body[0][0], 'mixed');
  });

  it('does not put analysis notes, warnings or source reasoning in generated page metadata', () => {
    const value = analysis();
    const presentation = createLibraryPresentation(value, parseHTML);
    const projected = applyLibraryPresentation(value, presentation, [value.examples[0].id]);
    const request = createCardsRequest({
      environment: 'prod',
      input: {
        prompt: 'Prompt.',
        sourcePage: '/index.html',
        sources: CARDS_SOURCE_PATHS.map((id) => ({ id, content: 'Source.' })),
        images: [{ src: image, alt: '' }],
      },
    });
    const output = buildCardsPage(request, projected, parseHTML);
    assert.match(output, /Image and text cards/);
    assert.doesNotMatch(output, /querySelector|children\.length|cards\.js L10|Unverified|Implementation warning|Source-only diagnostic notes/);
    assert.match(output, /Author content/);
    assert.match(output, /library-metadata/);
    assert.equal(projected.examples.length, 1);
  });
});
