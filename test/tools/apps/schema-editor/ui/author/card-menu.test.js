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
import { cardMenuItems } from '../../../../../../tools/apps/schema-editor/ui/author/card-menu.js';

const ids = (items) => items.map((item) => (item.divider ? '-' : item.id));
const text = (key) => ({ kind: 'string', key });
const group = (...children) => ({ kind: 'object', children });

describe('card menu', () => {
  it('moves a field within its group, one way at either end', () => {
    const [first, middle, last] = [text('a'), text('b'), text('c')];
    const parent = group(first, middle, last);
    expect(ids(cardMenuItems(middle, parent)))
      .to.deep.equal(['properties', '-', 'up', 'down', 'duplicate', '-', 'json', 'delete']);
    expect(ids(cardMenuItems(first, parent))).to.not.include('up');
    expect(ids(cardMenuItems(last, parent))).to.not.include('down');
  });

  it('neither moves nor duplicates a List item', () => {
    const item = text('item');
    expect(ids(cardMenuItems(item, { kind: 'array', item })))
      .to.deep.equal(['properties', '-', 'json', 'delete']);
  });

  it('offers to edit or detach a component use', () => {
    const use = { kind: 'ref', key: 'venue' };
    expect(ids(cardMenuItems(use, group(use))))
      .to.deep.equal(['properties', '-', 'duplicate', '-', 'edit', 'detach', '-', 'json', 'delete']);
  });

  it('turns a nested Group or List into a component, but not a component top', () => {
    const nested = group();
    expect(ids(cardMenuItems(nested, group(nested)))).to.include('component');
    expect(ids(cardMenuItems({ kind: 'array', key: 'tags' }, group()))).to.include('component');
    expect(ids(cardMenuItems(text('a'), group()))).to.not.include('component');
    expect(ids(cardMenuItems(group(), null)))
      .to.deep.equal(['properties', '-', 'json', 'deleteDef']);
  });

  it('names icons semantically, for the canvas to resolve', () => {
    const items = cardMenuItems(text('a'), group(text('a')));
    expect(items.find((item) => item.id === 'json').icon).to.equal('code');
    expect(items.find((item) => item.id === 'delete').icon).to.equal('delete');
  });
});
