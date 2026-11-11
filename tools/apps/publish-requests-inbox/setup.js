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

const WORKFLOW_TAB = 'publish-workflow-config';

const rowsOf = (config, tab) => config?.[tab]?.data || [];

const cell = (row, key) => Object.entries(row || {})
  .find(([header]) => header.toLowerCase() === key)?.[1] || '';

const hasRows = (config, tab) => rowsOf(config, tab).length > 0;

// Substring match so env refs, .html suffixes and other app hosts still count.
const hasRowWithPath = (config, tab, needle) => rowsOf(config, tab)
  .some((row) => cell(row, 'path').toLowerCase().includes(needle));

const found = (source) => ({ state: 'ok', source });
const missing = { state: 'missing', source: null };

function usesDistributionLists(config) {
  const rows = [...rowsOf(config, WORKFLOW_TAB), ...rowsOf(config, 'publish-workflow-steps')];
  return rows.some((row) => `${cell(row, 'approvers')},${cell(row, 'cc')}`
    .split(',')
    .some((entry) => entry.trim() && !entry.includes('@')));
}

/**
 * Setup status of the DA config tabs the publish workflow relies on, or null
 * when neither config could be read. Workflow tabs resolve like the worker:
 * the site config wins when it has publish-workflow-config, else the org's.
 * DA never inherits library/apps from the org, so those are site-only.
 */
export function inspectDaConfig(siteConfig, orgConfig) {
  if (!siteConfig && !orgConfig) return null;

  let active = null;
  if (siteConfig?.[WORKFLOW_TAB]) active = { config: siteConfig, source: 'site' };
  else if (orgConfig?.[WORKFLOW_TAB]) active = { config: orgConfig, source: 'org' };

  const inActive = (tab) => (active && hasRows(active.config, tab) ? found(active.source) : null);

  let groups = inActive('publish-workflow-groups-to-email') || missing;
  if (!active || !usesDistributionLists(active.config)) groups = { state: 'not-needed', source: null };

  return {
    workflowConfig: inActive(WORKFLOW_TAB) || missing,
    library: hasRowWithPath(siteConfig, 'library', '/tools/plugins/request-for-publish') ? found('site') : missing,
    apps: hasRowWithPath(siteConfig, 'apps', '/tools/apps/publish-requests-inbox') ? found('site') : missing,
    settings: inActive('publish-workflow-settings') || { state: 'default', source: null },
    groups,
  };
}

// ponytail: only publish-workflow-config blocks; library/apps gaps don't break a working inbox.
export const isSetupBlocked = (status) => status?.workflowConfig.state === 'missing';
