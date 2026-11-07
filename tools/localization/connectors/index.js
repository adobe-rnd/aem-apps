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
const CONNECTORS = {
  google: () => import('./google/index.js'),
};

const API_VERSION = 1;

export async function loadConnector(name) {
  const load = CONNECTORS[name];
  return load ? load() : null;
}

function pickHostServices(descriptor, host) {
  return Object.fromEntries((descriptor.hostServices || [])
    .filter((service) => typeof host?.[service] === 'function')
    .map((service) => [service, host[service]]));
}

export async function createTranslationConnectors({ name, settings = {}, host = {} } = {}) {
  const connector = await loadConnector(name);
  if (!connector) return { error: { code: 'not-found', message: `Unknown connector: ${name}` } };
  const descriptor = await connector.describe();
  if (descriptor?.apiVersion !== API_VERSION) {
    return { error: { code: 'unknown', message: `Unsupported apiVersion: ${descriptor?.apiVersion}` } };
  }
  const services = pickHostServices(descriptor, host);
  const call = (method, args = {}) => connector[method]({ settings, ...args }, services);
  return {
    connector,
    describe: descriptor,
    call,
    supports: async (src, dest) => (await call('supports', { src, dest }))?.ok === true,
  };
}
