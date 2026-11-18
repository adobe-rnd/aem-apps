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

const NEEDLES = {
  v1: { library: '/tools/plugins/request-for-publish/', apps: '/tools/apps/publish-requests-inbox/' },
  v2: { library: '/tools/plugins/request-for-publish-v2/', apps: '/tools/apps/publish-requests-inbox-v2/' },
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
// Keys that belong to one guidance item, such as `request.guidance.item.2.marker`.
const GUIDANCE_ITEM_PART = /^request\.guidance\.item\.(\d+)\.(.+)$/;

export const rowsOf = (config, tab) => config?.[tab]?.data || [];

export const cell = (row, key) => String(Object.entries(row || {})
  .find(([header]) => header.toLowerCase() === key)?.[1] ?? '');

export const toList = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

// Reading only: the app never writes DA config, the worker does (`install: true`).
export function normalizeConfig(json) {
  if (!json) return null;
  if (json[':type'] !== 'sheet') return json;
  const name = json[':sheetname'] || 'data';
  const { ':type': _type, ':sheetname': _name, ...sheet } = json;
  return { ':names': [name], ':type': 'multi-sheet', [name]: sheet };
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

// The version to offer when none is installed: Multi Step only when the rules need it.
export function suggestVersion(config) {
  const usesWorkflow = rowsOf(config, RULES).some((row) => cell(row, 'workflow').trim());
  return usesWorkflow || rowsOf(config, STEPS).length ? 'v2' : 'v1';
}

// The config whose rules apply, as the worker decides: the site's if it has rules, else the org's.
export const activeConfigOf = (siteConfig, orgConfig) => (
  siteConfig?.[RULES] ? siteConfig : orgConfig);

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

// Drops the source row's copies of the columns the editor owns, in any header case.
const withoutKeys = (row, keys) => Object.fromEntries(Object.entries(row || {})
  .filter(([header]) => !keys.includes(header.toLowerCase())));

// Empty optional cells are left out, as DA would store them as missing anyway.
const withoutEmpty = (row, keys) => Object.fromEntries(Object.entries(row)
  .filter(([header, value]) => !keys.includes(header) || value !== ''));

const RULE_KEYS = ['pattern', 'workflow', 'approvers', 'cc'];

export const rulesToRows = (rules) => rules.map(({
  pattern, workflow, approvers, cc, row,
}) => withoutEmpty({
  pattern: pattern.trim(),
  workflow: (workflow || '').trim(),
  approvers: workflow ? '' : toList(approvers).join(', '),
  cc: workflow ? '' : toList(cc).join(', '),
  ...withoutKeys(row, RULE_KEYS),
}, ['workflow', 'approvers', 'cc']));

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

const STEP_KEYS = ['workflow', 'title', 'description', 'approvers', 'cc', 'cc can approve'];

export const workflowsToRows = (workflows) => workflows.flatMap((workflow) => workflow.steps
  .map((step) => withoutEmpty({
    workflow: workflow.name.trim(),
    title: step.title.trim(),
    description: step.description.trim(),
    approvers: toList(step.approvers).join(', '),
    cc: toList(step.cc).join(', '),
    'cc can approve': step.ccCanApprove ? 'true' : '',
    ...withoutKeys(step.row, STEP_KEYS),
  }, ['description', 'cc', 'cc can approve'])));

export const readGroups = (config) => rowsOf(config, GROUPS)
  .map((row) => ({ group: cell(row, 'group'), email: cell(row, 'email'), row }));

export const groupsToRows = (groups) => groups.map(({ group, email, row }) => ({
  group: group.trim(), email: toList(email).join(', '), ...withoutKeys(row, ['group', 'email']),
}));

const ruleEntries = (rules) => rules
  .flatMap((rule) => (rule.workflow ? [] : [...toList(rule.approvers), ...toList(rule.cc)]));

const stepEntries = (workflows) => workflows
  .flatMap((w) => w.steps.flatMap((s) => [...toList(s.approvers), ...toList(s.cc)]));

const unique = (list) => [...new Set(list)];

// An entry is a list when it names a defined list (names may contain @), else when it has no @.
const isListEntry = (groups) => {
  const defined = new Set((groups || []).map((g) => g.group.trim().toLowerCase()).filter(Boolean));
  return (entry) => defined.has(entry.toLowerCase()) || !entry.includes('@');
};

export const usedGroupNames = (rules, workflows, groups = []) => unique(
  [...ruleEntries(rules), ...stepEntries(workflows)].filter(isListEntry(groups)),
);

export function missingGroups(rules, workflows, groups) {
  const defined = new Set(groups.map((g) => g.group.trim().toLowerCase()));
  return usedGroupNames(rules, workflows, groups)
    .filter((name) => !defined.has(name.toLowerCase()));
}

export function emailAddresses(rules, workflows, groups) {
  const isList = isListEntry(groups);
  return unique([
    ...ruleEntries(rules),
    ...stepEntries(workflows),
    ...groups.flatMap((g) => toList(g.email)),
  ].filter((entry) => entry.includes('@') && !isList(entry)));
}

// The worker's check: one address, no spaces, a dot in the domain.
export const isEmailAddress = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));

const isBlank = (value) => !String(value || '').trim();

/**
 * Inline errors for the rules draft, by editor field id (`approvers-0`, `step-cc-1-0`,
 * `group-email-2`, …), checked as the worker would before a save. Approver and CC entries are
 * email addresses or lists defined below (names may contain @). Single Step leaves workflow rules
 * and workflows to their own errors.
 */
export function rulesDraftErrors({ rules = [], workflows = [], groups = [] }, { v2 = false } = {}) {
  const errors = {};
  const defined = new Set(groups.map((g) => g.group.trim().toLowerCase()).filter(Boolean));
  const checkRecipients = (id, value) => {
    const bad = toList(value).filter((e) => !defined.has(e.toLowerCase()) && !isEmailAddress(e));
    if (bad.length) errors[id] = `Not an email address or a defined list: ${bad.join(', ')}`;
  };
  rules.forEach((rule, i) => {
    if (rule.workflow?.trim()) return;
    if (!toList(rule.approvers).length) errors[`approvers-${i}`] = 'Add at least one approver.';
    else checkRecipients(`approvers-${i}`, rule.approvers);
    checkRecipients(`cc-${i}`, rule.cc);
  });
  if (v2) {
    workflows.forEach((workflow, w) => {
      if (isBlank(workflow.name)) errors[`workflow-name-${w}`] = 'Name this workflow.';
      workflow.steps.forEach((step, s) => {
        checkRecipients(`step-approvers-${w}-${s}`, step.approvers);
        checkRecipients(`step-cc-${w}-${s}`, step.cc);
      });
    });
  }
  const seen = new Set();
  groups.forEach(({ group, email }, i) => {
    if (isBlank(group) && isBlank(email)) return;
    const name = group.trim().toLowerCase();
    if (!name) errors[`group-${i}`] = 'Name this list.';
    else if (name.includes(',')) errors[`group-${i}`] = "A list name can't contain a comma.";
    else if (seen.has(name)) errors[`group-${i}`] = 'This list is already defined above.';
    seen.add(name);
    const bad = toList(email).filter((e) => !isEmailAddress(e));
    if (!toList(email).length) errors[`group-email-${i}`] = 'Add at least one email address.';
    else if (bad.length) errors[`group-email-${i}`] = `Not an email address: ${bad.join(', ')}`;
  });
  return errors;
}

export const suggestDomains = (addresses) => unique(addresses.map((email) => email.split('@').pop().toLowerCase()));

export const readSettings = (config) => rowsOf(config, SETTINGS)
  .map((row) => ({ key: cell(row, 'key'), value: cell(row, 'value') }));

export const guidanceItems = (settings) => settings
  .filter(({ key }) => GUIDANCE_ITEM.test(key)).map(({ value }) => value);

// Maps each new guidance item to the number of the old item it continues: the same text first,
// then an edited item in the same place. Removed items map to nothing.
function guidanceNumbers(settings, items) {
  const old = settings.filter(({ key }) => GUIDANCE_ITEM.test(key))
    .map(({ key, value }) => ({ number: key.split('.').pop(), value, used: false }));
  const numbers = items.map((value) => {
    const match = old.find((item) => !item.used && item.value.trim() === value);
    if (!match) return null;
    match.used = true;
    return match.number;
  });
  return numbers.map((number, i) => {
    if (number || !old[i] || old[i].used) return number;
    old[i].used = true;
    return old[i].number;
  });
}

// Known keys are replaced by `values`; unknown keys are kept untouched, except an item's own keys
// (e.g. `request.guidance.item.2.marker`), which move with the item and go when it's removed.
export function settingsToRows(settings, values, items) {
  const known = new Set(Object.values(SETTING_KEYS));
  const list = items.map((value) => value.trim()).filter(Boolean);
  const numbers = guidanceNumbers(settings, list);
  const oldNumbers = new Set(settings.filter(({ key }) => GUIDANCE_ITEM.test(key))
    .map(({ key }) => key.split('.').pop()));
  const edited = Object.entries(SETTING_KEYS)
    .map(([field, key]) => ({ key, value: String(values[field] ?? '').trim() }));
  const guidance = list.map((value, i) => ({ key: `request.guidance.item.${i + 1}`, value }));
  const parts = numbers.flatMap((number, i) => (number ? settings
    .filter(({ key }) => GUIDANCE_ITEM_PART.exec(key)?.[1] === number)
    .map(({ key, value }) => ({
      key: `request.guidance.item.${i + 1}.${GUIDANCE_ITEM_PART.exec(key)[2]}`, value,
    })) : []));
  const taken = new Set(parts.map(({ key }) => key));
  const kept = settings.filter(({ key }) => {
    if (known.has(key) || GUIDANCE_ITEM.test(key)) return false;
    const part = GUIDANCE_ITEM_PART.exec(key);
    return !part || (!oldNumbers.has(part[1]) && !taken.has(key));
  });
  return [...edited, ...guidance, ...parts, ...kept].filter(({ value }) => value);
}

export const settingsValues = (settings) => Object.fromEntries(Object.entries(SETTING_KEYS)
  .map(([field, key]) => [field, settings.find((s) => s.key === key)?.value || '']));

const COMMON_SETTINGS = ['commentsRequired', 'commentsLength', 'supportContact', 'accentColor', 'accentColorHover'];

/**
 * The Settings fields a version reads (its plugin and inbox, and the worker). Both read the
 * comment, support contact and color keys; only Multi Step shows guidance.
 * `approvals.cc.can-approve` applies to every Single Step rule, but in Multi Step only to rules
 * without a workflow, so there it shows when such a rule exists or the value is set (so it can be
 * cleared).
 */
export function settingsFields(version, config, values = {}) {
  if (version !== 'v2') return [...COMMON_SETTINGS, 'ccCanApprove'];
  const inlineRules = readRules(config).some((rule) => !rule.workflow.trim());
  const cc = inlineRules || values.ccCanApprove === 'true' ? ['ccCanApprove'] : [];
  return [...COMMON_SETTINGS, ...cc, 'guidance'];
}

/** The minimum comment length each version's plugin uses when none is set. */
export const commentsLengthDefault = (version) => (version === 'v2' ? 1 : 10);

const TAB_LABELS = {
  [RULES]: 'Rules', [STEPS]: 'Workflows', [GROUPS]: 'Distribution lists', [SETTINGS]: 'Settings',
};

export const tabLabel = (tab) => TAB_LABELS[tab] || tab;

// Worker warnings whose own text talks about the worker: shown in the app's words instead.
const PROBLEM_MESSAGES = {
  'single-sheet-inactive': "This site's config is a single sheet, so its rules aren't used yet. The next save here rewrites it as named tabs, which makes them active.",
  'org-config-unreadable': "The org config couldn't be read, so rules this site inherits from the org aren't shown.",
};
// Added after the worker's own text, which names the row and workflow.
const PROBLEM_HINTS = {
  'unstaffed-workflow': 'Add approvers to at least one of its steps, or a CC who can approve.',
};

const isOrgField = (field) => /^orgTabs\./.test(field || '');

/**
 * Worker validation errors carry a field like `tabs.publish-workflow-config[1].approvers`, or
 * `orgTabs.…` for the org rules a site inherits (a save that would make the site use them).
 */
export function describeProblem({
  field, error, message, code,
}) {
  const tab = /^(?:org)?[tT]abs\.([a-z-]+)/.exec(field || '')?.[1];
  const base = PROBLEM_MESSAGES[code] || error || message || '';
  const hint = PROBLEM_HINTS[code];
  const text = hint ? `${base.replace(/\.?\s*$/, '.')} ${hint}` : base;
  const label = TAB_LABELS[tab];
  if (isOrgField(field)) return `Org rules this site inherits${label ? ` (${label})` : ''}: ${text}`;
  return label ? `${label}: ${text}` : text;
}

// ======== Editor drafts ========

export const blankRule = () => ({
  pattern: '', workflow: '', approvers: '', cc: '',
});

/** The editable draft of a section (`rules` or `settings`) from a config with workflow tabs. */
export function draftFromConfig(key, config) {
  if (key === 'rules') {
    const rules = readRules(config);
    const workflows = readWorkflows(config);
    const groups = readGroups(config);
    const missing = missingGroups(rules, workflows, groups).map((group) => ({ group, email: '' }));
    return {
      rules: rules.length ? rules : [{ ...blankRule(), pattern: '/*' }],
      workflows,
      groups: [...groups, ...missing],
    };
  }
  const settings = readSettings(config);
  return { settings, values: settingsValues(settings), items: guidanceItems(settings).join('\n') };
}

/**
 * The worker `tabs` a section's draft saves. Single Step leaves workflows alone unless the user
 * chose to remove them (`dropSteps`), since the Single Step route refuses them.
 */
export function draftToTabs(key, draft, { v2 = false } = {}) {
  if (key === 'rules') {
    const { rules, workflows, groups } = draft;
    const tabs = {
      [RULES]: rulesToRows(rules),
      [GROUPS]: groups.length ? groupsToRows(groups) : null,
    };
    if (v2) tabs[STEPS] = workflows.length ? workflowsToRows(workflows) : null;
    else if (draft.dropSteps) tabs[STEPS] = null;
    return tabs;
  }
  const { settings, values, items } = draft;
  const rows = settingsToRows(settings, values, items.split('\n'));
  return { [SETTINGS]: rows.length ? rows : null };
}

// ======== Merging after a 409 ========

// Rows are merged in units: one rule, list or setting per key; all the steps of a workflow.
const UNIT_KEYS = {
  [RULES]: (row) => cell(row, 'pattern').trim(),
  [GROUPS]: (row) => cell(row, 'group').trim().toLowerCase(),
  [SETTINGS]: (row) => cell(row, 'key').trim(),
  [STEPS]: (row) => cell(row, 'workflow').trim(),
};

const canonical = (rows) => JSON.stringify(rows.map((row) => Object.entries(row)
  .map(([header, value]) => [header.toLowerCase(), String(value ?? '').trim()])
  .filter(([, value]) => value)
  .sort(([a], [b]) => a.localeCompare(b))));

// `null` when keys are blank or repeated, so units can't be matched reliably.
function toUnits(tab, rows) {
  const keyOf = UNIT_KEYS[tab];
  const units = new Map();
  let previous = null;
  const matched = (rows || []).every((row) => {
    const key = keyOf(row);
    // A workflow's steps are consecutive rows; any other repeat is ambiguous.
    if (!key || (units.has(key) && (tab !== STEPS || previous !== key))) return false;
    if (!units.has(key)) units.set(key, []);
    units.get(key).push(row);
    previous = key;
    return true;
  });
  return matched ? units : null;
}

const changeOf = (key, base, side) => {
  if (!base.has(key)) return side.has(key) ? 'add' : null;
  if (!side.has(key)) return 'delete';
  return canonical(side.get(key)) === canonical(base.get(key)) ? null : 'change';
};

function mergeTab(tab, baseRows, mineRows, theirsRows) {
  const [base, mine, theirs] = [baseRows, mineRows, theirsRows].map((rows) => toUnits(tab, rows));
  if (!base || !mine || !theirs) return null;
  const keys = [...new Set([...base.keys(), ...mine.keys(), ...theirs.keys()])];
  const merged = new Map();
  const conflicts = [];
  keys.forEach((key) => {
    const mineChange = changeOf(key, base, mine);
    const theirChange = changeOf(key, base, theirs);
    const winner = mineChange ? mine : theirs;
    if (winner.has(key)) merged.set(key, winner.get(key));
    const same = mine.has(key) === theirs.has(key)
      && (!mine.has(key) || canonical(mine.get(key)) === canonical(theirs.get(key)));
    if (mineChange && theirChange && !same) {
      conflicts.push({ tab, key, theirs: theirs.get(key) || null });
    }
  });
  // My order first; units only they added go after the unit they follow on their side.
  const order = [...mine.keys()].filter((key) => merged.has(key));
  const theirOrder = [...theirs.keys()];
  theirOrder.forEach((key, i) => {
    if (!merged.has(key) || order.includes(key)) return;
    const after = theirOrder.slice(0, i).reverse().find((k) => order.includes(k));
    order.splice(after ? order.indexOf(after) + 1 : 0, 0, key);
  });
  return { rows: order.flatMap((key) => merged.get(key)), conflicts };
}

/**
 * Three-way merge of the tabs a save sends (`mine`) with the tabs someone saved meanwhile
 * (`theirs`), both against the tabs the draft started from (`base`). Only my changes are
 * re-applied; where both sides changed the same unit, mine is kept and listed in `conflicts`.
 * `{ ok: false, incoming }` (their changed tabs) when units can't be matched.
 */
export function mergeTabs(base, mine, theirs) {
  const tabs = {};
  const conflicts = [];
  const results = Object.keys(mine)
    .map((tab) => [tab, mergeTab(tab, base[tab], mine[tab], theirs[tab])]);
  if (results.some(([, result]) => !result)) {
    const incoming = Object.fromEntries(Object.keys(mine)
      .filter((tab) => canonical(theirs[tab] || []) !== canonical(base[tab] || []))
      .map((tab) => [tab, theirs[tab] || null]));
    return { ok: false, incoming };
  }
  results.forEach(([tab, { rows, conflicts: tabConflicts }]) => {
    tabs[tab] = rows.length ? rows : null;
    conflicts.push(...tabConflicts);
  });
  return { ok: true, tabs, conflicts };
}

// ======== Worker answers ========

/** A worker error's code when it's a definite answer (4xx), `unavailable` for an outage. */
export function problemCode({ status, data }) {
  if (!status || status >= 500) return 'unavailable';
  return data?.code || null;
}

const PERMISSIONS_MODES = ['restricted', 'open', 'unknown'];

/** A response's `permissionsMode` (`restricted`, `open` or `unknown`), else `fallback`. */
export const permissionsModeOf = (data, fallback = 'unknown') => (
  PERMISSIONS_MODES.includes(data?.permissionsMode) ? data.permissionsMode : fallback);

/**
 * Maps `GET /api[/v2]/setup` onto the app's registration and workflow state. An outage, including
 * an unreadable registration (`503`, v2 code `registration-unavailable`), is `unknown`, never
 * `unregistered`.
 */
export function readSetup({ ok, status, data }) {
  if (!ok) {
    const problem = problemCode({ status, data });
    return {
      registration: { status: 'unknown', code: problem, error: data?.error },
      workflow: null,
      canEdit: null,
      problem,
      permissionsMode: 'unknown',
    };
  }
  const {
    registration, availableProviders, providerWarnings, canEdit, workflowConfig,
  } = data;
  const permissionsMode = permissionsModeOf(data, permissionsModeOf(workflowConfig));
  const workflow = workflowConfig
    ? {
      ...workflowConfig,
      installed: workflowConfig.installed ?? data.installed,
      canEdit,
      permissionsMode,
    }
    : null;
  return {
    registration: {
      status: registration ? 'registered' : 'unregistered',
      config: {
        ...registration, availableProviders, providerWarnings, canEdit,
      },
    },
    workflow,
    canEdit: canEdit !== false,
    problem: workflow ? null : 'unavailable',
    permissionsMode,
  };
}

export const PERMISSIONS_DOCS = 'https://www.aem.live/docs/ew/administering/permissions';

/** The warning for an org whose DA config write is open to everyone, else null. */
export const permissionsNotice = (mode) => (mode === 'open'
  ? "Anyone can change this site's config, including these settings: the DA org has no permissions sheet."
  : null);

// ======== Site input ========

// The setup routes refuse uppercase org/site (400); DA and EDS names are lowercase anyway.
const siteOf = (org, site) => (org && site
  ? { org: org.trim().toLowerCase(), site: site.trim().toLowerCase() } : null);

/** `/org/site` as typed, lowercased; null when it isn't two parts. */
export function parseOrgSite(raw) {
  const parts = String(raw || '').trim().split('/').filter(Boolean);
  return parts.length === 2 ? siteOf(parts[0], parts[1]) : null;
}

/** `?org=&site=` deep-link values, lowercased; null unless both are set. */
export const siteFromParams = (params) => siteOf(params.get('org'), params.get('site'));

// ======== Registration form ========

export const CUSTOM_API_FIELDS = ['apiUrl', 'apiKey', 'fromAddress', 'fromName'];

/**
 * Starting values of the registration form. A caller without config write gets only the
 * apiUrl origin (`apiUrlRedacted: true`): it is shown as set, never prefilled as editable.
 */
export function registrationForm(config = {}) {
  const redacted = config.apiUrlRedacted === true;
  return {
    apiUrl: redacted ? '' : config.apiUrl || '',
    apiUrlSet: redacted,
    apiUrlHint: redacted
      ? `An API URL is set${config.apiUrl ? ` (${config.apiUrl}/…)` : ''}. Only config admins see it in full. Leave this empty to keep it.`
      : '',
  };
}

/** `POST /api/site-config` fields from the registration form; a redacted apiUrl is never sent. */
export function registrationBody(provider, form, domains, current = {}) {
  const fields = provider === 'custom-api'
    ? Object.fromEntries(CUSTOM_API_FIELDS.map((key) => [key, String(form[key] ?? '').trim()])
      .filter(([, value]) => value))
    : {};
  if (current.apiUrlRedacted && fields.apiUrl === current.apiUrl) delete fields.apiUrl;
  return {
    ...fields,
    emailProvider: provider,
    allowedEmailDomains: domains,
    ...(provider === 'default' ? { acknowledgeNonProduction: true } : {}),
  };
}

// ======== Save errors ========

const V1_LABEL = 'Request Publish - Single Step';
const V2_LABEL = 'Request Publish - Multi Step';

const SAVE_MESSAGES = {
  'payload-too-large': (section) => (section === 'registration'
    ? 'The registration is too large to save. Shorten the values and try again.'
    : 'These changes are too large to save at once. Remove some rows or shorten long values, then try again.'),
  'config-too-large': () => "Saving this would make the site's config larger than DA allows (2 MiB). Nothing was saved. Remove unused rows or tabs from the site config, then try again.",
  'install-sheet-incompatible': (section, error) => `Nothing was installed. ${error || 'The library or apps sheet has the same column twice, in different cases.'} Fix this in the site config, then install again.`,
  'org-config-unreadable': (section, error, status) => (status >= 500 || !status
    ? "This site uses, or would use, the org's rules, and the org's rules couldn't be read right now. Nothing was saved: try again in a moment."
    : "This site uses, or would use, the org's rules, and you need read access to the org config for that. Nothing was saved. Ask an org config admin."),
};

/**
 * What a refused `POST /api[/v2]/workflow-config` or `/api/site-config` means, in the app's words:
 * the validation errors (with the inherited org rules called out), a message for a known code, or
 * null to fall back to the worker's text.
 */
export function saveErrorText({ status, data }, section) {
  const { errors, error, code } = data || {};
  if (errors?.length) {
    const problems = errors.map(describeProblem);
    const fromOrg = errors.some((e) => isOrgField(e.field));
    if (section === 'install' && errors.some((e) => e.code === 'requires-v2')) {
      problems.unshift(fromOrg
        ? `${V1_LABEL} can't use the org's ${V2_LABEL} rules this site inherits. Nothing was saved. Keep ${V2_LABEL}, or give this site its own rules first:`
        : `${V1_LABEL} can't use this site's ${V2_LABEL} rules. Nothing was saved. Remove the workflows from the approval rules first, or keep ${V2_LABEL}:`);
    } else if (fromOrg) {
      problems.unshift("Without its own rules this site uses the org's rules, and they aren't valid for this version. Nothing was saved. Fix them in the org config, or keep the site's rules:");
    }
    return problems;
  }
  return SAVE_MESSAGES[code]?.(section, error, status) || null;
}
