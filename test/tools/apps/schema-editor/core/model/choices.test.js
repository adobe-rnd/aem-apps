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
  nextChoice, parseChoices, moveChoice, renameChoice,
} from '../../../../../../tools/apps/schema-editor/core/model/choices.js';

describe('choice lists', () => {
  it('names a new choice after the first free "Option N"', () => {
    expect(nextChoice([])).to.equal('Option 1');
    expect(nextChoice(['Option 2'])).to.equal('Option 3');
    expect(nextChoice(['a', 'b'])).to.equal('Option 3');
  });

  it('parses one trimmed choice per pasted line, without blanks or duplicates', () => {
    expect(parseChoices('a\r\n b \n\na\n')).to.deep.equal(['a', 'b']);
  });

  it('moves a choice, or keeps the list when it cannot move', () => {
    const list = ['a', 'b', 'c'];
    expect(moveChoice(list, 0, 1)).to.deep.equal(['b', 'a', 'c']);
    expect(moveChoice(list, 2, 0)).to.deep.equal(['c', 'a', 'b']);
    expect(moveChoice(list, 1, 1)).to.equal(list);
    expect(moveChoice(list, 0, -1)).to.equal(list);
    expect(moveChoice(list, 2, 3)).to.equal(list);
  });

  it('renames a choice and keeps the default on it', () => {
    expect(renameChoice({ enum: ['a', 'b'], default: 'b' }, 1, 'B'))
      .to.deep.equal({ enum: ['a', 'B'], default: 'B' });
    expect(renameChoice({ enum: ['a', 'b'], default: 'a' }, 1, 'B'))
      .to.deep.equal({ enum: ['a', 'B'], default: 'a' });
  });
});
