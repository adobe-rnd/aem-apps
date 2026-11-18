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
// What the Properties JSON view shows for a node, as saved. Pure, so it is unit-tested.

import { serializeNode, defNameResolver, stringifySchema } from '../../core/model/serialize.js';
import { getDef } from '../../core/model/query.js';

const pretty = (value) => JSON.stringify(value ?? null, null, 2);

function componentSection(model, def) {
  return {
    title: `The ${def.name} component`,
    what: `${def.name} JSON`,
    json: pretty(serializeNode(def.node, defNameResolver(model))),
  };
}

/**
 * A node's JSON sections `{ title, what, json }`; `what` names the copied text. A component use
 * shows its reference, then the component whose fields the canvas shows under the use.
 */
export function jsonSections(model, node) {
  if (!node) return [];
  if (node === model.root) {
    return [{ title: 'The whole schema file', what: 'Schema JSON', json: stringifySchema(model) }];
  }
  const own = model.defs.find((def) => def.node === node);
  if (own) return [componentSection(model, own)];

  const json = pretty(serializeNode(node, defNameResolver(model)));
  const def = node.kind === 'ref' ? getDef(model, node.refDefId) : null;
  if (!def) return [{ title: 'JSON of this element', what: 'JSON', json }];
  return [
    { title: 'This field, saved as a reference', what: 'Reference JSON', json },
    componentSection(model, def),
  ];
}
