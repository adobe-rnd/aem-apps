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
import {
  pageType, syncBadges, nextStep, reasonText, levelLabel, pageTitle, isOverridden, isRealPage,
  OPTION_LABELS, REASON_LABELS,
} from '../../apps/msm-next/data/display.js';
import { targetPages } from '../../localization/core/domain/resolve.js';

export const pageKey = ({ site, path }) => `${site}:${path}`;

export function pagePathFrom(path) {
  if (!path) return '/index.html';
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (clean.endsWith('/')) return `${clean}index.html`;
  const last = clean.split('/').pop();
  return last.includes('.') ? clean : `${clean}.html`;
}

const PUBLISH_LABELS = {
  live: { label: 'Live', tone: 'positive' },
  preview: { label: 'Previewed', tone: 'informative' },
};

export function publishBadge(state) {
  if (state === undefined) return null;
  return PUBLISH_LABELS[state] ?? { label: 'Not published', tone: 'neutral' };
}

export const isTranslating = (result) => (result?.status?.sync ?? []).includes('translating');

export function header(result, { site, path, publishState } = {}) {
  const location = result?.location ?? null;
  const depth = Math.max((result?.chain?.length ?? 1) - 1, 0);
  const [urgent] = syncBadges(result);
  return {
    title: pageTitle(path.slice(location && location.path !== '/' ? location.path.length : 0)),
    site,
    path,
    location: location ? location.label : null,
    level: location ? levelLabel(location, depth) : null,
    language: location?.language ?? null,
    type: pageType(result),
    sync: urgent ?? null,
    overridden: isOverridden(result),
    publish: publishBadge(publishState),
  };
}

export function sourceRows(result, results = new Map()) {
  return (result?.chain ?? []).slice(1).map(({ ref, info }, index) => {
    const key = pageKey(ref);
    const loaded = results.get(key);
    return {
      key,
      site: ref.site,
      path: ref.path,
      location: ref.location,
      level: levelLabel(ref.location, (result.chain.length - 2) - index),
      exists: Boolean(info?.exists),
      direct: index === 0,
      type: loaded ? pageType(loaded) : null,
      sync: loaded ? (syncBadges(loaded)[0] ?? null) : null,
      overridden: isOverridden(loaded),
    };
  });
}

export function targetTree(model, page, find = targetPages, seen = new Set([pageKey(page)])) {
  return find(model, page.site, page.path)
    .filter((target) => !seen.has(pageKey(target)))
    .map((target) => {
      seen.add(pageKey(target));
      return {
        key: pageKey(target),
        site: target.site,
        path: target.path,
        location: target.location,
        children: targetTree(model, target, find, seen),
      };
    });
}

export function flattenTargets(nodes, depth = 0) {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenTargets(node.children ?? [], depth + 1),
  ]);
}

export function targetRows(nodes, results = new Map()) {
  return flattenTargets(nodes).map((node) => {
    const result = results.get(node.key);
    return {
      ...node,
      loaded: Boolean(result),
      type: result ? pageType(result) : null,
      sync: result ? (syncBadges(result)[0] ?? null) : null,
      overridden: isOverridden(result),
      next: result ? nextStep(result) : null,
    };
  });
}

export function targetSummary(rows) {
  return {
    total: rows.length,
    direct: rows.filter((row) => row.depth === 0).length,
    needsAction: rows.filter((row) => row.next).length,
    loaded: rows.filter((row) => row.loaded).length,
  };
}

const GROUPS = [
  { id: 'update', title: 'Update from source', actions: ['rollout'] },
  { id: 'translation', title: 'Translation', actions: ['translate', 'save', 'check'] },
  { id: 'relationship', title: 'Relationship', actions: ['link', 'unlink', 'relink', 'reconnect'] },
  { id: 'publish', title: 'Publish', actions: ['preview', 'publish'] },
];

const LABELS = {
  translate: 'Translate',
  save: 'Save translation',
  link: 'Inherit',
  unlink: 'Unlink',
  relink: 'Relink',
  reconnect: 'Revert to inherited',
};

const CONFIRMS = {
  reconnect: 'This deletes the local copy. The page will show its source content again.',
  unlink: 'This page will stop getting updates from its source.',
};

const PUBLISHABLE = ['source', 'copies', 'inherited', 'independent'];

function executeButtons(entry, primary) {
  const base = {
    kind: 'execute',
    action: entry.action,
    enabled: Boolean(entry.enabled),
    reason: entry.enabled ? '' : reasonText(entry.reasons),
    destructive: Boolean(entry.destructive),
    primary: primary === entry.action,
    confirm: CONFIRMS[entry.action],
  };
  if (entry.action === 'rollout' && entry.creates) {
    return [{ ...base, id: 'rollout', label: 'Create local copy' }];
  }
  if (entry.action === 'rollout' && entry.options?.length) {
    return entry.options.map((option, position) => ({
      ...base,
      id: `rollout:${option}`,
      option,
      primary: base.primary && position === 0,
      label: OPTION_LABELS[option] ?? option,
    }));
  }
  const label = entry.action === 'unlink' && entry.creates ? 'Unlink (creates a local copy)' : LABELS[entry.action];
  return [{ ...base, id: entry.action, label: label ?? entry.action }];
}

export function pageActions(result, { canCheck = true } = {}) {
  if (!result?.status) return { review: false, groups: [] };
  const step = nextStep(result);
  const primary = step?.kind === 'action' ? step.action : null;
  const buttons = (result.actions ?? []).flatMap((entry) => executeButtons(entry, primary));
  if (canCheck && isTranslating(result)) {
    buttons.push({
      kind: 'check', id: 'check', action: 'check', label: 'Check status', enabled: true, reason: '',
    });
  }
  if (PUBLISHABLE.includes(pageType(result).group)) {
    buttons.push(
      {
        kind: 'preview', id: 'preview', action: 'preview', label: 'Preview', enabled: true, reason: '',
      },
      {
        kind: 'publish', id: 'publish', action: 'publish', label: 'Publish', enabled: true, reason: '',
      },
    );
  }
  const groups = GROUPS
    .map((group) => ({
      id: group.id,
      title: group.title,
      buttons: buttons.filter((button) => group.actions.includes(button.action)),
    }))
    .filter((group) => group.buttons.length);
  return { review: step?.kind === 'review', groups };
}

export function canPropagate(result, rows) {
  return isRealPage(result) && rows.length > 0;
}

export function rolloutOptions(rows, results = new Map()) {
  const options = new Set();
  rows.forEach((row) => {
    const entry = results.get(row.key)?.actions?.find((each) => each.action === 'rollout');
    (entry?.options ?? []).forEach((option) => options.add(option));
  });
  const list = [...options];
  return list.length ? list : ['merge', 'overwrite'];
}

export const RUN_STATES = {
  pending: { label: 'Waiting', tone: 'neutral' },
  running: { label: 'Running', tone: 'informative' },
  done: { label: 'Updated', tone: 'positive' },
  'up to date': { label: 'Up to date', tone: 'positive' },
  inherited: { label: 'Inherited', tone: 'neutral' },
  translating: { label: 'Translating', tone: 'informative' },
  'awaiting translation': { label: 'Awaiting translation', tone: 'informative' },
  'needs review': { label: 'Needs review', tone: 'negative' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'notice' },
  failed: { label: 'Failed', tone: 'negative' },
};

const ERROR_LABELS = {
  'action-unavailable': 'This action is not available for the page',
  'action-disabled': 'This action is disabled',
  'option-not-allowed': 'This option is not allowed here',
  'target-unreadable': 'The written page could not be read back',
  'remove-failed': 'The local copy could not be deleted',
  'connector-unavailable': 'No translation service is available',
};

const ISSUES = ['failed', 'blocked', 'needs review'];

const ITEM_REASONS = {
  unlinked: 'Unlinked',
  standalone: 'Created here',
  root: 'Source page',
  'no-page': 'No page',
  'no-action': 'No update action configured',
};

function itemReason(item) {
  const { error } = item;
  if (error) return ERROR_LABELS[error] ?? REASON_LABELS[error] ?? String(error);
  const reasons = (item.reasons ?? []).map((reason) => {
    if (reason.startsWith('parent:')) return `Source page: ${reason.slice(7)}`;
    return ITEM_REASONS[reason] ?? reasonText([reason]);
  });
  return reasons.join('. ');
}

export function runSummary(run) {
  if (!run) return null;
  const items = run.items ?? [];
  const counts = Object.entries(RUN_STATES)
    .map(([state, display]) => ({
      state, ...display, count: items.filter((item) => item.state === state).length,
    }))
    .filter((entry) => entry.count);
  const known = new Set(Object.keys(RUN_STATES));
  [...new Set(items.map((item) => item.state))]
    .filter((state) => !known.has(state))
    .forEach((state) => counts.push({
      state, label: state, tone: 'neutral', count: items.filter((item) => item.state === state).length,
    }));
  const finished = items.every((item) => !['pending', 'running'].includes(item.state));
  const issues = items
    .filter((item) => ISSUES.includes(item.state))
    .map((item) => ({
      key: item.key ?? pageKey(item),
      site: item.site,
      path: item.path,
      state: item.state,
      label: RUN_STATES[item.state].label,
      reason: itemReason(item),
    }));
  return {
    total: items.length, counts, finished, issues,
  };
}

export function translatingPages(page, result, rows = [], results = new Map()) {
  const pages = isTranslating(result) ? [{ site: page.site, path: page.path }] : [];
  rows.forEach((row) => {
    if (isTranslating(results.get(row.key))) pages.push({ site: row.site, path: row.path });
  });
  return pages;
}

export function describeFailure(result) {
  const reasons = reasonText(result?.reasons);
  const base = ERROR_LABELS[result?.error] ?? result?.error ?? 'Something went wrong';
  return reasons ? `${base}: ${reasons}` : base;
}

const JOB_STATES = [
  ['ready', 'ready to save'],
  ['translating', 'still translating'],
  ['failed', 'failed'],
  ['error', 'could not be checked'],
];

const progressText = (jobs) => {
  const progress = jobs.length === 1 ? jobs[0].progress : null;
  return progress?.total ? ` (${progress.done} of ${progress.total})` : '';
};

export function jobMessage(jobs = []) {
  const parts = JOB_STATES
    .map(([state, label]) => [jobs.filter((job) => job.state === state).length, label])
    .filter(([count]) => count)
    .map(([count, label]) => `${count} ${label}`);
  if (!parts.length) return 'No translation jobs found.';
  return `Translation status: ${parts.join(', ')}${progressText(jobs)}.`;
}

const DONE_MESSAGES = {
  translate: 'Translation started',
  save: 'Translation saved',
  rollout: 'Updated from source',
  link: 'Inherited',
  unlink: 'Unlinked',
  relink: 'Relinked',
  reconnect: 'Reverted to inherited',
};

export const doneMessage = (action, label) => DONE_MESSAGES[action] ?? `${label}: done`;

export const jobsWorthNoting = (jobs = []) => jobs
  .some((job) => ['ready', 'failed', 'error'].includes(job.state));
