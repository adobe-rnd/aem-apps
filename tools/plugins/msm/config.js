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
/* eslint-disable import/no-unresolved */

// Thin adapter over the shared MSM core. The dialog runs in a cross-origin
// iframe and must route fetches through the host's `actions.daFetch`, which it
// injects via `setSdkFetch` (re-exported as the core fetch setter).

export { setDaFetch as setSdkFetch } from '../../apps/msm/core/fetch.js';
export {
  getSiteConfig,
  getLinkedTree,
  getSubtreeLinked,
  getLinkedSites,
  getSourceSite,
  clearMsmCache,
} from '../../apps/msm/core/config.js';
export { getPageTimestamp } from '../../apps/msm/core/status.js';
