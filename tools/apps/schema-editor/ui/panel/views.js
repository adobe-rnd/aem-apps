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
// The tool panel views in tab order, each loaded when its tab first opens and given `.store`.
// A view may implement `applyRequest(request)` for the rest of a `panelRequest` that shows it.
// `hiddenIn` lists the modes whose panel leaves the view out.

const view = (id, label, tag, load, { hiddenIn = [] } = {}) => Object.freeze({
  id, label, tag, load, hiddenIn,
});

const VIEWS = Object.freeze([
  // First on the Components page, where it picks the component shown. Build has that page
  // one header tab away instead.
  view('components', 'Components', 'se-components', () => import('./components.js'), {
    hiddenIn: ['build'],
  }),
  view('elements', 'Elements', 'se-elements', () => import('./elements.js')),
  view('properties', 'Properties', 'se-properties', () => import('./properties.js')),
  view('issues', 'Issues', 'se-issues', () => import('./issues.js')),
]);

export const DEFAULT_VIEW = 'elements';

export const viewById = (id) => VIEWS.find((candidate) => candidate.id === id);

export const viewsFor = (mode) => VIEWS.filter((candidate) => !candidate.hiddenIn.includes(mode));

/** The view shown in `mode` when `id` was picked: it, else the default. */
export function shownView(id, mode) {
  return viewsFor(mode).some((candidate) => candidate.id === id) ? id : DEFAULT_VIEW;
}
