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
import { blockedUseFromPath } from '../../../../../../tools/apps/schema-editor/ui/author/drop-target.js';

// Stand-ins for the elements of a drag event's composed path, innermost first.
const el = (dataset = {}, role = null) => ({ dataset, getAttribute: () => role });
const tree = el({}, 'tree');
const use = el({ key: 'venue', nodeId: 'venue' });
const top = el({ key: 'root', nodeId: 'root' });
const lockedBody = el({ locked: '' });
const lockedRow = el({ locked: '', key: 'venue/city', nodeId: 'city' });

describe('blockedUseFromPath', () => {
  it('names the use whose previewed rows are under the pointer', () => {
    const path = [{}, el(), lockedRow, lockedBody, use, el(), top, tree, {}];
    expect(blockedUseFromPath(path)).to.deep.equal({ key: 'venue', nodeId: 'venue' });
  });

  it('names the outermost use for a use nested in a preview', () => {
    const nested = el({ locked: '', key: 'venue/geo', nodeId: 'geo' });
    const path = [lockedRow, lockedBody, nested, lockedBody, use, top, tree];
    expect(blockedUseFromPath(path)).to.deep.equal({ key: 'venue', nodeId: 'venue' });
  });

  it('is null outside a preview', () => {
    expect(blockedUseFromPath([el(), use, el(), top, tree])).to.equal(null);
    expect(blockedUseFromPath([tree, lockedBody, use])).to.equal(null);
  });
});
