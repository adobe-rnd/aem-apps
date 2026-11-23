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

const NX = 'https://da.live/nx';

/**
 * Base URL of da-nx's nx2 build: the components, utils and S2 styles the views load, always as
 * `await import(`${getNx2()}/…`)`, never by a literal URL (lint enforces it). nx2 is expected to
 * become nx; then this returns `NX` and nothing else changes, as with `getNx2` in da-live's
 * scripts/utils.js.
 */
export const getNx2 = () => `${NX}2`;
