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

// Pure: the actions a canvas card's menu offers, by where its node sits. Item ids name the
// card actions `<se-canvas>` runs; key presses map to the same ids (see `cardKeyCommand`).

import { isContainer } from './card-info.js';

/**
 * `nx-menu` items for a card, with semantic icon names (`ui/shared/icons.js`). Moving and
 * duplicating need a Group parent; a component's top (no parent) deletes the component.
 */
// eslint-disable-next-line import/prefer-default-export
export function cardMenuItems(node, parent) {
  const inGroup = parent?.kind === 'object';
  const siblings = inGroup ? parent.children : [];
  const index = siblings.indexOf(node);
  const items = [{ id: 'properties', label: 'Properties', icon: 'properties' }];
  if (inGroup) {
    items.push({ divider: true });
    if (index > 0) items.push({ id: 'up', label: 'Move up' });
    if (index < siblings.length - 1) items.push({ id: 'down', label: 'Move down' });
    items.push({ id: 'duplicate', label: 'Duplicate', icon: 'duplicate' });
  }
  if (node.kind === 'ref') {
    items.push({ divider: true });
    items.push({ id: 'edit', label: 'Edit component', icon: 'component' });
    items.push({ id: 'detach', label: 'Detach from component' });
  } else if (isContainer(node) && parent) {
    items.push({ divider: true });
    items.push({ id: 'component', label: 'Make reusable component', icon: 'component' });
  }
  items.push({ divider: true });
  items.push({ id: 'json', label: 'View JSON', icon: 'code' });
  if (parent) items.push({ id: 'delete', label: 'Delete', icon: 'delete' });
  else items.push({ id: 'deleteDef', label: 'Delete component', icon: 'delete' });
  return items;
}
