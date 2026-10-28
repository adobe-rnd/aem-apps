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

export const SYNC_ORDER = [
  'needs review',
  'blocked by source review',
  'source deleted',
  'ready to save',
  'translating',
  'behind source',
  'current',
];

const JOB_SYNC = { translating: 'translating', ready: 'ready to save' };

const exists = (entry) => Boolean(entry?.facts?.exists);

function findEffectiveSource(chain) {
  for (let i = 1; i < chain.length; i += 1) {
    if (exists(chain[i])) return chain[i];
    if (chain[i].ref.location.missingPages !== 'linked') return null;
  }
  return null;
}

const result = (relationship, { sync = [], effectiveSource = null, reasons = [] } = {}) => ({
  relationship,
  sync: SYNC_ORDER.filter((value) => sync.includes(value)),
  effectiveSource: effectiveSource?.ref ?? null,
  reasons,
});

function existingStatus(self, effective) {
  const { base, needsReview } = self.facts;
  const sync = [];
  const reasons = [];
  let relationship;

  if (base) {
    relationship = base.via === 'translate' ? 'translation' : 'local copy';
    if (!effective) {
      sync.push('source deleted');
    } else if (base.sourceId !== effective.facts.id
      || base.sourceVersion !== effective.facts.version) {
      sync.push('behind source');
    } else {
      sync.push('current');
    }
  } else if (effective) {
    relationship = 'local copy';
    sync.push('behind source');
    reasons.push('base-unknown');
  } else {
    return result('standalone');
  }

  if (needsReview) sync.push('needs review');
  if (effective?.facts.needsReview) sync.push('blocked by source review');
  const job = JOB_SYNC[self.facts.job?.state];
  if (job) sync.push(job);

  return result(relationship, { sync, effectiveSource: effective, reasons });
}

function missingStatus(self, effective, chain) {
  const sync = [];
  const job = JOB_SYNC[self.facts?.job?.state];
  if (job) sync.push(job);

  if (self.ref.location.missingPages === 'linked') {
    if (effective) {
      if (effective.facts.needsReview) sync.push('blocked by source review');
      return result('linked', { sync, effectiveSource: effective });
    }
    return chain.slice(1).some(exists) ? result('unavailable', { sync }) : null;
  }

  return effective ? result('not created', { sync, effectiveSource: effective }) : null;
}

export function pageStatus(chain) {
  const [self] = chain || [];
  if (!self) return null;
  const { location } = self.ref;

  if (!location.valid) return result('config error', { reasons: ['invalid-location'] });
  if (!location.resolved) return result('unknown', { reasons: ['unresolved-location'] });

  if (!location.source) return exists(self) ? result('root') : null;

  const effective = findEffectiveSource(chain);
  return exists(self) ? existingStatus(self, effective) : missingStatus(self, effective, chain);
}
