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
import { getNx2 } from './nx.js';

const nx2 = getNx2();
const { loadStyle, loadPageStyle } = await import(`${nx2}/utils/utils.js`);

// Sheets every view adopts: nx2 S2 buttons + the editor's shared primitives (chips, badges…).
// `bar`: the top bar chrome the browse and author screens share. Alongside, the page gets the
// nx2 S2 styles whose tokens (`--s2-*`) all of them read.
export const [buttons, shared, bar] = await Promise.all([
  loadStyle(`${nx2}/styles/buttons.css`),
  loadStyle(import.meta.url),
  loadStyle(new URL('./bar.css', import.meta.url).href),
  loadPageStyle(`${nx2}/styles/styles.css`),
]);

export { loadStyle };
