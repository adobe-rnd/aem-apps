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
import { viewsFor, shownView } from '../../../../../../tools/apps/schema-editor/ui/panel/views.js';

const ids = (mode) => viewsFor(mode).map((view) => view.id);

describe('tool panel views', () => {
  it('leaves Components out of Build, which has its own Components page', () => {
    expect(ids('build')).to.deep.equal(['elements', 'properties', 'issues']);
    expect(ids('components')).to.deep.equal(['elements', 'properties', 'components', 'issues']);
  });

  it('shows the picked view, else the default where the mode leaves it out', () => {
    expect(shownView('components', 'components')).to.equal('components');
    expect(shownView('components', 'build')).to.equal('elements');
    expect(shownView('issues', 'build')).to.equal('issues');
    expect(shownView('missing', 'components')).to.equal('elements');
  });
});
