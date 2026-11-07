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

export const OUTCOMES = {
  update: { label: 'Update', tone: 'notice' },
  create: { label: 'Create', tone: 'informative' },
  'up to date': { label: 'Up to date', tone: 'positive' },
  inherited: { label: 'Inherited', tone: 'neutral' },
  'in progress': { label: 'Translating', tone: 'informative' },
  waiting: { label: 'After translation', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'negative' },
  skip: { label: 'Skipped', tone: 'neutral' },
  unknown: { label: 'Checking', tone: 'neutral' },
};

export const OUTCOME_ORDER = Object.keys(OUTCOMES);

const SKIPPED = ['unlinked', 'standalone', 'root'];
const REFRESH = ['rollout', 'translate'];
const BLOCKS_CHILDREN = ['blocked', 'skip'];
const WAITS = ['in progress'];

export function predictOutcome(result) {
  if (!result) return { outcome: 'unknown' };
  const { status } = result;
  if (!status) return { outcome: 'skip', reasons: ['no-page'] };
  if (status.relationship === 'inherited') return { outcome: 'inherited' };
  if (SKIPPED.includes(status.relationship)) return { outcome: 'skip', reasons: [status.relationship] };
  if (status.sync.includes('translating') || status.sync.includes('ready to save')) {
    return { outcome: 'in progress', action: 'translate' };
  }
  const actions = result.actions ?? [];
  const refreshers = actions.filter((entry) => REFRESH.includes(entry.action));
  const chosen = refreshers.find((entry) => entry.default) ?? refreshers[0];
  if (!chosen) {
    const link = actions.find((entry) => entry.action === 'link' && entry.enabled);
    return link ? { outcome: 'create', action: 'link' } : { outcome: 'skip', reasons: ['no-action'] };
  }
  if (!chosen.enabled) return { outcome: 'blocked', action: chosen.action, reasons: chosen.reasons ?? [] };
  if (status.sync.includes('current')) return { outcome: 'up to date' };
  const outcome = status.relationship === 'not created' ? 'create' : 'update';
  return { outcome, action: chosen.action };
}

const isTranslate = (prediction) => prediction.action === 'translate'
  && ['create', 'update'].includes(prediction.outcome);

export function chainOutcome(own, parent) {
  if (!parent) return own;
  if (BLOCKS_CHILDREN.includes(parent.outcome)) return { outcome: 'blocked', reasons: [`parent:${parent.outcome}`] };
  if (WAITS.includes(parent.outcome) || parent.outcome === 'waiting' || isTranslate(parent)) {
    return { outcome: 'waiting', action: own.action };
  }
  return own;
}

export function planPreview(sources, targets, results) {
  const items = [];
  const seen = new Set();
  const walk = (node, parent) => node.children.forEach((child) => {
    if (targets && !targets.has(child.location.id)) return;
    if (seen.has(child.key)) return;
    seen.add(child.key);
    const prediction = chainOutcome(predictOutcome(results.get(child.key)), parent);
    const item = {
      key: child.key,
      node: child,
      locationId: child.location.id,
      parent: parent?.key ?? null,
      ...prediction,
    };
    items.push(item);
    walk(child, item);
  });
  sources.forEach((source) => {
    seen.add(source.key);
    walk(source, null);
  });
  return items;
}

export function countOutcomes(items) {
  const counts = { total: items.length, translate: 0 };
  OUTCOME_ORDER.forEach((outcome) => { counts[outcome] = 0; });
  items.forEach((item) => {
    counts[item.outcome] += 1;
    if (isTranslate(item)) counts.translate += 1;
  });
  return counts;
}

export function byLocation(items) {
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.locationId)) groups.set(item.locationId, []);
    groups.get(item.locationId).push(item);
  });
  return new Map([...groups].map(([id, list]) => [id, countOutcomes(list)]));
}

export function outcomeChips(counts) {
  return OUTCOME_ORDER
    .filter((outcome) => counts?.[outcome])
    .map((outcome) => ({ outcome, count: counts[outcome], ...OUTCOMES[outcome] }));
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function summaryText(counts) {
  const parts = [];
  if (counts.update) parts.push(`update ${plural(counts.update, 'page')}`);
  if (counts.create) parts.push(counts.update ? `create ${counts.create}` : `create ${plural(counts.create, 'page')}`);
  if (counts.translate) parts.push(`${counts.translate} by translation`);
  if (counts['up to date']) parts.push(`${counts['up to date']} already up to date`);
  if (counts.inherited) parts.push(`${counts.inherited} inherited (no change)`);
  if (counts['in progress']) parts.push(`${counts['in progress']} already translating`);
  if (counts.waiting) parts.push(`${counts.waiting} after translation`);
  if (counts.skip) parts.push(`${counts.skip} skipped`);
  if (counts.blocked) parts.push(`${counts.blocked} blocked`);
  if (counts.unknown) parts.push(`${counts.unknown} still checking`);
  if (!parts.length) return 'Nothing to do for these targets.';
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function primaryLabel(counts) {
  const work = counts.update + counts.create;
  if (!work) return 'Run';
  if (counts.update && counts.create) return `Update and create ${plural(work, 'page')}`;
  if (counts.update) return `Update ${plural(work, 'page')}`;
  return `Create ${plural(work, 'page')}`;
}
