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
import {
  cardIcon, compactChips, constraintChips,
} from '../../../../../../tools/apps/schema-editor/ui/author/card-info.js';

describe('card icon', () => {
  it('leads every card with its type icon', () => {
    expect(cardIcon({ kind: 'object' })).to.equal('group');
    expect(cardIcon({ kind: 'array' })).to.equal('list');
    expect(cardIcon({ kind: 'string', variant: 'date' })).to.equal('calendar');
    expect(cardIcon({ kind: 'boolean' })).to.equal('boolean');
    expect(cardIcon({ kind: 'ref' })).to.equal('component');
    expect(cardIcon({ kind: 'unsupported' })).to.equal('alert');
  });

  it('opens a component with the component icon', () => {
    expect(cardIcon({ kind: 'object' }, { def: { id: 'd' } })).to.equal('component');
    expect(cardIcon({ kind: 'string', variant: 'text' }, { def: { id: 'd' } })).to.equal('component');
  });
});

describe('constraint chips', () => {
  it('uses the singular for one', () => {
    expect(constraintChips({ kind: 'array', minItems: 1 })).to.deep.equal(['≥ 1 item']);
    expect(constraintChips({ kind: 'array', minItems: 1, maxItems: 1 })).to.deep.equal(['1 item']);
    expect(constraintChips({ kind: 'array', minItems: 1, maxItems: 3 })).to.deep.equal(['1–3 items']);
    expect(constraintChips({ kind: 'string', maxLength: 1 })).to.deep.equal(['≤ 1 char']);
    expect(constraintChips({ kind: 'string', maxLength: 80 })).to.deep.equal(['≤ 80 chars']);
  });
});

describe('compact chips', () => {
  it('keeps Required and Read-only and counts the other rules', () => {
    const node = {
      kind: 'string', required: true, readOnly: true, maxLength: 80, pattern: '^a',
    };
    expect(compactChips(node)).to.deep.equal(['Required', 'Read-only', '+2']);
  });

  it('only counts when there is nothing to keep', () => {
    expect(compactChips({ kind: 'number', minimum: 0, default: 1 })).to.deep.equal(['+2']);
  });

  it('is empty without chips', () => {
    expect(compactChips({ kind: 'boolean' })).to.deep.equal([]);
    expect(compactChips({ kind: 'string', required: true })).to.deep.equal(['Required']);
  });
});
