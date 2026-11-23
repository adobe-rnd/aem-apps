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
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { createGraphqlCore } from '../core/operations.js';
import { createDaApi } from './da-api.js';
import { loadServiceUrl as loadUrl } from './da-config.js';
import { createDaStore } from './da-source.js';
import { createReindexNotifier } from './reindex.js';
import { loadValidator } from './sc-validator.js';

// Requests wait for the shell's DA SDK handshake and go through its token-aware fetch.
const api = createDaApi(DA_SDK);

// One lookup per site, shared by the app and the reindex notifier; a failed one is retried.
const serviceUrls = new Map();
export const loadServiceUrl = ({ org, site }) => {
  const key = `/${org}/${site}`;
  if (!serviceUrls.has(key)) {
    const pending = loadUrl({ api, org, site });
    pending.catch(() => serviceUrls.delete(key));
    serviceUrls.set(key, pending);
  }
  return serviceUrls.get(key);
};

const notifyReindex = createReindexNotifier({ loadUrl: loadServiceUrl });

export const core = createGraphqlCore({
  store: createDaStore(api, { notifyReindex }),
  loadValidator,
});
