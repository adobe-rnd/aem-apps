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
import { canTranslate, defaultRefreshAction } from './language.js';

export const REFRESHABLE = ['local copy', 'translation', 'inherited', 'not created'];
const COPIES = ['local copy', 'translation'];
const MISSING = ['inherited', 'not created'];

export function availableActions({
  status,
  location,
  translationSupported = true,
  backendSupported = true,
  copyEngineAvailable = true,
}) {
  if (!status || !location) return [];
  const { relationship, sync, effectiveSource } = status;
  const has = (value) => sync.includes(value);
  const creates = MISSING.includes(relationship);
  const options = creates ? undefined : [...location.conflictBehavior];
  const inProgress = has('translating') || has('ready to save');
  const sourceLanguage = effectiveSource?.location?.language;

  const backendReasons = [
    !backendSupported && 'backend-unsupported',
    !copyEngineAvailable && 'copy-engine-unavailable',
  ].filter(Boolean);

  const blockers = () => [
    has('needs review') && 'needs-review',
    has('blocked by source review') && 'source-needs-review',
    inProgress && 'translation-in-progress',
    !effectiveSource && 'no-source',
  ].filter(Boolean);

  const entry = (action, reasons, extra = {}) => ({
    action,
    enabled: reasons.length === 0,
    reasons,
    ...extra,
  });

  const result = [];

  if (REFRESHABLE.includes(relationship)) {
    const offered = ['rollout', 'translate'].filter((action) => location.actions.includes(action));
    const preferred = offered.length === 1 || !sourceLanguage
      ? offered[0]
      : defaultRefreshAction(sourceLanguage, location.language);

    offered.forEach((action) => {
      const reasons = [];
      if (action === 'translate' && sourceLanguage) {
        if (!canTranslate(sourceLanguage, location.language)) reasons.push('language-not-translatable');
        else if (!translationSupported) reasons.push('connector-unsupported');
      }
      reasons.push(...backendReasons, ...blockers());
      const extra = { creates, default: action === preferred };
      if (options) extra.options = options;
      result.push(entry(action, reasons, extra));
    });
  }

  if (COPIES.includes(relationship)
    && location.actions.includes('link')
    && location.missingPages === 'linked') {
    result.push(entry('reconnect', inProgress ? ['translation-in-progress'] : [], { destructive: true }));
  }

  if (COPIES.includes(relationship) || relationship === 'inherited') {
    const unlinkCreates = relationship === 'inherited';
    const reasons = [
      ...(unlinkCreates ? backendReasons : []),
      ...(inProgress ? ['translation-in-progress'] : []),
    ];
    result.push(entry('unlink', reasons, { creates: unlinkCreates }));
  }

  if (relationship === 'unlinked') {
    result.push(entry('relink', effectiveSource ? [] : ['no-source']));
  }

  if (has('ready to save')) {
    const extra = { creates };
    if (options) extra.options = options;
    const saveReasons = [...backendReasons, ...(has('needs review') ? ['needs-review'] : [])];
    result.push(entry('save', saveReasons, extra));
  }

  return result;
}
