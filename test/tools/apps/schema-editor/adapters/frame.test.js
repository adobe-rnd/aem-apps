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
import { requestFrameless } from '../../../../../tools/apps/schema-editor/adapters/frame.js';

describe('requestFrameless', () => {
  it('asks a supporting shell to drop its frame', () => {
    const calls = [];
    const sdk = {
      capabilities: { frameless: 1 },
      actions: { setFrameless: (...args) => calls.push(args) },
    };
    expect(requestFrameless(sdk)).to.equal(true);
    expect(calls).to.deep.equal([[]]);
  });

  it('keeps the frame without the capability, the action or the SDK', () => {
    const setFrameless = () => { throw new Error('should not be called'); };
    expect(requestFrameless({ capabilities: {}, actions: { setFrameless } })).to.equal(false);
    expect(requestFrameless({ capabilities: { frameless: 1 }, actions: {} })).to.equal(false);
    expect(requestFrameless()).to.equal(false);
  });

  it('keeps the frame when the shell refuses', () => {
    const sdk = {
      capabilities: { frameless: 1 },
      actions: { setFrameless: () => { throw new Error('closed'); } },
    };
    expect(requestFrameless(sdk)).to.equal(false);
  });
});
