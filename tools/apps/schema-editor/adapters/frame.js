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
/** Asks the shell to drop its frame so the app draws its own surfaces; false on older hosts. */
// eslint-disable-next-line import/prefer-default-export
export function requestFrameless(sdk) {
  if (sdk?.capabilities?.frameless !== 1
    || typeof sdk.actions?.setFrameless !== 'function') return false;
  try {
    sdk.actions.setFrameless();
    return true;
  } catch {
    return false;
  }
}
