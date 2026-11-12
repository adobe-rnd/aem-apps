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
import { loadStyle } from 'https://da.live/nx2/utils/utils.js';

// Sheets every view adopts: nx2 S2 buttons + the editor's shared primitives (chips, badges…).
export const [buttons, shared] = await Promise.all([
  loadStyle('https://da.live/nx2/styles/buttons.css'),
  loadStyle(import.meta.url),
]);

export { loadStyle };
