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

/*
 * Each App and Plugin under tools/ is served standalone from its own folder
 * and does not share modules across directories, so this logic cannot be
 * imported from elsewhere. If an equivalent fix is added for another App or
 * Plugin (e.g. tools/plugins/request-for-publish), keep the logic consistent.
 */

const PROD_IMS_PROFILE_URL = 'https://ims-na1.adobelogin.com/ims/profile/v1';

/**
 * Decode the payload segment of a JWT without verifying the signature.
 * @param {string} token - The JWT
 * @returns {Object|null} The decoded payload, or null if undecodable
 */
function decodeJwtPayload(token) {
  try {
    const segment = token?.split('.')[1];
    if (!segment) return null;
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Resolve the IMS profile endpoint for the environment that issued the token.
 * The `as` (auth source) claim names the issuing cluster, e.g. `ims-na1` for
 * prod and `ims-na1-stg1` for stage; a stage token is rejected by the prod
 * endpoint. Falls back to the prod endpoint when the claim is missing or the
 * token cannot be decoded, so prod behavior is unchanged.
 * @param {string} token - The IMS access token (JWT)
 * @returns {string} The IMS profile URL for the token's environment
 */
export default function getImsProfileUrl(token) {
  const authSource = decodeJwtPayload(token)?.as;
  // Only a simple cluster name may become a host label; anything else falls
  // back to prod so a malformed claim can never redirect the token elsewhere.
  if (typeof authSource === 'string' && /^[a-z0-9-]+$/i.test(authSource)) {
    return `https://${authSource}.adobelogin.com/ims/profile/v1`;
  }
  return PROD_IMS_PROFILE_URL;
}
