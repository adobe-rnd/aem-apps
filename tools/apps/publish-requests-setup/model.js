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

export const RULES = 'publish-workflow-config';
export const STEPS = 'publish-workflow-steps';
export const SETTINGS = 'publish-workflow-settings';
export const GROUPS = 'publish-workflow-groups-to-email';

const HOST = 'https://main--aem-apps--adobe-rnd.aem.live';
const APP_BASE = '/app/adobe-rnd/aem-apps/tools/apps';

const NEEDLES = {
  v1: { library: '/tools/plugins/request-for-publish/', apps: '/tools/apps/publish-requests-inbox/' },
  v2: { library: '/tools/plugins/request-for-publish-v2/', apps: '/tools/apps/publish-requests-inbox-v2/' },
};

export const INSTALL = {
  v1: {
    library: {
      title: 'Request for Publish',
      path: `${HOST}/tools/plugins/request-for-publish/request-for-publish.html`,
      icon: `${HOST}/tools/plugins/request-for-publish/request-for-publish.svg`,
      experience: 'fullsize-dialog',
    },
    apps: {
      title: 'Publish Requests Inbox',
      description: 'Review and approve publish requests',
      path: `${APP_BASE}/publish-requests-inbox/publish-requests-inbox`,
    },
  },
  v2: {
    library: {
      title: 'Request for Publish',
      path: `${HOST}/tools/plugins/request-for-publish-v2/request-for-publish-v2.html`,
      icon: `${HOST}/tools/plugins/request-for-publish-v2/request-for-publish.svg`,
      experience: 'inline',
    },
    apps: {
      title: 'Publish Requests Inbox',
      description: 'Review and approve publish requests',
      path: `${APP_BASE}/publish-requests-inbox-v2/publish-requests-inbox-v2`,
    },
  },
};

export const SETTING_KEYS = {
  commentsRequired: 'request.comments.required',
  commentsLength: 'request.comments.length',
  supportContact: 'request.support.contact',
  guidanceTitle: 'request.guidance.title',
  guidanceText: 'request.guidance.text',
  accentColor: 'theme.accent-color',
  accentColorHover: 'theme.accent-color-hover',
  ccCanApprove: 'approvals.cc.can-approve',
};
const GUIDANCE_ITEM = /^request\.guidance\.item\.\d+$/;

export const rowsOf = (config, tab) => config?.[tab]?.data || [];

export const cell = (row, key) => String(Object.entries(row || {})
  .find(([header]) => header.toLowerCase() === key)?.[1] ?? '');

export const toList = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

export const emptyConfig = () => ({ ':names': [], ':type': 'multi-sheet', ':version': 3 });

export function normalizeConfig(json) {
  if (!json) return null;
  if (json[':type'] !== 'sheet') return json;
  const name = json[':sheetname'] || 'data';
  const { ':type': _type, ...sheet } = json;
  return { ...emptyConfig(), ':names': [name], [name]: sheet };
}

export function setTab(config, tab, rows) {
  const next = { ...(config || emptyConfig()) };
  const names = next[':names'] || [];
  if (rows.length) {
    next[tab] = {
      total: rows.length, limit: rows.length, offset: 0, data: rows,
    };
    next[':names'] = names.includes(tab) ? names : [...names, tab];
  } else {
    delete next[tab];
    next[':names'] = names.filter((name) => name !== tab);
  }
  return next;
}

const isInstalled = (config, tab, version) => rowsOf(config, tab)
  .some((row) => cell(row, 'path').toLowerCase().includes(NEEDLES[version][tab]));

export function detectVersion(config) {
  const has = (version) => ['library', 'apps'].some((tab) => isInstalled(config, tab, version));
  if (has('v1') && has('v2')) return 'mixed';
  if (has('v2')) return 'v2';
  if (has('v1')) return 'v1';
  return null;
}

export const installState = (config, version) => ({
  library: isInstalled(config, 'library', version),
  apps: isInstalled(config, 'apps', version),
});

const otherVersion = (version) => (version === 'v1' ? 'v2' : 'v1');

export function rowsToReplace(config, version) {
  const other = otherVersion(version);
  return ['library', 'apps'].flatMap((tab) => rowsOf(config, tab)
    .filter((row) => cell(row, 'path').toLowerCase().includes(NEEDLES[other][tab]))
    .map((row) => cell(row, 'path')));
}

// Existing rows for the chosen version stay as-is so ref-pinned or vendored copies survive.
export function applyInstall(config, version) {
  const other = otherVersion(version);
  return ['library', 'apps'].reduce((acc, tab) => {
    const rows = rowsOf(acc, tab)
      .filter((row) => !cell(row, 'path').toLowerCase().includes(NEEDLES[other][tab]));
    if (!isInstalled(acc, tab, version)) rows.push(INSTALL[version][tab]);
    return setTab(acc, tab, rows);
  }, config || emptyConfig());
}

// Worker workflow-config tabs ({ tab: rows }) in the config shape the readers below take.
export const tabsToConfig = (tabs) => tabs && Object.fromEntries(Object.entries(tabs)
  .map(([tab, rows]) => [tab, { data: rows }]));

// Each item keeps its source row so columns the editor doesn't show survive a save.
export const readRules = (config) => rowsOf(config, RULES).map((row) => ({
  pattern: cell(row, 'pattern'),
  workflow: cell(row, 'workflow'),
  approvers: cell(row, 'approvers'),
  cc: cell(row, 'cc'),
  row,
}));

export const rulesToRows = (rules) => rules.map(({
  pattern, workflow, approvers, cc, row,
}) => ({
  ...row,
  pattern: pattern.trim(),
  workflow: workflow || '',
  approvers: workflow ? '' : toList(approvers).join(', '),
  cc: workflow ? '' : toList(cc).join(', '),
}));

export function readWorkflows(config) {
  const byName = new Map();
  rowsOf(config, STEPS).forEach((row) => {
    const name = cell(row, 'workflow');
    if (!byName.has(name)) byName.set(name, { name, steps: [] });
    byName.get(name).steps.push({
      title: cell(row, 'title'),
      description: cell(row, 'description'),
      approvers: cell(row, 'approvers'),
      cc: cell(row, 'cc'),
      ccCanApprove: cell(row, 'cc can approve').toLowerCase() === 'true',
      row,
    });
  });
  return [...byName.values()];
}

export const workflowsToRows = (workflows) => workflows.flatMap((workflow) => workflow.steps
  .map((step) => ({
    ...step.row,
    workflow: workflow.name.trim(),
    title: step.title.trim(),
    description: step.description.trim(),
    approvers: toList(step.approvers).join(', '),
    cc: toList(step.cc).join(', '),
    'cc can approve': step.ccCanApprove ? 'true' : '',
  })));

export const readGroups = (config) => rowsOf(config, GROUPS)
  .map((row) => ({ group: cell(row, 'group'), email: cell(row, 'email'), row }));

export const groupsToRows = (groups) => groups
  .map(({ group, email, row }) => ({ ...row, group: group.trim(), email: toList(email).join(', ') }));

const ruleEntries = (rules) => rules
  .flatMap((rule) => (rule.workflow ? [] : [...toList(rule.approvers), ...toList(rule.cc)]));

const stepEntries = (workflows) => workflows
  .flatMap((w) => w.steps.flatMap((s) => [...toList(s.approvers), ...toList(s.cc)]));

const unique = (list) => [...new Set(list)];

export const usedGroupNames = (rules, workflows) => unique(
  [...ruleEntries(rules), ...stepEntries(workflows)].filter((entry) => !entry.includes('@')),
);

export function missingGroups(rules, workflows, groups) {
  const defined = new Set(groups.map((g) => g.group.trim().toLowerCase()));
  return usedGroupNames(rules, workflows).filter((name) => !defined.has(name.toLowerCase()));
}

export const emailAddresses = (rules, workflows, groups) => unique([
  ...ruleEntries(rules),
  ...stepEntries(workflows),
  ...groups.flatMap((g) => toList(g.email)),
].filter((entry) => entry.includes('@')));

export const suggestDomains = (addresses) => unique(addresses.map((email) => email.split('@').pop().toLowerCase()));

export const readSettings = (config) => rowsOf(config, SETTINGS)
  .map((row) => ({ key: cell(row, 'key'), value: cell(row, 'value') }));

export const guidanceItems = (settings) => settings
  .filter(({ key }) => GUIDANCE_ITEM.test(key)).map(({ value }) => value);

// Known keys are replaced by `values`; unknown keys (e.g. item markers) are kept untouched.
export function settingsToRows(settings, values, items) {
  const known = new Set(Object.values(SETTING_KEYS));
  const kept = settings.filter(({ key }) => !known.has(key) && !GUIDANCE_ITEM.test(key));
  const edited = Object.entries(SETTING_KEYS)
    .map(([field, key]) => ({ key, value: String(values[field] ?? '').trim() }));
  const guidance = items.map((value) => value.trim()).filter(Boolean)
    .map((value, i) => ({ key: `request.guidance.item.${i + 1}`, value }));
  return [...edited, ...guidance, ...kept].filter(({ value }) => value);
}

export const settingsValues = (settings) => Object.fromEntries(Object.entries(SETTING_KEYS)
  .map(([field, key]) => [field, settings.find((s) => s.key === key)?.value || '']));

const TAB_LABELS = {
  [RULES]: 'Rules', [STEPS]: 'Workflows', [GROUPS]: 'Distribution lists', [SETTINGS]: 'Settings',
};

// Worker validation errors carry a field like `tabs.publish-workflow-config[1].approvers`.
export function describeProblem({ field, error, message }) {
  const tab = /^tabs\.([a-z-]+)/.exec(field || '')?.[1];
  const text = error || message;
  return TAB_LABELS[tab] ? `${TAB_LABELS[tab]}: ${text}` : text;
}
