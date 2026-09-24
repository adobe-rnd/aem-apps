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
// eslint-disable-next-line import/no-unresolved, import/no-absolute-path
import SDK from '/nx/utils/sdk.js';
import '../../tools/plugins/request-for-publish/panel.js';
import { createWorkspaceActions, normalizeContext } from '../../tools/plugins/request-for-publish/workflow.js';
import fixture, { pending } from '../tools/plugins/request-for-publish/fixture-client.js';

const sdk = await SDK;
const context = normalizeContext(sdk.context);
const workspace = createWorkspaceActions(sdk);
const approver = new URLSearchParams(window.location.search).get('view') === 'approver';
const { client } = fixture({
  context,
  role: approver ? 'approver' : 'requester',
  rows: approver ? [{ ...pending, path: context.path, comment: 'Updated seasonal copy and delivery information.' }] : [],
  beforePreview: () => workspace.save(),
});
const panel = document.createElement('request-for-publish');
panel.context = context;
panel.client = client;
panel.workspace = workspace;
document.body.append(panel);
