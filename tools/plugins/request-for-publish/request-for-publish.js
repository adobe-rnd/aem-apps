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
import { createClient, workerOrigin, createWorkspaceActions } from './workflow.js';
import './panel.js';

function makePanel({
  context, token, actions, capabilities,
}) {
  if (token) setImsDetails(token);
  const request = actions?.daFetch || daFetch;
  const content = (operation) => (page) => {
    const { org, site, path } = page;
    const { href } = new URL(`https://admin.hlx.page/${operation}/${org}/${site}/main${path}`);
    return request(`https://da-etc.adobeaem.workers.dev/cors?url=${encodeURIComponent(href)}`, { method: 'POST' });
  };
  const panel = document.createElement('request-for-publish');
  panel.context = context;
  panel.workspace = createWorkspaceActions({ actions, capabilities });
  panel.client = createClient({
    base: workerOrigin(window.location),
    request,
    preview: content('preview'),
    publish: content('live'),
    beforePreview: () => panel.workspace.save(),
  });
  return panel;
}

export default async function init(sdk) {
  return {
    title: 'Publish request',
    searchEnabled: false,
    panel: { render: (container) => container.append(makePanel(sdk)) },
  };
}

if (document.querySelector('script[src$="/request-for-publish.js"]')) {
  try {
    document.body.append(makePanel(await DA_SDK));
  } catch {
    const message = document.createElement('p');
    message.textContent = 'The publish request plugin could not start. Reopen it from the editor.';
    document.body.append(message);
  }
}
