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

export const json = (data, init) => () => Response.json(data, init);
export const status = (code) => () => new Response(null, { status: code });

const announce = (hlx6) => () => new Response(null, {
  headers: hlx6 ? { 'x-api-upgrade-available': 'true' } : {},
});

/**
 * A DA SDK whose `actions.daFetch` answers from `routes`, keyed `METHOD url`, each a
 * function of the request options returning a Response or throwing. Unrouted requests
 * answer 404. `ping` answers the AEM admin ping; by default it announces `hlx6`.
 */
export function createFakeSdk({
  routes = {}, hlx6 = false, ping = announce(hlx6), daOrigin = 'https://admin.da.live',
} = {}) {
  const calls = [];
  const daFetch = async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ method, url, opts });
    if (url.startsWith('https://admin.hlx.page/ping/')) return ping(opts);
    return routes[`${method} ${url}`]?.(opts) ?? new Response(null, { status: 404 });
  };
  const requests = () => calls.filter(({ url }) => !url.includes('/ping/'));
  const pings = () => calls.filter(({ url }) => url.includes('/ping/'));
  return {
    sdk: { context: { daOrigin }, actions: { daFetch } }, calls, requests, pings,
  };
}
