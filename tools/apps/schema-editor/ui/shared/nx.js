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
import { setConfig } from 'https://da.live/nx2/scripts/nx.js';

/**
 * nx2 components read `codeBase` once, on first load, to build `<use href>` icon URLs, which must
 * be same-origin: point it at the app's `ui/`, whose img/icons also has the icons nx2 uses
 * outright. Await before loading any screen.
 */

export const configureNx = () => setConfig({ codeBase: new URL('..', import.meta.url).href.replace(/\/$/, '') });
