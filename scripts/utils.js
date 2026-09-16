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

// da-nx's nx2 daFetch (nx2/utils/api.js) resolves its IMS module via
// `${window.location.origin}/scripts/utils.js`'s getNx() before falling back
// to bootstrapping its own IMS session. MSM's merge action uses this hook to
// point at a local shim (scripts/nx-shim/utils/ims.js) that hands nx2 a token
// we already have, instead of an IMS session that gets CORS-blocked outside
// da.live's own origin. Nothing else on this domain calls nx2's daFetch, so
// this has no effect elsewhere.
// eslint-disable-next-line import/prefer-default-export
export function getNx() {
  return `${window.location.origin}/scripts/nx-shim`;
}
