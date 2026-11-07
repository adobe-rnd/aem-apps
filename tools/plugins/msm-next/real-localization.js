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
import { createLocalization } from '../../localization/core/index.js';
import createLegacyApi from '../../localization/core/api/legacy.js';
import { createConnectors, createLocAdapter } from '../../apps/msm-next/data/real-localization.js';

export { createConnectors };

export default async function createRealLocalization({ org, actions, translateDelay = 0 }) {
  const api = createLegacyApi({ fetch: actions.daFetch });
  const { connectors, error } = await createConnectors({
    daFetch: actions.daFetch, simulatedDelayMs: translateDelay,
  });
  const localization = createLocalization({
    org,
    api,
    actions: { ...actions, loc: createLocAdapter(actions.daFetch) },
    services: connectors ? { translationConnectors: connectors } : {},
  });
  return { ...localization, translationError: error ?? null };
}
