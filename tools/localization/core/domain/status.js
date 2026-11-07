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
  'not published',
  'behind source',
  'current',
];

const JOB_SYNC = { translating: 'translating', ready: 'ready to save' };

const exists = (entry) => Boolean(entry?.info?.exists);

function findEffectiveSource(chain) {
  for (let position = 1; position < chain.length; position += 1) {
    const entry = chain[position];
    if (exists(entry)) return entry;
    if (entry.ref.location.missingPages !== 'linked' && !entry.info?.linked) return null;
  }
  return null;
}

const result = (relationship, {
  sync = [], effectiveSource = null, reasons = [], overridden = false,
} = {}) => ({
  relationship,
  sync: SYNC_ORDER.filter((value) => sync.includes(value)),
  effectiveSource: effectiveSource?.ref ?? null,
  reasons,
  overridden,
});

function flags(self, effective) {
  const sync = [];
  if (self.info?.needsReview) sync.push('needs review');
  if (effective?.info.needsReview) sync.push('blocked by source review');
  const job = JOB_SYNC[self.info?.job?.state];
  if (job) sync.push(job);
  return sync;
}

function existingStatus(self, effective) {
  const { base } = self.info;
  if (self.info.overrides?.unlinked) {
    const own = self.info.needsReview ? ['needs review'] : [];
    return result('unlinked', { sync: own, effectiveSource: effective });
  }
  const sync = flags(self, effective);
  const overridden = Boolean(base?.targetVersion && self.info.version
    && base.targetVersion !== self.info.version);
  const opts = { sync, effectiveSource: effective, overridden };

  if (!base) {
    if (!effective) return result('standalone', opts);
    sync.push('behind source');
    return result('local copy', { ...opts, reasons: ['base-unknown'] });
  }

  if (!effective) {
    sync.push('source deleted');
  } else if (base.sourceId !== effective.info.id
    || base.sourceVersion !== effective.info.version) {
    sync.push('behind source');
  } else {
    sync.push('current');
  }
  return result(base.via === 'translate' ? 'translation' : 'local copy', opts);
}

function missingStatus(self, effective, chain) {
  const opts = { sync: flags(self, effective), effectiveSource: effective };
  const linked = self.ref.location.missingPages === 'linked' || Boolean(self.info?.linked);
  if (effective && linked) {
    const { live, preview } = self.info?.published ?? {};
    if (live === false) opts.sync.push('not published');
    if (live === false && preview === false) opts.reasons = ['not-previewed'];
    return result('inherited', opts);
  }
  if (effective) return result('not created', opts);
  if (linked && chain.slice(1).some(exists)) return result('unavailable', opts);
  return null;
}

export function pageStatus(chain) {
  const [self] = chain || [];
  if (!self) return null;
  const { location } = self.ref;

  if (!location.valid) return result('config error', { reasons: ['invalid-location'] });
  if (!location.resolved) return result('unknown', { reasons: ['unresolved-location'] });

  if (!location.source) {
    return exists(self) ? result('root', { sync: flags(self, null) }) : null;
  }

  const effective = findEffectiveSource(chain);
  return exists(self) ? existingStatus(self, effective) : missingStatus(self, effective, chain);
}
