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
// A workflow cell of only spaces is no workflow, as the worker trims cells.
export const readRules = (config) => rowsOf(config, RULES).map((row) => ({
  pattern: cell(row, 'pattern'),
  workflow: cell(row, 'workflow').trim(),
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
}) => {
  const name = (workflow || '').trim();
  return withoutEmpty({
    pattern: pattern.trim(),
    workflow: name,
    approvers: name ? '' : toList(approvers).join(', '),
    cc: name ? '' : toList(cc).join(', '),
    ...withoutKeys(row, RULE_KEYS),
  }, ['workflow', 'approvers', 'cc']);
});

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
  .flatMap((rule) => (rule.workflow?.trim() ? []
    : [...toList(rule.approvers), ...toList(rule.cc)]));

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

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The draft rules that use a workflow, matching its name in any case as the worker does. */
export const rulesUsingWorkflow = (rules, name) => (isBlank(name) ? []
  : rules.filter((rule) => sameName(rule.workflow, name)));

// `Used by /a/*, rule 2.`: a rule without a pattern is named by its place.
function usedBy(rules, workflow) {
  const using = rulesUsingWorkflow(rules, workflow.name);
  if (!using.length) return null;
  const labels = using.map((rule) => rule.pattern.trim() || `rule ${rules.indexOf(rule) + 1}`);
  return { text: `Used by ${labels.join(', ')}.`, whose: using.length === 1 ? "that rule's" : "those rules'" };
}

// Another workflow with the same name in any case, and steps: the worker reads the two as one.
const hasTwin = (workflows, workflow) => workflows.some((other) => other !== workflow
  && other.steps.length && !isBlank(other.name) && sameName(other.name, workflow.name));

/**
 * Why a workflow can't be removed (rules in the draft use it), else null. A duplicate name
 * (`workflows`, in any case) can go: its twin keeps the rules.
 */
export function workflowRemovalProblem(rules, workflow, workflows = []) {
  const used = !hasTwin(workflows, workflow) && usedBy(rules, workflow);
  return used ? `${used.text} Change ${used.whose} workflow first.` : null;
}

/** Why a step can't be removed (the last step of a workflow rules use), else null. */
export function stepRemovalProblem(rules, workflow, workflows = []) {
  const used = workflow.steps.length <= 1 && !hasTwin(workflows, workflow)
    && usedBy(rules, workflow);
  return used ? `${used.text} A workflow needs at least one step: add another first, or change ${used.whose} workflow.` : null;
}

/**
 * The rules a rename of `workflow` moves along: those using its name, unless another workflow
 * has the same name (in any case), as then they can't be told apart and stay where they are.
 */
export const rulesToRename = (rules, workflows, workflow) => (workflows.some((other) => (
  other !== workflow && !isBlank(other.name) && sameName(other.name, workflow.name)))
  ? [] : rulesUsingWorkflow(rules, workflow.name));

/**
 * Renames a workflow and moves the rules that used it (`linked`, taken when the rename started)
 * along. While the name is blank they keep the last one; the save checks flag it if left so.
 */
export function renameWorkflow(linked, workflow, name) {
  workflow.name = name;
  if (isBlank(name)) return;
  linked.forEach((rule) => { rule.workflow = name.trim(); });
}

const isStaffed = (step) => toList(step.approvers).length > 0
  || (step.ccCanApprove && toList(step.cc).length > 0);

// The worker's limits (parseRows, validateWorkflowTabs).
export const LIMITS = {
  rows: 500, columns: 20, cell: 4000, recipients: 100,
};

/**
 * Why a rule pattern is invalid, as the worker checks it (trimmed), else null: `/*`, `*`, an
 * exact `/path` or `/path/*`; `*` only last; no spaces, `?`, `#` or `\`; no `.` or `..` folders.
 */
export function patternProblem(value) {
  const pattern = String(value || '').trim();
  if (!pattern) return 'Add a pattern, such as /products/*.';
  if (pattern === '/*' || pattern === '*') return null;
  if (!pattern.startsWith('/')) return 'Start the pattern with /, or use /* for every page.';
  if (/[\s?#\\]/.test(pattern)) return "A pattern can't contain spaces, ?, # or \\.";
  const body = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
  if (body.includes('*')) return '* can only end a pattern, as in /products/*.';
  if (body.split('/').slice(1).some((s) => s === '.' || s === '..')) return "A pattern can't contain . or .. folders.";
  return null;
}

const isBlankStep = (step) => ['title', 'description', 'approvers', 'cc'].every((key) => isBlank(step[key]));
const isBlankRule = (rule) => ['pattern', 'workflow', 'approvers', 'cc'].every((key) => isBlank(rule[key]));

// An entry that is several addresses separated by something other than a comma.
const looksLikeSeveral = (entry) => entry.includes(';')
  || entry.split(/\s+/).filter((part) => part.includes('@')).length > 1;

const TOO_LONG = `At most ${LIMITS.cell} characters.`;

/**
 * Checks the rows a tab would save against the worker's per-row limits (columns, cell length).
 * `fieldOf(i, column)` is the editor field for a cell; columns the editor doesn't show map to the
 * row's first field.
 */
function checkRows(rows, fieldOf, add) {
  rows.forEach((row, i) => {
    const entries = Object.entries(row);
    if (entries.length > LIMITS.columns) {
      add(fieldOf(i), `This row has more than ${LIMITS.columns} columns. Remove some in the site's config.`);
    }
    entries.filter(([, value]) => String(value ?? '').trim().length > LIMITS.cell).forEach(([column]) => {
      const field = fieldOf(i, column);
      add(field || fieldOf(i), field ? TOO_LONG
        : `The ${column} column is longer than ${LIMITS.cell} characters. Shorten it in the site's config.`);
    });
  });
}

/**
 * Inline errors for the rules draft, by editor field id (`approvers-0`, `step-cc-1-0`,
 * `group-email-2`, …), checked as the worker would before a save: patterns, approvers, recipients,
 * workflows, lists and the row and cell limits. Besides the worker's checks, rows added but left
 * empty and workflow names that only differ in case are refused (the worker drops the first and
 * merges the second). Panel-wide problems use `rules-limit`, `workflows-limit`, `lists-limit` and
 * `workflows-v1`. Single Step refuses workflow rules and workflows, unless they are dropped.
 */
export function rulesDraftErrors({
  rules = [], workflows = [], groups = [], dropSteps = false,
}, { v2 = false } = {}) {
  const errors = {};
  const add = (id, text) => { if (!errors[id]) errors[id] = text; };
  const defined = new Set(groups.map((g) => g.group.trim().toLowerCase()).filter(Boolean));
  const checkRecipients = (id, value) => {
    const entries = toList(value);
    if (entries.length > LIMITS.recipients) {
      add(id, `At most ${LIMITS.recipients} entries.`);
      return;
    }
    const bad = entries.filter((e) => !defined.has(e.toLowerCase()) && !isEmailAddress(e));
    if (!bad.length) return;
    const hint = bad.some(looksLikeSeveral) ? '. Separate entries with commas.' : '';
    add(id, `Not an email address or a defined list: ${bad.join(', ')}${hint}`);
  };
  // A workflow without steps saves no rows, so the worker doesn't know it either.
  const isWorkflow = (name) => workflows.some((w) => w.steps.length && sameName(w.name, name));

  if (rules.length > LIMITS.rows) add('rules-limit', `At most ${LIMITS.rows} rules. Remove some, or use broader patterns.`);
  const patterns = new Set();
  rules.forEach((rule, i) => {
    if (isBlankRule(rule)) {
      add(`pattern-${i}`, 'Fill in this rule, or remove it.');
      return;
    }
    const pattern = rule.pattern.trim();
    const problem = patternProblem(pattern);
    if (problem) add(`pattern-${i}`, problem);
    // The worker compares patterns as written: an earlier rule with the same one always wins.
    else if (patterns.has(pattern)) add(`pattern-${i}`, 'A rule above already uses this pattern.');
    patterns.add(pattern);
    const workflow = rule.workflow?.trim();
    if (workflow) {
      if (!v2) add(`workflow-${i}`, "Single Step can't use workflows: use approvers instead.");
      else if (!isWorkflow(workflow)) add(`workflow-${i}`, `There's no workflow ${workflow}. Pick one, or None.`);
      return;
    }
    if (!toList(rule.approvers).length) add(`approvers-${i}`, 'Add at least one approver.');
    else checkRecipients(`approvers-${i}`, rule.approvers);
    checkRecipients(`cc-${i}`, rule.cc);
  });
  checkRows(rulesToRows(rules), (i, column) => ({
    pattern: `pattern-${i}`, workflow: `workflow-${i}`, approvers: `approvers-${i}`, cc: `cc-${i}`,
  }[column || 'pattern']), add);

  if (!v2 && workflows.length && !dropSteps) add('workflows-v1', 'Remove the workflows to save in Single Step.');
  if (v2) {
    const steps = workflows.reduce((n, w) => n + w.steps.length, 0);
    if (steps > LIMITS.rows) add('workflows-limit', `At most ${LIMITS.rows} steps across all workflows.`);
    const names = new Set();
    workflows.forEach((workflow, w) => {
      const nameId = `workflow-name-${w}`;
      const name = workflow.name.trim().toLowerCase();
      if (!name && workflow.steps.every(isBlankStep)) {
        add(nameId, 'Fill in this workflow, or remove it.');
        return;
      }
      if (!name) add(nameId, 'Name this workflow.');
      // The worker matches names in any case: two such workflows would be one.
      else if (names.has(name)) add(nameId, 'A workflow above has this name. Names ignore case.');
      names.add(name);
      if (!workflow.steps.length) add(nameId, 'Add a step, or remove this workflow.');
      workflow.steps.forEach((step, s) => {
        if (isBlankStep(step)) {
          add(`title-${w}-${s}`, 'Fill in this step, or remove it.');
          return;
        }
        checkRecipients(`step-approvers-${w}-${s}`, step.approvers);
        checkRecipients(`step-cc-${w}-${s}`, step.cc);
      });
      // The worker refuses a used workflow none of whose steps can approve (`unstaffed-workflow`).
      const id = `step-approvers-${w}-0`;
      if (workflow.steps.length && !workflow.steps.some(isStaffed) && !errors[id]
        && !errors[`title-${w}-0`] && rulesUsingWorkflow(rules, workflow.name).length) {
        add(id, 'Rules use this workflow: add approvers to at least one step.');
      }
    });
    const stepIds = workflows.flatMap((workflow, w) => workflow.steps.map((_, s) => [w, s]));
    checkRows(workflowsToRows(workflows), (i, column) => {
      const [w, s] = stepIds[i];
      return {
        workflow: `workflow-name-${w}`,
        title: `title-${w}-${s}`,
        description: `description-${w}-${s}`,
        approvers: `step-approvers-${w}-${s}`,
        cc: `step-cc-${w}-${s}`,
      }[column || 'title'];
    }, add);
  }

  if (groups.length > LIMITS.rows) add('lists-limit', `At most ${LIMITS.rows} lists.`);
  const seen = new Set();
  groups.forEach(({ group, email }, i) => {
    if (isBlank(group) && isBlank(email)) {
      add(`group-${i}`, 'Fill in this list, or remove it.');
      return;
    }
    const name = group.trim().toLowerCase();
    if (!name) add(`group-${i}`, 'Name this list.');
    else if (name.includes(',')) add(`group-${i}`, "A list name can't contain a comma.");
    else if (seen.has(name)) add(`group-${i}`, 'This list is already defined above.');
    seen.add(name);
    const emails = toList(email);
    const bad = emails.filter((e) => !isEmailAddress(e));
    if (!emails.length) add(`group-email-${i}`, 'Add at least one email address.');
    else if (emails.length > LIMITS.recipients) add(`group-email-${i}`, `At most ${LIMITS.recipients} addresses.`);
    else if (bad.length) {
      const hint = bad.some(looksLikeSeveral) ? '. Separate addresses with commas.' : '';
      add(`group-email-${i}`, `Not an email address: ${bad.join(', ')}${hint}`);
    }
  });
  checkRows(groupsToRows(groups), (i, column) => ({
    group: `group-${i}`, email: `group-email-${i}`,
  }[column || 'group']), add);
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

const isBooleanText = (value) => ['true', 'false'].includes(value.toLowerCase());
const isColor = (value) => /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{3,20})$/i.test(value)
  || /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(value);
const notBoolean = (value) => `Set to '${value}', not true or false: tick or untick it.`;
const atMost = (n) => (value) => (value.length > n ? `At most ${n} characters.` : null);
const notColor = (value) => (isColor(value) ? null : 'Not a CSS color. Use one like #3b63fb.');

// The Settings fields, by editor field id, with the worker's check of a non-empty value.
const SETTING_CHECKS = {
  commentsRequired: ['comments-required', (v) => (isBooleanText(v) ? null : notBoolean(v))],
  commentsLength: ['comments-length', (v) => (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 10000
    ? null : 'Enter a whole number from 1 to 10000.')],
  ccCanApprove: ['cc-can-approve', (v) => (isBooleanText(v) ? null : notBoolean(v))],
  supportContact: ['support-contact', atMost(254)],
  guidanceTitle: ['guidance-title', atMost(200)],
  guidanceText: ['guidance-text', atMost(2000)],
  accentColor: ['accent-color', notColor],
  accentColorHover: ['accent-color-hover', notColor],
};

/**
 * Inline errors for the Settings draft, by editor field id, as the worker checks the
 * `publish-workflow-settings` values it knows. Kept keys the editor doesn't show aren't checked.
 */
export function settingsDraftErrors({ settings = [], values = {}, items = '' }) {
  const errors = {};
  Object.entries(SETTING_CHECKS).forEach(([field, [id, check]]) => {
    const value = String(values[field] ?? '').trim();
    const problem = value && check(value);
    if (problem) errors[id] = problem;
  });
  const lines = items.split('\n').map((line) => line.trim());
  const long = lines.findIndex((line) => line.length > 500);
  if (long >= 0) errors['guidance-items'] = `Line ${long + 1} is longer than 500 characters.`;
  else if (settingsToRows(settings, values, lines).length > LIMITS.rows) {
    errors['guidance-items'] = `At most ${LIMITS.rows} settings in all: remove some items.`;
  }
  return errors;
}

const COMMON_SETTINGS = ['commentsRequired', 'commentsLength', 'supportContact', 'accentColor', 'accentColorHover'];

/**
 * The Settings fields a version reads (its plugin and inbox, and the worker). Both read the
 * comment, support contact and color keys; only Multi Step shows guidance.
 * `approvals.cc.can-approve` applies to every Single Step rule, but in Multi Step only to rules
 * without a workflow, so there it shows when such a rule exists or a value is set (so it can be
 * cleared or fixed).
 */
export function settingsFields(version, config, values = {}) {
  if (version !== 'v2') return [...COMMON_SETTINGS, 'ccCanApprove'];
  const inlineRules = readRules(config).some((rule) => !rule.workflow.trim());
  const cc = inlineRules || String(values.ccCanApprove || '').trim() ? ['ccCanApprove'] : [];
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

// The worker lists the refused domains in `domains`; its own message talks about the API.
export function blockedDomainsText(domains) {
  const where = domains.length > 1 ? "those domains aren't" : "that domain isn't";
  return `Emails to ${domains.join(', ')} are blocked: ${where} in Registration › Allowed email domains. The author's address is checked when sending.`;
}

const isOrgField = (field) => /^orgTabs\./.test(field || '');

/**
 * Worker validation errors carry a field like `tabs.publish-workflow-config[1].approvers`, or
 * `orgTabs.…` for the org rules a site inherits (a save that would make the site use them).
 */
export function describeProblem({
  field, error, message, code, domains,
}) {
  if (code === 'recipient-domain-not-allowed' && Array.isArray(domains) && domains.length) {
    return blockedDomainsText(domains);
  }
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
