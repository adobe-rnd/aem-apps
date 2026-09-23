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
