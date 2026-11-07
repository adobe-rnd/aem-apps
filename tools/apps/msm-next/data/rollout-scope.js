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
export const PROPAGATING_ACTIONS = ['rollout', 'translate', 'save'];

export function descendantNodes(node, tree) {
  const found = [];
  const walk = (current) => (current?.children ?? []).forEach((child) => {
    const resolved = tree?.nodes?.get(child.key) ?? child;
    found.push(resolved);
    walk(resolved);
  });
  walk(node);
  return found;
}

export function needsRollout(node, tree, action) {
  if (Array.isArray(node)) {
    if (node.length > 1) return true;
    return needsRollout(node[0], tree, action);
  }
  if (!node) return false;
  if (!PROPAGATING_ACTIONS.includes(action)) return false;
  return descendantNodes(node, tree).length > 0;
}
