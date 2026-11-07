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
  REASON_LABELS,
} from '../../apps/msm-next/data/display.js';
import { targetPages } from '../../localization/core/domain/resolve.js';
import { parseLanguage } from '../../localization/core/domain/language.js';

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

export const localeBadge = (language) => (language ? language.toUpperCase() : null);

export function regionName(language, displayLocale = 'en') {
  const parsed = parseLanguage(language);
  if (!parsed?.region) return null;
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'region' }).of(parsed.region);
  } catch {
    return null;
  }
}

export function languageName(language, displayLocale = 'en') {
  const parsed = parseLanguage(language);
  if (!parsed) return language ?? null;
  const base = parsed.script ? `${parsed.language}-${parsed.script}` : parsed.language;
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(base);
  } catch {
    return language;
  }
}

export function formatDate(iso, { locale = 'en-US', timeZone } = {}) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone,
  }).format(time);
}

const relativePath = (path, location) => path
  .slice(location && location.path !== '/' ? location.path.length : 0);

export const refTitle = (ref) => pageTitle(relativePath(ref.path, ref.location));

export function statusPill(result) {
  const [urgent] = syncBadges(result);
  if (urgent) return { label: urgent.label, tone: urgent.tone, sync: urgent.sync };
  return { label: pageType(result).label, tone: 'neutral', sync: null };
}

export function header(result, { path, timeZone } = {}) {
  const location = result?.location ?? null;
  return {
    title: pageTitle(relativePath(path, location)),
    badge: localeBadge(location?.language),
    badgeTitle: location?.label ?? '',
    pill: statusPill(result),
    overridden: isOverridden(result),
    lastSynced: formatDate(result?.chain?.[0]?.info?.base?.at, { timeZone }),
  };
}

export function sourceInfo(result) {
  const ref = result?.status?.effectiveSource;
  if (!ref) return null;
  return {
    site: ref.site,
    path: ref.path,
    label: ref.location?.label ?? ref.path,
    title: refTitle(ref),
  };
}

const sameLabel = (first, second) => (first === second ? first : `${first} · ${second}`);

export function detailRows(result, { site, publishState } = {}) {
  const location = result?.location;
  if (!location) return [];
  const type = pageType(result);
  const source = sourceInfo(result);
  const depth = Math.max((result.chain?.length ?? 1) - 1, 0);
  const sourcePath = source && (source.site === site ? source.path : `${source.site}:${source.path}`);
  const noSource = type.relationship === 'root' ? 'None (this is the source)' : 'None';
  return [
    {
      id: 'type', label: 'Type', value: type.label, detail: type.detail ?? '',
    },
    {
      id: 'source',
      label: 'Source',
      value: source ? `${source.title} (${source.label})` : noSource,
      detail: sourcePath ?? '',
    },
    {
      id: 'language', label: 'Language', value: languageName(location.language), detail: location.language,
    },
    {
      id: 'locale', label: 'Locale', value: regionName(location.language) ?? '—', detail: '',
    },
    {
      id: 'location', label: 'Location', value: sameLabel(location.label, levelLabel(location, depth)), detail: '',
    },
    publishState !== undefined && {
      id: 'publish', label: 'Published', value: publishBadge(publishState).label, detail: '',
    },
  ].filter(Boolean);
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
      pill: result ? statusPill(result) : null,
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

const CONFIRMS = {
  reconnect: 'This deletes the local copy. The page will show its source content again.',
  unlink: 'This page will stop getting updates from its source.',
  overwrite: 'This replaces the page with the source content. Local changes are lost.',
};

const PUBLISHABLE = ['source', 'copies', 'inherited', 'independent'];
const UPDATES = ['rollout', 'translate'];

function fromEntry(entry, fields) {
  if (!entry) return null;
  return {
    kind: 'execute',
    action: entry.action,
    enabled: Boolean(entry.enabled),
    reason: entry.enabled ? '' : reasonText(entry.reasons),
    destructive: Boolean(entry.destructive),
    confirm: CONFIRMS[entry.action],
    ...fields,
  };
}

const plain = (fields) => ({
  enabled: true, reason: '', ...fields,
});

const findEntry = (result, name) => (result?.actions ?? []).find((entry) => entry.action === name);

export function defaultUpdate(result) {
  const entries = (result?.actions ?? []).filter((entry) => UPDATES.includes(entry.action));
  return entries.find((entry) => entry.default) ?? entries[0] ?? null;
}

function syncButton(entry) {
  if (!entry) return null;
  if (entry.action === 'translate') {
    return fromEntry(entry, { id: 'translate', label: 'Translate now', style: 'primary' });
  }
  return fromEntry(entry, {
    id: 'sync', label: 'Sync now', option: entry.options?.[0], style: 'primary',
  });
}

const card = (fields) => ({
  note: null,
  locksVariations: false,
  ...fields,
  buttons: (fields.buttons ?? []).filter(Boolean),
});

const TEXT = {
  review: 'Some content needs your attention before the update can be completed. Resolve the conflicts in the canvas to continue.',
  blocked: 'The source page has changes that need review first. Once they are resolved there, this page can be updated.',
  ready: 'The translation is back from the translation service. Save it to apply it to this page.',
  translating: 'The translation service is working on this page. Check the status to see if it is done.',
  deleted: 'The page this one was synced from no longer exists.',
  overridden: 'This page contains local changes that may be affected by synchronization.',
  unlinked: 'This page no longer gets updates from its source.',
};

function updateCard(result, source) {
  const entry = defaultUpdate(result);
  const verb = entry?.action === 'translate' ? 'Translate' : 'Sync';
  return card({
    id: 'update',
    tone: 'notice',
    title: 'Available updates',
    text: `An update from the source is available. ${verb} to apply the latest content to this page.`,
    note: isOverridden(result) ? TEXT.overridden : null,
    buttons: [
      syncButton(entry),
      source && plain({
        kind: 'compare', id: 'compare', label: 'Compare with source', style: 'link',
      }),
    ],
  });
}

function notCreatedCard(result) {
  const create = defaultUpdate(result);
  const link = findEntry(result, 'link');
  const where = result.location?.label ?? 'this location';
  const label = create?.action === 'translate' ? 'Translate' : 'Create';
  return card({
    id: 'not-created',
    tone: 'neutral',
    title: 'Not created yet',
    text: `This page doesn't exist in ${where} yet.`,
    buttons: [
      create && fromEntry(create, { id: 'create', label, style: 'primary' }),
      link?.enabled && fromEntry(link, { id: 'link', label: 'Inherit', style: 'link' }),
    ],
  });
}

function relationshipCard(result, source) {
  const type = pageType(result);
  if (type.relationship === 'inherited') {
    return card({
      id: 'inherited',
      tone: 'neutral',
      title: 'Inherited',
      text: `This page inherits content from ${source?.label ?? 'its source'}.`,
      buttons: [plain({
        kind: 'publish', id: 'publish', label: 'Publish', style: 'primary',
      })],
    });
  }
  if (type.relationship === 'not created') return notCreatedCard(result);
  if (type.relationship === 'unlinked') {
    const from = type.detail.replace(/^Unlinked from /, '');
    return card({
      id: 'unlinked',
      tone: 'neutral',
      title: from && from !== 'Unlinked' ? `Independent — unlinked from ${from}` : 'Independent — unlinked',
      text: TEXT.unlinked,
      buttons: [fromEntry(findEntry(result, 'relink'), { id: 'relink', label: 'Relink', style: 'primary' })],
    });
  }
  if (['missing', 'error'].includes(type.group)) {
    return card({
      id: 'unavailable', tone: 'neutral', title: type.label, text: type.detail ?? '',
    });
  }
  return null;
}

export function stateCard(result) {
  if (!result?.status) return null;
  const sync = result.status.sync ?? [];
  const source = sourceInfo(result);
  if (sync.includes('needs review')) {
    return card({
      id: 'review', tone: 'negative', title: 'Conflicts', text: TEXT.review, locksVariations: true,
    });
  }
  if (sync.includes('blocked by source review')) {
    return card({
      id: 'blocked',
      tone: 'notice',
      title: 'Waiting for source review',
      text: TEXT.blocked,
      buttons: [source && plain({
        kind: 'source', id: 'open-source', label: 'Open source page', style: 'link',
      })],
    });
  }
  if (sync.includes('ready to save')) {
    return card({
      id: 'ready',
      tone: 'informative',
      title: 'Translation ready',
      text: TEXT.ready,
      buttons: [fromEntry(findEntry(result, 'save'), { id: 'save', label: 'Save translation', style: 'primary' })],
    });
  }
  if (sync.includes('translating')) {
    return card({
      id: 'translating',
      tone: 'informative',
      title: 'Translation in progress',
      text: TEXT.translating,
      buttons: [plain({
        kind: 'check', id: 'check', action: 'check', label: 'Check status', style: 'secondary',
      })],
    });
  }
  if (sync.includes('source deleted')) {
    return card({
      id: 'source-deleted', tone: 'negative', title: 'Source page deleted', text: TEXT.deleted,
    });
  }
  if (sync.includes('behind source')) return updateCard(result, source);
  return relationshipCard(result, source);
}

const isReview = (result) => (result?.status?.sync ?? []).includes('needs review');

export function menuItems(result, {
  hasTargets = false, sourceUrl = null, appUrl = null, canResolve = false,
} = {}) {
  const exists = Boolean(result?.chain?.[0]?.info?.exists);
  const rollout = findEntry(result, 'rollout');
  const unlink = findEntry(result, 'unlink');
  const page = [
    exists && rollout?.options?.includes('overwrite') && fromEntry(rollout, {
      id: 'replace', label: 'Replace with source', option: 'overwrite', confirm: CONFIRMS.overwrite, destructive: true,
    }),
    rollout?.creates && fromEntry(rollout, { id: 'create-copy', label: 'Create local copy' }),
    unlink && fromEntry(unlink, { id: 'unlink', label: unlink.creates ? 'Unlink (creates a local copy)' : 'Unlink' }),
    fromEntry(findEntry(result, 'relink'), { id: 'relink', label: 'Relink' }),
    fromEntry(findEntry(result, 'reconnect'), { id: 'reconnect', label: 'Revert to inherited' }),
    canResolve && isReview(result) && plain({ kind: 'resolve', id: 'resolve', label: 'Mock: accept review changes' }),
  ];
  const publishable = PUBLISHABLE.includes(pageType(result).group);
  const publish = [
    publishable && plain({ kind: 'preview', id: 'preview', label: 'Preview' }),
    publishable && plain({ kind: 'publish', id: 'publish', label: 'Publish' }),
    hasTargets && isRealPage(result) && plain({ kind: 'cascade', id: 'cascade', label: 'Publish with inherited pages' }),
  ];
  const links = [
    sourceUrl && plain({
      kind: 'link', id: 'open-source', label: 'Open source in editor', href: sourceUrl,
    }),
    appUrl && plain({
      kind: 'link', id: 'open-app', label: 'Open MSM app', href: appUrl,
    }),
  ];
  return [['page', page], ['publish', publish], ['links', links]]
    .map(([group, items]) => items.filter(Boolean).map((item) => ({ ...item, group })))
    .flat();
}

export function pickerRows(tree, baseDepth = 0) {
  const rows = [];
  const walk = (nodes, depth, parentId) => nodes.forEach((node) => {
    const { id } = node.location;
    rows.push({
      id,
      key: node.key,
      parentId,
      depth,
      label: node.location.label,
      language: node.location.language,
      level: levelLabel(node.location, baseDepth + depth + 1),
    });
    walk(node.children ?? [], depth + 1, id);
  });
  walk(tree, 0, null);
  return rows;
}

export function togglePick(rows, selected, id, checked) {
  const next = new Set(selected);
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (checked) {
    let current = byId.get(id);
    while (current) {
      next.add(current.id);
      current = byId.get(current.parentId);
    }
    return next;
  }
  const remove = (target) => {
    next.delete(target);
    rows.filter((row) => row.parentId === target).forEach((row) => remove(row.id));
  };
  remove(id);
  return next;
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
  if (!parts.length) return 'No translations found.';
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
