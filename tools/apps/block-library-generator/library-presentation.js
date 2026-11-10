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
import { parseInertHTML } from './cards-analysis.js';

export function createLibraryPresentation(analysis, parseHTML = parseInertHTML) {
  if (!Array.isArray(analysis?.examples)) throw new Error('A recipe list is required for library copy.');
  const blockName = analysis.blockName || 'cards';
  const title = blockName.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  const names = new Map();
  return analysis.examples.map((example) => {
    if (blockName !== 'cards' && (typeof example.name !== 'string' || !example.name.trim())) {
      throw new Error('Every generic example needs a descriptive library name.');
    }
    let images = false;
    let text = false;
    let mixed = false;
    example.body.flat().forEach((markup) => {
      const cell = parseHTML(markup);
      const hasImage = [...cell.querySelectorAll('*')].some((node) => node.tagName === 'IMG');
      const hasText = Boolean(cell.textContent?.trim());
      images ||= hasImage;
      text ||= hasText;
      mixed ||= hasImage && hasText;
    });
    let name = 'Text cards';
    let description = 'Cards for text-led content such as headings and descriptions.';
    if (images) {
      name = text ? 'Image and text cards' : 'Image cards';
      description = text ? 'Cards with images and separate text content.' : 'Cards containing images.';
    }
    if (mixed) {
      name = 'Mixed-content cards';
      description = 'Cards with images and text in the same content area.';
    }
    if (blockName !== 'cards') {
      name = example.name.trim();
      description = `${title} example. Review and adapt the block for your page.`;
    }
    const count = (names.get(name) || 0) + 1;
    names.set(name, count);
    return {
      id: example.id,
      name: count === 1 ? name : `${name} ${count}`,
      description,
      advanced: blockName === 'cards' && mixed,
      selected: blockName !== 'cards' || !mixed,
    };
  });
}

export function applyLibraryPresentation(analysis, presentation, selectedIds) {
  if (!Array.isArray(selectedIds) || !selectedIds.length) {
    throw new Error('Select at least one example for the library.');
  }
  if (new Set(selectedIds).size !== selectedIds.length
    || selectedIds.some((id) => !analysis.examples.some((example) => example.id === id))) {
    throw new Error('The example selection does not match this draft.');
  }
  const selected = analysis.examples.filter((example) => selectedIds.includes(example.id));
  const examples = selected.map((example) => {
    const copy = presentation?.find((item) => item.id === example.id);
    if (!copy || typeof copy.name !== 'string' || !copy.name.trim()
      || typeof copy.description !== 'string' || !copy.description.trim()) {
      throw new Error('Every selected example needs a library name and description; analysis notes are not a fallback.');
    }
    return { ...example, name: copy.name, description: copy.description };
  });
  return { ...analysis, examples };
}
