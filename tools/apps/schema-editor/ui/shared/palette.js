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
// What can be added where: elements plus the components that fit a parent. Shared by every add
// menu (Elements view, canvas "+ Add", inspector "Change item") so they offer the same choices.

import { ELEMENTS, paletteBySection } from '../../core/model/elements.js';
import { wouldCreateCycle } from '../../core/model/query.js';
import { iconFile } from './icons.js';
import { insertElement, insertComponent } from './actions.js';

const SEPARATOR = ':';

function matcher(query) {
  const q = query.trim().toLowerCase();
  return (...texts) => !q || texts.some((text) => text?.toLowerCase().includes(q));
}

/** Non-empty `{ id, label, items }` sections; omits components that would contain themselves. */
export function paletteSections(model, { parentId, query = '' } = {}) {
  const matches = matcher(query);
  const sections = paletteBySection().map(({ id, label, elements }) => ({
    id,
    label,
    items: elements
      .filter((el) => matches(el.label, el.description))
      .map((el) => ({
        type: 'element', id: el.id, label: el.label, icon: el.icon, description: el.description,
      })),
  }));

  const fits = (def) => !parentId
    || !wouldCreateCycle(model, parentId, { kind: 'ref', refDefId: def.id });
  sections.push({
    id: 'components',
    label: 'Components',
    items: (model?.defs ?? [])
      .filter((def) => fits(def) && matches(def.name, def.node.title))
      .map((def) => ({
        type: 'component',
        id: def.id,
        label: def.name,
        icon: 'component',
        description: def.node.title && def.node.title !== def.name
          ? def.node.title
          : 'Reusable component.',
      })),
  });
  return sections.filter((section) => section.items.length);
}

/** `nx-menu` items for the palette (section headings + one item per entry). */
export function paletteMenuItems(model, parentId) {
  return paletteSections(model, { parentId }).flatMap(({ label, items }) => [
    { section: label },
    ...items.map((item) => ({
      id: `${item.type}${SEPARATOR}${item.id}`,
      label: item.label,
      icon: iconFile(item.icon),
    })),
  ]);
}

/** Reverses a `paletteMenuItems` id into `{ type, id }`. */
export function parseMenuId(menuId) {
  const at = menuId.indexOf(SEPARATOR);
  return { type: menuId.slice(0, at), id: menuId.slice(at + 1) };
}

export function insertPaletteItem(store, { type, id }, target) {
  if (type === 'component') return insertComponent(store, id, target);
  const element = ELEMENTS[id];
  return element ? insertElement(store, element, target) : Promise.resolve({ ok: false });
}
