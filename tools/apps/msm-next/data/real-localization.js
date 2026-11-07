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
import { createLocalization } from '../../../localization/core/index.js';
import createLegacyApi, { DA_ORIGIN } from '../../../localization/core/api/legacy.js';
import createPageInfoProvider from '../../../localization/core/providers/page-info.js';

const NX_LOC = 'https://da.live/nx/public/loc/index.js';

function createLocAdapter(daFetch) {
  let engine;
  const load = () => {
    engine ??= import(NX_LOC);
    return engine;
  };
  const run = (method) => async (options) => {
    const module = await load();
    return module[method]({ fetch: daFetch, daOrigin: DA_ORIGIN, ...options });
  };
  return { mergeCopy: run('mergeCopy'), overwriteCopy: run('overwriteCopy') };
}

export default function createRealLocalization({ org, actions }) {
  const api = createLegacyApi({ fetch: actions.daFetch });
  const pageInfo = createPageInfoProvider({ org, api });
  const localization = createLocalization({
    org,
    api,
    actions: { ...actions, loc: createLocAdapter(actions.daFetch) },
  });
  return { ...localization, list: pageInfo.list };
}
