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
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDaConfig, isSetupBlocked } from '../../../../tools/apps/publish-requests-inbox/setup.js';

const tab = (...data) => ({ data });

describe('inspectDaConfig', () => {
  it('returns null when neither config is readable, which does not block', () => {
    assert.equal(inspectDaConfig(null, null), null);
    assert.equal(isSetupBlocked(null), false);
  });

  it('blocks only when publish-workflow-config is missing or empty', () => {
    const status = inspectDaConfig({ library: tab() }, { 'publish-workflow-config': tab() });
    assert.deepEqual(status.workflowConfig, { state: 'missing', source: null });
    assert.equal(status.library.state, 'missing');
    assert.equal(status.apps.state, 'missing');
    assert.equal(isSetupBlocked(status), true);
  });

  it('resolves workflow tabs from the site when it has the workflow tab, like the worker', () => {
    const site = { 'publish-workflow-config': tab({ Pattern: '/*', Approvers: 'a@x.com' }) };
    const org = { 'publish-workflow-settings': tab({ key: 'k', value: 'v' }) };
    const status = inspectDaConfig(site, org);
    assert.deepEqual(status.workflowConfig, { state: 'ok', source: 'site' });
    assert.deepEqual(status.settings, { state: 'default', source: null });
    assert.equal(isSetupBlocked(status), false);
  });

  it('falls back to the org for workflow tabs but never for library/apps', () => {
    const org = {
      'publish-workflow-config': tab({ pattern: '/*', approvers: 'a@x.com' }),
      'publish-workflow-settings': tab({ key: 'k', value: 'v' }),
      library: tab({ path: '/tools/plugins/request-for-publish/request-for-publish.html' }),
    };
    const site = {
      apps: tab({ Path: 'https://da.live/app/a/b/tools/apps/publish-requests-inbox/publish-requests-inbox?env=ci' }),
    };
    const status = inspectDaConfig(site, org);
    assert.deepEqual(status.workflowConfig, { state: 'ok', source: 'org' });
    assert.deepEqual(status.settings, { state: 'ok', source: 'org' });
    assert.equal(status.library.state, 'missing');
    assert.deepEqual(status.apps, { state: 'ok', source: 'site' });
  });

  it('needs groups-to-email only when approvers or CC name a distribution list', () => {
    const emails = { 'publish-workflow-config': tab({ Pattern: '/*', Approvers: 'a@x.com, b@x.com' }) };
    assert.equal(inspectDaConfig(emails, null).groups.state, 'not-needed');

    const dlInCc = { 'publish-workflow-config': tab({ Pattern: '/*', Approvers: 'a@x.com', CC: 'web-team' }) };
    assert.equal(inspectDaConfig(dlInCc, null).groups.state, 'missing');

    const dlInStep = {
      'publish-workflow-config': tab({ Pattern: '/*', Workflow: 'legal' }),
      'publish-workflow-steps': tab({ Workflow: 'legal', Approvers: 'legal-team' }),
      'publish-workflow-groups-to-email': tab({ group: 'legal-team', email: 'l@x.com' }),
    };
    assert.deepEqual(inspectDaConfig(dlInStep, null).groups, { state: 'ok', source: 'site' });
  });
});
