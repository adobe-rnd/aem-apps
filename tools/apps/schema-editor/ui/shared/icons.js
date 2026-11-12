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
import { nothing } from 'da-lit';

// Semantic icon name → S2 icon file in ui/img/icons (the files nx2 components also reference by
// name, see ./nx.js). Element descriptors use the semantic names only.
const FILES = {
  text: 'text',
  textArea: 'textparagraph',
  choice: 'radiobutton',
  number: 'ruler',
  integer: 'listnumbered',
  boolean: 'switch',
  calendar: 'calendar',
  clock: 'clock',
  dateTime: 'clockpending',
  group: 'group',
  list: 'listbulleted',
  component: 'layers',
  add: 'add',
  alert: 'alerttriangle',
  info: 'infocircle',
  check: 'checkmarkcircle',
  close: 'close',
  chevronDown: 'chevrondown',
  chevronRight: 'chevronright',
  chevronLeft: 'chevronleft',
  chevronUp: 'chevronup',
  copy: 'copy',
  delete: 'delete',
  drag: 'draghandle',
  duplicate: 'duplicate',
  edit: 'edit',
  key: 'key',
  lock: 'lock',
  more: 'more',
  chat: 'splitleft',
  panel: 'splitright',
  properties: 'properties',
  redo: 'redo',
  save: 'savefloppy',
  search: 'search',
  undo: 'undo',
  code: 'code',
  schema: 'filetext',
  unlink: 'unlink',
  ai: 'aigenerate',
};

const iconUrl = (file) => new URL(`../img/icons/s2-icon-${file}-20-n.svg`, import.meta.url).href;

async function loadSvg(href) {
  try {
    const resp = await fetch(href);
    if (!resp.ok) return null;
    const doc = new DOMParser().parseFromString(await resp.text(), 'image/svg+xml');
    return doc.querySelector('svg');
  } catch {
    return null;
  }
}

const NODES = Object.fromEntries(
  (await Promise.all(
    Object.entries(FILES).map(async ([name, file]) => [name, await loadSvg(iconUrl(file))]),
  )).filter(([, svg]) => svg),
);

export function icon(name, className) {
  const svg = NODES[name];
  if (!svg) return nothing;
  const node = svg.cloneNode(true);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  return node;
}

/** The icon file of a semantic name, for components that take icon file names (nx-menu). */
export const iconFile = (name) => FILES[name];

/** The icon URL of a semantic name, for components that take icon URLs (nx-segmented-btn). */
export const iconHref = (name) => iconUrl(FILES[name]);
