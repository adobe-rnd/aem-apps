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

export const PROPOSALS_ROOT = '/drafts/proposals';

const OPEN_STATUSES = ['open', 'partially-merged'];

const TYPE_LABELS = {
  'text-adaptation': 'Text adapted',
  'claim-adjusted': 'Claim adjusted',
  'image-replaced': 'Image replaced',
  translated: 'Translated',
  'as-is': 'Kept as is',
  skipped: 'Skipped',
};

export function pagePathFrom(path) {
  if (!path) return '/index.html';
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (clean.endsWith('/')) return `${clean}index.html`;
  const last = clean.split('/').pop();
  return last.includes('.') ? clean : `${clean}.html`;
}

const asText = (value) => (typeof value === 'string' ? value : '');

export function parseProposal(raw, id) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages) || !raw.pages.length) return null;
  const pages = raw.pages
    .filter((page) => page && typeof page.target === 'string' && typeof page.draftPath === 'string')
    .map((page) => ({
      target: pagePathFrom(page.target),
      draftPath: page.draftPath,
      label: asText(page.label),
      language: asText(page.language),
      baseVersionId: page.baseVersionId ?? null,
      mergeMode: page.mergeMode ?? null,
    }));
  if (!pages.length) return null;
  const changes = Array.isArray(raw.changes) ? raw.changes : [];
  return {
    id: asText(raw.id) || id,
    status: asText(raw.status) || 'open',
    title: asText(raw.title) || 'Untitled proposal',
    summary: asText(raw.summary),
    createdAt: asText(raw.createdAt),
    source: { path: pagePathFrom(raw.source?.path), language: asText(raw.source?.language) },
    pages,
    changes: changes.map((change) => ({
      target: change.target ? pagePathFrom(change.target) : null,
      type: asText(change.type),
      rationale: asText(change.rationale),
      sourceChangeId: asText(change.sourceChangeId),
    })),
  };
}

export const isOpen = (proposal) => OPEN_STATUSES.includes(proposal.status);

export const typeLabel = (type) => TYPE_LABELS[type] ?? (type || 'Changed');

export function proposalsForPage(proposals, path) {
  const page = pagePathFrom(path);
  const targeting = [];
  const sourceOf = [];
  proposals.filter(isOpen).forEach((proposal) => {
    const entry = proposal.pages
      .find((candidate) => candidate.target === page && !candidate.mergeMode);
    if (entry) {
      targeting.push({
        proposal,
        page: entry,
        changes: proposal.changes.filter((change) => !change.target || change.target === page),
      });
    } else if (proposal.source.path === page) {
      sourceOf.push(proposal);
    }
  });
  const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);
  targeting.sort((a, b) => newest(a.proposal, b.proposal));
  sourceOf.sort(newest);
  return { targeting, sourceOf };
}

export const isProposalPath = (path) => path === PROPOSALS_ROOT || path.startsWith(`${PROPOSALS_ROOT}/`);

export const isDraftPath = (path) => /^\/drafts(\/|$)/.test(path);

export const proposalFolder = (id) => `${PROPOSALS_ROOT}/${id}`;
export const recordPath = (id) => `${proposalFolder(id)}/proposal.json`;
export const previewPath = (id, target) => `${proposalFolder(id)}/preview${pagePathFrom(target)}`;

export const canvasUrl = (org, site, path) => `https://da.live/canvas#/${org}/${site}${pagePathFrom(path).replace(/\.html$/, '')}`;

export function mergeCheck(result) {
  if (!result) return { tone: 'neutral', label: 'Not checked' };
  if (result.unchanged) return { tone: 'neutral', label: 'Already up to date' };
  if (result.skipped > 0) {
    const noun = result.skipped === 1 ? 'block' : 'blocks';
    return {
      tone: 'notice',
      label: `${result.skipped} ${noun} also changed on this page since the proposal was opened. The page keeps its own version of ${result.skipped === 1 ? 'it' : 'them'}.`,
    };
  }
  return { tone: 'positive', label: 'Merges cleanly' };
}

export function applyMerged(raw, merged, at) {
  const mergedTargets = new Map(merged.map(({ target, mode }) => [target, mode]));
  const pages = raw.pages.map((page) => {
    const target = pagePathFrom(page.target);
    return mergedTargets.has(target) ? { ...page, mergeMode: mergedTargets.get(target) } : page;
  });
  const remaining = pages.some((page) => !page.mergeMode);
  return {
    ...raw,
    status: remaining ? 'partially-merged' : 'merged',
    mergedAt: at,
    pages,
  };
}

export function applyRejected(raw, reason, at) {
  return {
    ...raw,
    status: 'rejected',
    rejectedAt: at,
    ...(reason ? { reason } : {}),
  };
}

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
