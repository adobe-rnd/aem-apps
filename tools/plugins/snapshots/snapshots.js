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
import { daFetch, setImsDetails } from 'https://da.live/nx/utils/daFetch.js';
import { createSnapshotApi } from 'https://da.live/nx/public/snapshot/api.js';
import { normalizeContext } from './utils.js';
import './panel.js';

function makePanel({ context, token, actions }) {
  if (token) setImsDetails(token);
  const page = normalizeContext(context);
  const panel = document.createElement('snapshots-panel');
  panel.context = context;
  if (page) {
    const fetch = actions?.daFetch || daFetch;
    panel.api = createSnapshotApi({ fetch, org: page.org, site: page.site });
  }
  return panel;
}

export default async function init(sdk) {
  return {
    title: 'Snapshots',
    searchEnabled: false,
    panel: { render: (container) => container.append(makePanel(sdk)) },
  };
}

if (document.querySelector('script[src$="/snapshots.js"]')) {
  try {
    document.body.append(makePanel(await DA_SDK));
  } catch {
    const message = document.createElement('p');
    message.textContent = 'The snapshots plugin could not start. Reopen it from the editor.';
    document.body.append(message);
  }
}
