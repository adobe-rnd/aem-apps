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
import { REASON_LABELS } from './display.js';

export const ITEM_STATES = {
  pending: { label: 'Pending', tone: 'neutral', icon: '○' },
  running: { label: 'Running', tone: 'informative', icon: '◌' },
  done: { label: 'Done', tone: 'positive', icon: '✓' },
  'up to date': { label: 'Up to date', tone: 'positive', icon: '✓' },
  inherited: { label: 'Inherited', tone: 'neutral', icon: '↳' },
  'awaiting translation': { label: 'Awaiting translation', tone: 'informative', icon: '⧗' },
  translating: { label: 'Translating', tone: 'informative', icon: '⧗' },
  'ready to save': { label: 'Ready to save', tone: 'informative', icon: '⇩' },
  'needs review': { label: 'Needs review', tone: 'negative', icon: '!' },
  skipped: { label: 'Skipped', tone: 'neutral', icon: '–' },
  blocked: { label: 'Blocked', tone: 'notice', icon: '⊘' },
  failed: { label: 'Failed', tone: 'negative', icon: '✕' },
  waiting: { label: 'Waiting', tone: 'neutral', icon: '⧗' },
};

export const STATE_ORDER = Object.keys(ITEM_STATES);
export const BLOCKING_STATES = ['failed', 'blocked', 'needs review', 'skipped'];
export const TRANSLATION_STATES = ['translating', 'ready to save', 'awaiting translation'];
const OPEN_STATES = ['pending', 'running'];
const PROBLEM_STATES = ['failed', 'blocked', 'needs review'];

export const itemState = (state) => ITEM_STATES[state] ?? { label: state, tone: 'neutral', icon: '?' };

export function viewStates(run) {
  const items = run?.items ?? [];
  const byKey = new Map(items.map((item) => [item.key, item]));
  const states = new Map();
  const resolve = (item, seen = new Set()) => {
    if (states.has(item.key)) return states.get(item.key);
    let { state } = item;
    const parent = item.parent && byKey.get(item.parent);
    if (item.state === 'blocked' && parent && !seen.has(parent.key)) {
      seen.add(item.key);
      const parentState = resolve(parent, seen);
      if (TRANSLATION_STATES.includes(parentState) || parentState === 'waiting') state = 'waiting';
    }
    states.set(item.key, state);
    return state;
  };
  items.forEach((item) => resolve(item));
  return states;
}

export function runProgress(run) {
  const items = run?.items ?? [];
  const total = items.length;
  const states = viewStates(run);
  const count = (list) => items.filter((item) => list.includes(states.get(item.key))).length;
  const open = count(OPEN_STATES);
  const translating = count([...TRANSLATION_STATES, 'waiting']);
  const settled = total - open - translating;
  return {
    total,
    settled,
    open,
    translating,
    problems: count(PROBLEM_STATES),
    percent: total ? Math.round((settled / total) * 100) : 100,
  };
}

export function runStatus(run, busy = false) {
  const progress = runProgress(run);
  if (busy || progress.open) return { key: 'running', label: 'Running', tone: 'informative' };
  if (progress.problems) return { key: 'attention', label: 'Needs attention', tone: 'notice' };
  if (progress.translating) return { key: 'waiting', label: 'Waiting for translation', tone: 'informative' };
  return { key: 'done', label: 'Complete', tone: 'positive' };
}

export function canRetry(run) {
  const states = viewStates(run);
  return (run?.items ?? []).some((item) => PROBLEM_STATES.includes(states.get(item.key)));
}

export const translatingItems = (run) => (run?.items ?? [])
  .filter((item) => TRANSLATION_STATES.includes(item.state));

export function summaryChips(run) {
  const counts = new Map();
  const states = viewStates(run);
  (run?.items ?? []).forEach((item) => {
    const state = states.get(item.key);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  });
  return STATE_ORDER
    .filter((state) => counts.has(state))
    .map((state) => ({ state, count: counts.get(state), ...itemState(state) }))
    .concat([...counts.keys()].filter((state) => !ITEM_STATES[state])
      .map((state) => ({ state, count: counts.get(state), ...itemState(state) })));
}

export function groupRun(run, { levelOf = () => '', locationOf = () => null } = {}) {
  const depths = new Map();
  const states = viewStates(run);
  (run?.items ?? []).forEach((item) => {
    if (!depths.has(item.depth)) depths.set(item.depth, new Map());
    const locations = depths.get(item.depth);
    if (!locations.has(item.locationId)) {
      locations.set(item.locationId, {
        locationId: item.locationId, location: locationOf(item.locationId), items: [],
      });
    }
    locations.get(item.locationId).items.push({ ...item, viewState: states.get(item.key) });
  });
  return [...depths.keys()].sort((first, second) => first - second).map((depth) => {
    const locations = [...depths.get(depth).values()];
    const labels = [...new Set(locations
      .map((entry) => levelOf(entry.locationId, depth))
      .filter(Boolean))];
    return {
      depth,
      label: labels.length ? labels.join(' · ') : `Step ${depth}`,
      locations,
      progress: runProgress({
        items: locations.flatMap((entry) => entry.items)
          .map((item) => ({ ...item, state: item.viewState, parent: null })),
      }),
    };
  });
}

const PARENT_REASONS = {
  'parent:translating': 'Waits for its source page to be translated',
  'parent:failed': 'Its source page failed',
  'parent:blocked': 'Its source page is blocked',
  'parent:needs review': 'Its source page needs review',
  'parent:skipped': 'Its source page was skipped',
  'parent:awaiting translation': 'Waits for its source page to be translated',
};

const ITEM_REASONS = {
  'no-page': 'No page here',
  'no-action': 'No action configured for this location',
  unlinked: 'Unlinked from its source',
  standalone: 'Independent page',
  root: 'Source page',
};

const WARNING_LABELS = {
  'onComplete-failed': 'Saved, but the follow-up preview/publish failed',
};

export function itemNotes(item) {
  const notes = [];
  if (item.error) notes.push({ tone: 'negative', text: item.error });
  (item.reasons ?? []).forEach((reason) => notes.push({
    tone: 'neutral',
    text: PARENT_REASONS[reason] ?? ITEM_REASONS[reason] ?? REASON_LABELS[reason] ?? reason,
  }));
  (item.warnings ?? []).forEach((warning) => notes.push({ tone: 'notice', text: WARNING_LABELS[warning] ?? warning }));
  return notes;
}

export function runTitle(run) {
  if (run?.title) return run.title;
  const pages = run?.pages ?? [];
  if (!pages.length) return 'Run';
  const first = pages[0].path;
  return pages.length === 1 ? `Update ${first}` : `Update ${first} and ${pages.length - 1} more`;
}

export function mergeRuns(memory, listed) {
  const byId = new Map();
  listed.forEach((run) => byId.set(run.id, run));
  memory.forEach((run) => byId.set(run.id, run));
  return [...byId.values()].sort((first, second) => (Date.parse(second.createdAt ?? '') || 0)
    - (Date.parse(first.createdAt ?? '') || 0));
}
