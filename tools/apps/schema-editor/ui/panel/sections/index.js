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
// Section id → template, for the ids `sectionsFor` returns and element descriptors list.

import { general, behavior } from './general.js';
import { length, range, pattern } from './constraints.js';
import { choices } from './choices.js';
import { defaultValue } from './default.js';
import { fields, items } from './structure.js';
import { reference, component, root } from './component.js';
import { advanced, unsupported } from './advanced.js';

export const SECTIONS = Object.freeze({
  root,
  component,
  reference,
  general,
  behavior,
  length,
  pattern,
  range,
  choices,
  default: defaultValue,
  fields,
  items,
  unsupported,
  advanced,
});
