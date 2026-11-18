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
// The worker contract of publish-requests-worker#41: lowercase setup routes, apiUrlRedacted,
// permissionsMode, the new save codes and registration-unavailable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOrgSite, siteFromParams, registrationForm, registrationBody, describeProblem,
  saveErrorText, readSetup, permissionsNotice, PERMISSIONS_DOCS,
} from '../../../../tools/apps/publish-requests-setup/model.js';

test('parseOrgSite lowercases what the user types, as the setup routes require', () => {
  assert.deepEqual(parseOrgSite(' /SagarSane-RND/Dentsply-Demo/ '), { org: 'sagarsane-rnd', site: 'dentsply-demo' });
  assert.deepEqual(parseOrgSite('acme/web'), { org: 'acme', site: 'web' });
  assert.equal(parseOrgSite('/acme'), null);
  assert.equal(parseOrgSite('/a/b/c'), null);
  assert.equal(parseOrgSite(''), null);
});

test('siteFromParams lowercases deep-link values and needs both', () => {
  assert.deepEqual(siteFromParams(new URLSearchParams('org=SagarSane-RND&site=DSG-Protips&env=ci')), { org: 'sagarsane-rnd', site: 'dsg-protips' });
  assert.equal(siteFromParams(new URLSearchParams('org=acme')), null);
  assert.equal(siteFromParams(new URLSearchParams('')), null);
});

test('a redacted apiUrl is never prefilled as editable', () => {
  const redacted = { emailProvider: 'custom-api', apiUrl: 'https://mail.example.com', apiUrlRedacted: true };
  const form = registrationForm(redacted);
  assert.equal(form.apiUrl, '');
  assert.equal(form.apiUrlSet, true);
  assert.match(form.apiUrlHint, /https:\/\/mail\.example\.com/);
  assert.match(form.apiUrlHint, /config admin/i);

  const full = registrationForm({ emailProvider: 'custom-api', apiUrl: 'https://mail.example.com/send?k=1' });
  assert.equal(full.apiUrl, 'https://mail.example.com/send?k=1');
  assert.equal(full.apiUrlSet, false);
  assert.equal(full.apiUrlHint, '');
  assert.equal(registrationForm({}).apiUrl, '');
});

test('registrationBody never sends a redacted apiUrl back', () => {
  const current = { apiUrl: 'https://mail.example.com', apiUrlRedacted: true };
  const form = {
    apiUrl: ' https://mail.example.com ', apiKey: '', fromAddress: 'a@example.com', fromName: ' ',
  };
  assert.deepEqual(registrationBody('custom-api', form, ['example.com'], current), {
    fromAddress: 'a@example.com', emailProvider: 'custom-api', allowedEmailDomains: ['example.com'],
  });
  // A new URL typed over the redacted one is sent.
  assert.equal(registrationBody('custom-api', { apiUrl: 'https://mail.example.com/v2' }, [], current).apiUrl, 'https://mail.example.com/v2');
  // Full apiUrl (editors) round-trips as before.
  assert.equal(registrationBody('custom-api', { apiUrl: 'https://x.example/send' }, [], { apiUrl: 'https://x.example/send' }).apiUrl, 'https://x.example/send');
  assert.deepEqual(registrationBody('default', { apiUrl: 'https://x.example' }, [], {}), {
    emailProvider: 'default', allowedEmailDomains: [], acknowledgeNonProduction: true,
  });
});

test('describeProblem points org-rule errors at the inherited org rules', () => {
  const text = describeProblem({
    field: 'orgTabs.publish-workflow-config[0].workflow', error: "Row 1: workflow 'x' needs Multi Step", code: 'requires-v2',
  });
  assert.match(text, /^Org rules this site inherits \(Rules\): Row 1/);
});

test('describeProblem gives new warning and error codes plain messages', () => {
  assert.match(
    describeProblem({ code: 'single-sheet-inactive', message: 'The site config is a single sheet, which the worker does not read' }),
    /single sheet.*aren't used.*next save/i,
  );
  assert.match(
    describeProblem({ code: 'org-config-unreadable', message: 'The org config of x could not be read' }),
    /org config couldn't be read/i,
  );
  const unstaffed = describeProblem({
    field: 'tabs.publish-workflow-config[0].workflow', code: 'unstaffed-workflow', error: "Row 1: no step of workflow 'legal' has approvers",
  });
  assert.match(unstaffed, /^Rules: Row 1: no step of workflow 'legal' has approvers\. Add approvers/);
  [unstaffed].forEach((t) => assert.doesNotMatch(t, /unstaffed-workflow/));
});

test('saveErrorText explains the new save codes instead of showing them raw', () => {
  const tooLarge = saveErrorText({ status: 413, data: { error: 'The request body is too large (max 512 KiB).', code: 'payload-too-large' } }, 'rules');
  assert.match(tooLarge, /too large to save.*Remove some rows/i);
  assert.match(
    saveErrorText({ status: 413, data: { code: 'payload-too-large' } }, 'registration'),
    /registration is too large/i,
  );
  assert.match(
    saveErrorText({ status: 413, data: { error: 'would exceed 2 MiB', code: 'config-too-large' } }, 'settings'),
    /site's config larger than DA allows \(2 MiB\).*Nothing was saved/i,
  );
  const sheet = saveErrorText({ status: 400, data: { error: "The library sheet has both 'Path' and 'path' columns; keep one and try again.", code: 'install-sheet-incompatible' } }, 'install');
  assert.match(sheet, /^Nothing was installed\. The library sheet has both 'Path' and 'path' columns/);
  assert.match(sheet, /site config/);
  assert.match(
    saveErrorText({ status: 503, data: { error: 'org rules could not be read', code: 'org-config-unreadable' } }, 'rules'),
    /org's rules couldn't be read.*Nothing was saved.*try again/i,
  );
  assert.match(
    saveErrorText({ status: 403, data: { error: 'need read access', code: 'org-config-unreadable' } }, 'install'),
    /read access to the org config.*Nothing was saved/i,
  );
  assert.equal(saveErrorText({ status: 400, data: { error: 'Bad', code: 'something-else' } }, 'rules'), null);
});

test('saveErrorText lists validation errors, with the org rules called out', () => {
  const unstaffed = saveErrorText({
    status: 400,
    data: {
      code: 'unstaffed-workflow',
      errors: [{ field: 'tabs.publish-workflow-config[0].workflow', code: 'unstaffed-workflow', error: "Row 1: no step of workflow 'w' has approvers" }],
    },
  }, 'rules');
  assert.equal(unstaffed.length, 1);
  assert.match(unstaffed[0], /^Rules: Row 1/);

  const inherited = saveErrorText({
    status: 400,
    data: {
      code: 'requires-v2',
      errors: [{ field: 'orgTabs.publish-workflow-config[0].workflow', code: 'requires-v2', error: 'Row 1 uses a workflow' }],
    },
  }, 'install');
  assert.match(inherited[0], /org's .*rules this site inherits/i);
  assert.match(inherited[0], /Nothing was saved/);
  assert.match(inherited[1], /^Org rules this site inherits/);

  const siteV2 = saveErrorText({
    status: 400,
    data: { errors: [{ field: 'tabs.publish-workflow-config[0].workflow', code: 'requires-v2', error: 'Row 1 uses a workflow' }] },
  }, 'install');
  assert.match(siteV2[0], /this site's Request Publish - Multi Step rules/);
});

test('readSetup carries permissionsMode, and an unreadable registration is not "unregistered"', () => {
  const view = {
    active: 'site', version: 'h1', siteTabs: {}, orgTabs: null, validation: { errors: [], warnings: [] },
  };
  const setup = readSetup({
    ok: true,
    status: 200,
    data: {
      registration: null, canEdit: true, permissionsMode: 'open', workflowConfig: view,
    },
  });
  assert.equal(setup.permissionsMode, 'open');
  assert.equal(setup.workflow.permissionsMode, 'open');
  assert.equal(readSetup({ ok: true, status: 200, data: { registration: null, workflowConfig: view } }).permissionsMode, 'unknown');

  ['registration-unavailable', undefined].forEach((code) => {
    const outage = readSetup({ ok: false, status: 503, data: { error: 'Unable to read the site registration.', code } });
    assert.equal(outage.registration.status, 'unknown');
    assert.equal(outage.problem, 'unavailable');
    assert.equal(outage.permissionsMode, 'unknown');
  });
});

test('permissionsNotice warns only for an open org', () => {
  assert.match(permissionsNotice('open'), /anyone can change this site's config/i);
  assert.match(permissionsNotice('open'), /no permissions sheet/i);
  assert.equal(permissionsNotice('restricted'), null);
  assert.equal(permissionsNotice('unknown'), null);
  assert.equal(permissionsNotice(undefined), null);
  assert.equal(PERMISSIONS_DOCS, 'https://www.aem.live/docs/ew/administering/permissions');
});
