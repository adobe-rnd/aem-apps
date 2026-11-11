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
/* global globalThis */
import { afterEach, describe, it } from 'node:test';
import { expect } from '../../expect.js';
import {
  plural, usesPhrase, usedTimes, usageLabel, modKey,
} from '../../../../../../tools/apps/schema-editor/ui/shared/format.js';

describe('format', () => {
  it('pluralizes counts', () => {
    expect(plural(1, 'field')).to.equal('1 field');
    expect(plural(3, 'field')).to.equal('3 fields');
    expect(plural(2, 'entry', 'entries')).to.equal('2 entries');
  });

  it('describes where a component change applies', () => {
    expect(usesPhrase(0)).to.equal('every use');
    expect(usesPhrase(1)).to.equal('every use');
    expect(usesPhrase(2)).to.equal('both uses');
    expect(usesPhrase(5)).to.equal('all 5 uses');
  });

  it('says how often a component is used', () => {
    expect(usedTimes(1)).to.equal('once');
    expect(usedTimes(3)).to.equal('3 times');
    expect(usageLabel(0)).to.equal('Not used');
    expect(usageLabel(1)).to.equal('Used once');
    expect(usageLabel(2)).to.equal('Used 2 times');
  });

  describe('shortcut modifier', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const fake = (value) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
    afterEach(() => Object.defineProperty(globalThis, 'navigator', real));

    it('shows ⌘ on Apple devices and Ctrl+ elsewhere', () => {
      fake({ userAgentData: { platform: 'macOS' } });
      expect(modKey()).to.equal('⌘');
      fake({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' });
      expect(modKey()).to.equal('⌘');
      fake({ userAgentData: { platform: 'Windows' }, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
      expect(modKey()).to.equal('Ctrl+');
    });
  });
});
