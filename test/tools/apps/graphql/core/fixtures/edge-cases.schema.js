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
// Array root, hyphenated keys, recursion, empty object, unresolved $ref,
// reserved keys, an array of arrays and a node without a type.
export default {
  $defs: {
    Node: {
      type: 'object',
      title: 'Node',
      properties: {
        label: { type: 'string', title: 'Label' },
        children: { type: 'array', title: 'Children', items: { $ref: '#/$defs/Node' } },
      },
    },
  },
  type: 'array',
  title: 'Menu',
  items: {
    type: 'object',
    title: 'Menu entry',
    properties: {
      'first-name': { type: 'string', title: 'First name' },
      tree: { $ref: '#/$defs/Node' },
      extra: { type: 'object', title: 'Extra', properties: {} },
      missing: { $ref: '#/$defs/Missing' },
      metadata: { type: 'string', title: 'Reserved' },
      matrix: {
        type: 'array',
        title: 'Matrix',
        items: { type: 'array', title: 'Row', items: { type: 'number', title: 'Cell' } },
      },
      unknown: { title: 'No type' },
    },
  },
};
