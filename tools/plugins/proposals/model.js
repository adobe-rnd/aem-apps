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

export const proposalFolder = (id) => `${PROPOSALS_ROOT}/${id}`;
export const recordPath = (id) => `${proposalFolder(id)}/proposal.json`;
export const previewPath = (id, target) => `${proposalFolder(id)}/preview${pagePathFrom(target)}`;

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

export function roleSummary(role, proposal) {
  const { pages, source } = proposal;
  const targets = pages.length === 1 ? (pages[0].label || pages[0].target) : `${pages.length} pages`;
  switch (role) {
    case 'source': return `Sent from this page to ${targets}`;
    case 'target': return `Proposed for this page, from ${source.path}`;
    case 'draft': return `Draft for ${targets}, from ${source.path}`;
    case 'preview': return `Diff view for ${targets}, from ${source.path}`;
    default: return source.path;
  }
}

export function changeSummary(changes) {
  const total = changes.length;
  const skipped = changes.filter((change) => change.type === 'skipped').length;
  const noun = total === 1 ? 'change' : 'changes';
  return { total, skipped, label: `${total} ${noun}${skipped ? `, ${skipped} skipped` : ''}` };
}

export const typeLabel = (type) => TYPE_LABELS[type] ?? (type || 'Changed');

const isClosed = (proposal) => !isOpen(proposal);

const pageIsDone = (proposal, page) => Boolean(page.mergeMode) || isClosed(proposal);

export function pageState(proposal, page) {
  if (page.mergeMode) return 'merged';
  if (proposal.status === 'rejected') return 'rejected';
  return pageIsDone(proposal, page) ? 'closed' : 'open';
}

function roleFor(proposal, path) {
  const target = proposal.pages.find((page) => page.target === path);
  if (target) return { role: 'target', pages: [target] };
  const draft = proposal.pages.find((page) => pagePathFrom(page.draftPath) === path);
  if (draft) return { role: 'draft', pages: [draft] };
  const preview = proposal.pages.find((page) => previewPath(proposal.id, page.target) === path);
  if (preview) return { role: 'preview', pages: [preview] };
  if (proposal.source.path === path) return { role: 'source', pages: proposal.pages };
  return null;
}

export const cardKey = (proposal, page) => `${proposal.id}|${page.target}`;

export function involvement(proposals, path) {
  const here = pagePathFrom(path);
  const items = [];
  proposals.forEach((proposal) => {
    const found = roleFor(proposal, here);
    if (!found) return;
    found.pages.forEach((page) => {
      const state = pageState(proposal, page);
      items.push({
        proposal,
        role: found.role,
        page,
        changes: proposal.changes
          .filter((change) => !change.target || change.target === page.target),
        state,
        actionable: state === 'open',
      });
    });
  });
  const newest = (a, b) => b.proposal.createdAt.localeCompare(a.proposal.createdAt);
  const open = items.filter((item) => item.state === 'open').sort(newest);
  const closed = items.filter((item) => item.state !== 'open').sort(newest);
  return { open, closed };
}

export function groupByProposal(items) {
  const groups = new Map();
  items.forEach((item) => {
    const { id } = item.proposal;
    if (!groups.has(id)) groups.set(id, { proposal: item.proposal, items: [] });
    groups.get(item.proposal.id).items.push(item);
  });
  return [...groups.values()];
}

export const isProposalPath = (path) => path === PROPOSALS_ROOT || path.startsWith(`${PROPOSALS_ROOT}/`);

export const isDraftPath = (path) => /^\/drafts(\/|$)/.test(path);

export const canvasUrl = (org, site, path) => `https://da.live/canvas#/${org}/${site}${pagePathFrom(path).replace(/\.html$/, '')}`;

export function mergeCheck(result) {
  if (!result) return { tone: 'neutral', label: 'Not checked' };
  if (result.unchanged) return { tone: 'neutral', label: 'Already up to date' };
  if (result.skipped > 0) {
    const noun = result.skipped === 1 ? 'block' : 'blocks';
    return {
      tone: 'notice',
      label: `${result.skipped} ${noun} also edited on this page. Your ${result.skipped === 1 ? 'version is' : 'versions are'} kept.`,
    };
  }
  return { tone: 'positive', label: 'Ready to approve. No conflicts with edits on this page.' };
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
