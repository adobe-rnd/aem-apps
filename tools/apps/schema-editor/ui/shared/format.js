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
const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });

/** Epoch ms as "2 hr. ago", "yesterday", "just now"…; empty without a timestamp. */
export function relativeTime(timestamp, now = Date.now()) {
  if (!timestamp) return '';
  const seconds = Math.round((timestamp - now) / 1000);
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? [];
  if (!unit) return 'just now';
  return relative.format(Math.round(seconds / size), unit);
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Where a change to a component used `count` times applies: "both uses", … */
export function usesPhrase(count) {
  if (count === 2) return 'both uses';
  return count > 2 ? `all ${count} uses` : 'every use';
}

/** How often a component is used: "in 1 case", "in 3 cases". */
export function usedIn(count) {
  return `in ${plural(count, 'case')}`;
}

export function usageLabel(count) {
  return count ? `Used ${usedIn(count)}` : 'Not used';
}

const isApple = () => /mac|iphone|ipad/i.test(navigator.userAgentData?.platform ?? navigator.userAgent);

export const modKey = () => (isApple() ? '⌘' : 'Ctrl+');
