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
let counter = 0;

/** Node ids only need to be unique within an editing session; they are never serialized. */
// eslint-disable-next-line import/prefer-default-export
export function createId() {
  counter += 1;
  return `n${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
