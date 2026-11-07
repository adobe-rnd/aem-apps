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

export const URGENCY = [
  'needs review',
  'blocked by source review',
  'source deleted',
  'ready to save',
  'translating',
  'not published',
  'behind source',
  'current',
];

export const SYNC_DISPLAY = {
  'needs review': { label: 'Needs review', tone: 'negative' },
  'blocked by source review': { label: 'Blocked by source review', tone: 'notice' },
  'source deleted': { label: 'Source deleted', tone: 'negative' },
  'ready to save': { label: 'Ready to save', tone: 'informative' },
  translating: { label: 'Translating', tone: 'informative' },
  'not published': { label: 'Not published', tone: 'notice' },
  'behind source': { label: 'Update available', tone: 'notice' },
  current: { label: 'Up to date', tone: 'positive' },
};

export const NEEDS_ACTION_SYNC = ['needs review', 'source deleted', 'ready to save', 'not published', 'behind source'];

const TYPES = {
  root: { group: 'source', label: 'Source' },
  inherited: { group: 'inherited', label: 'Inherited' },
  'local copy': { group: 'copies', label: 'Local copy' },
  translation: { group: 'copies', label: 'Translation' },
  standalone: { group: 'independent', label: 'Independent', detail: 'Created here' },
  unlinked: { group: 'independent', label: 'Independent' },
  'not created': { group: 'missing', label: 'Not created' },
  unavailable: { group: 'missing', label: 'Not available', detail: 'Source page not created' },
  'config error': { group: 'error', label: 'Config error' },
  unknown: { group: 'error', label: 'Unknown', detail: 'Source config not readable' },
};

export const TYPE_GROUPS = ['source', 'copies', 'inherited', 'independent'];

export const ACTION_LABELS = {
  rollout: 'Update',
  translate: 'Translate',
  reconnect: 'Revert to inherited',
  link: 'Inherit',
  unlink: 'Unlink',
  relink: 'Relink',
  save: 'Save',
};

export const OPTION_LABELS = {
  merge: 'Merge',
  overwrite: 'Replace with source',
};

export const REASON_LABELS = {
  'needs-review': 'This page needs review first',
  'source-needs-review': 'The source page needs review first',
  'translation-in-progress': 'A translation is in progress',
  'no-source': 'There is no source page',
  'language-not-translatable': 'Source and target language are the same',
  'connector-unsupported': 'No translation service supports this language pair',
  'backend-unsupported': 'Not supported on this backend yet',
  'copy-engine-unavailable': 'The copy engine is not available',
};

export const reasonText = (reasons = []) => reasons
  .map((reason) => REASON_LABELS[reason] ?? reason)
  .join('. ');

export const refLabel = (ref, site) => {
  if (!ref) return '';
  return ref.site === site ? ref.path : `${ref.site}:${ref.path}`;
};

const unlinkedFromOf = (result) => {
  const from = result?.chain?.[0]?.info?.overrides?.unlinkedFrom;
  if (from) return from;
  const source = result?.status?.effectiveSource;
  return source ? `${source.site}:${source.path}` : '';
};

const stripSite = (value, site) => (value.startsWith(`${site}:`) ? value.slice(site.length + 1) : value);

export function pageType(result) {
  const status = result?.status;
  if (!status) return { group: 'none', label: 'No page', relationship: null };
  const type = TYPES[status.relationship] ?? { group: 'error', label: status.relationship };
  const display = { ...type, relationship: status.relationship };
  if (status.relationship === 'unlinked') {
    const from = unlinkedFromOf(result);
    const site = result?.location?.site ?? '';
    display.detail = from ? `Unlinked from ${stripSite(from, site)}` : 'Unlinked';
  }
  return display;
}

export const typeGroup = (result) => pageType(result).group;

export const primarySync = (result) => result?.status?.sync?.[0] ?? null;

export function syncBadges(result) {
  return (result?.status?.sync ?? [])
    .map((sync) => ({ sync, ...(SYNC_DISPLAY[sync] ?? { label: sync, tone: 'neutral' }) }));
}

const has = (result, sync) => (result?.status?.sync ?? []).includes(sync);

export function publishNotice(result) {
  if (!has(result, 'not published')) return '';
  const unpreviewed = (result.status.reasons ?? []).includes('not-previewed') ? ' It has not been previewed either.' : '';
  return `This inherited page is not published at its own path, so the live site does not serve it.${unpreviewed} Publish it to make it visible.`;
}

export const isOverridden = (result) => Boolean(result?.status?.overridden);

export const needsAction = (result) => (result?.status?.sync ?? [])
  .some((sync) => NEEDS_ACTION_SYNC.includes(sync));

export function urgencyRank(result) {
  const sync = primarySync(result);
  const rank = URGENCY.indexOf(sync);
  return rank === -1 ? URGENCY.length : rank;
}

export const isRealPage = (result) => !['missing', 'none', 'error'].includes(typeGroup(result));

export function editUrl(org, site, path) {
  const clean = path.replace(/\.html$/, '');
  return `https://da.live/edit#/${org}/${site}${clean}`;
}

export function pageTitle(rel) {
  const clean = rel.replace(/\.(html|json)$/, '');
  const segments = clean.split('/').filter(Boolean);
  if (segments[segments.length - 1] === 'index') segments.pop();
  if (!segments.length) return 'Home';
  const last = segments[segments.length - 1].replace(/[-_]+/g, ' ');
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export function levelLabel(location, depth) {
  return location?.level || `Level ${depth + 1}`;
}

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatRelative(iso, now = Date.now()) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 60) return 'just now';
  const [unit, size] = UNITS.find(([, length]) => seconds >= length);
  const count = Math.floor(seconds / size);
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

const enabledAction = (result, name) => (result?.actions ?? [])
  .find((entry) => entry.action === name && entry.enabled);

export function nextStep(result) {
  const status = result?.status;
  if (!status) return null;
  if (has(result, 'needs review')) return { kind: 'review', label: 'Review' };
  const save = enabledAction(result, 'save');
  if (save) return { kind: 'action', action: 'save', label: 'Save' };
  if (status.relationship === 'unlinked') {
    const relink = enabledAction(result, 'relink');
    return relink ? { kind: 'action', action: 'relink', label: 'Relink' } : null;
  }
  if (status.relationship === 'not created') {
    if (enabledAction(result, 'link')) return { kind: 'action', action: 'link', label: 'Inherit' };
    const create = (result.actions ?? []).find((entry) => entry.default && entry.enabled);
    if (!create) return null;
    const label = create.action === 'translate' ? 'Translate' : 'Create';
    return { kind: 'action', action: create.action, label };
  }
  if (has(result, 'behind source') || has(result, 'source deleted')) {
    const update = (result.actions ?? []).find((entry) => entry.default && entry.enabled);
    return update ? { kind: 'action', action: update.action, label: 'Update' } : null;
  }
  if (has(result, 'not published')) return { kind: 'publish', label: 'Publish' };
  return null;
}

export function actionButtons(result) {
  return (result?.actions ?? []).flatMap((entry) => {
    const base = {
      action: entry.action,
      enabled: entry.enabled,
      reason: reasonText(entry.reasons),
      destructive: Boolean(entry.destructive),
      primary: Boolean(entry.default),
    };
    if (entry.action === 'rollout' && entry.creates) {
      return [{ ...base, label: 'Create local copy' }];
    }
    if (entry.action === 'rollout' && entry.options?.length) {
      return entry.options.map((option, position) => ({
        ...base,
        option,
        primary: base.primary && position === 0,
        label: OPTION_LABELS[option] ?? option,
      }));
    }
    const confirm = entry.action === 'reconnect'
      ? 'This deletes the local copy. The page will show its source content again.'
      : undefined;
    return [{ ...base, label: ACTION_LABELS[entry.action] ?? entry.action, confirm }];
  });
}
