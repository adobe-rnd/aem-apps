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

// Stand-in for da-nx's own ims.js, resolved by nx2/utils/api.js's daFetch via
// ../../utils.js's getNx(). Reads the live token nx1's daFetch.js already
// maintains — DA_SDK (nx/utils/sdk.js) keeps it current for the life of the
// page via setImsDetails on every postMessage token refresh, which is the
// same mechanism every other MSM action already relies on. Falls through to
// da-nx's real IMS flow only when no such token exists.

async function currentDetails() {
  const { initIms } = await import('https://da.live/nx/utils/daFetch.js');
  return initIms();
}

export async function loadIms() {
  const details = await currentDetails();
  if (details?.accessToken) return details;
  const { loadIms: realLoadIms } = await import('https://da.live/nx/utils/ims.js');
  return realLoadIms();
}

export async function handleSignIn() {
  const details = await currentDetails();
  if (details?.accessToken) return;
  const { handleSignIn: realHandleSignIn } = await import('https://da.live/nx/utils/ims.js');
  realHandleSignIn();
}
