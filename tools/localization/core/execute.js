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
import { targetPages } from './domain/resolve.js';

const LABEL = 'MSM';
const ITEM_ID = 'item-1';
const now = () => new Date().toISOString();
const pageKey = ({ site, path }) => `${site}:${path}`;
const newJobId = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const relativeTo = (ref) => (ref.location.path === '/' ? ref.path : ref.path.slice(ref.location.path.length));

export default function createExecutor({
  org, page, providers, services, refresh, orgModel,
}) {
  const infoOf = (current, ref) => current.chain.find((entry) => entry.ref === ref)?.info;

  async function runOnComplete(location, target) {
    if (location.onComplete === 'publish') return services.publish.publish(target);
    if (location.onComplete === 'preview') return services.publish.preview(target);
    return { ok: true };
  }

  const completeWith = (completed) => (completed.ok
    ? { ok: true, onComplete: completed }
    : { ok: true, onComplete: completed, warnings: ['onComplete-failed'] });

  async function writeCopy(current, target, {
    option, progress, source, content, base, extra = {},
  }) {
    const copy = option === 'overwrite' ? services.content.overwrite : services.content.merge;
    const request = { source, target, label: `${LABEL} ${base.via}` };
    if (content !== undefined) request.content = content;
    const copied = await copy(request);
    if (!copied?.ok) return { ok: false, status: copied?.status, error: copied?.error };
    Object.assign(progress, { wrote: true });
    const written = await providers.pageInfo.get(target.site, target.path);
    if (!written?.exists || !written.id || !written.version) {
      return { ok: false, error: 'target-unreadable' };
    }
    const changes = {
      pages: {
        [written.id]: {
          ...extra,
          base: { ...base, targetVersion: written.version, at: now() },
        },
      },
      pending: { [target.path]: null },
    };
    await providers.index.patch(current.location.id, changes);
    return { ok: true, id: written.id };
  }

  async function copyFromSource(current, target, option, progress) {
    const source = current.status.effectiveSource;
    const sourceInfo = infoOf(current, source);
    return writeCopy(current, target, {
      option,
      progress,
      source,
      base: { sourceId: sourceInfo.id, sourceVersion: sourceInfo.version, via: 'rollout' },
    });
  }

  const chooseOption = (current, entry, option, fallback) => {
    const allowed = entry.options ?? current.location.conflictBehavior;
    const chosen = option ?? fallback ?? allowed[0] ?? 'merge';
    return allowed.includes(chosen) ? chosen : null;
  };

  async function rollout(current, target, entry, option, progress) {
    const chosen = chooseOption(current, entry, option);
    if (!chosen) return { ok: false, error: 'option-not-allowed' };
    const copied = await copyFromSource(current, target, chosen, progress);
    if (!copied.ok) return copied;
    return completeWith(await runOnComplete(current.location, target));
  }

  const jobPatch = (current, target, job) => {
    const { exists, id } = current.chain[0].info;
    if (exists) return { pages: { [id]: { job } } };
    return { pending: { [target.path]: job ? { job } : null } };
  };

  async function translate(current, target, entry, option, progress) {
    const connectors = services.translationConnectors;
    if (!connectors?.call || !services.content?.read) return { ok: false, error: 'connector-unavailable' };
    if (option && !chooseOption(current, entry, option)) return { ok: false, error: 'option-not-allowed' };
    const source = current.status.effectiveSource;
    const sourceInfo = infoOf(current, source);
    const content = await services.content.read(source);
    if (content === null || content === undefined) return { ok: false, error: 'source-unreadable' };
    const lang = current.location.language;
    const job = {
      title: `${LABEL} ${source.path}`, org, site: source.site, src: source.location.language, dests: [lang],
    };
    const items = [{
      id: ITEM_ID, path: relativeTo(source), format: 'html', content,
    }];
    const sent = await connectors.call('send', { job, items });
    if (sent?.error || !sent?.jobState) {
      return { ok: false, error: sent?.error?.message ?? 'send-failed', code: sent?.error?.code };
    }
    const jobId = newJobId();
    const sentAt = now();
    await providers.jobs.save(target.site, jobId, {
      jobState: sent.jobState,
      lang,
      source: { site: source.site, path: source.path },
      sourceId: sourceInfo.id,
      sourceVersion: sourceInfo.version,
      target,
      option: option ?? null,
      sentAt,
    });
    Object.assign(progress, { wrote: true });
    await providers.index.patch(current.location.id, jobPatch(current, target, {
      state: 'translating', jobId, sentAt,
    }));
    return { ok: true, jobId };
  }

  async function save(current, target, entry, option, progress) {
    const { job } = current.chain[0].info;
    const record = job?.jobId && await providers.jobs.read(target.site, job.jobId);
    if (!record) return { ok: false, error: 'job-missing' };
    const chosen = chooseOption(current, entry, option, record.option);
    if (!chosen) return { ok: false, error: 'option-not-allowed' };
    const results = await services.translationConnectors.call('getResults', {
      jobState: record.jobState, lang: record.lang,
    });
    const item = results?.items?.find((each) => each.id === ITEM_ID);
    if (results?.error || !item || item.error) {
      return { ok: false, error: (results?.error ?? item?.error)?.message ?? 'results-missing' };
    }
    const written = await writeCopy(current, target, {
      option: chosen,
      progress,
      source: record.source,
      content: item.content,
      base: { sourceId: record.sourceId, sourceVersion: record.sourceVersion, via: 'translate' },
      extra: { job: null },
    });
    if (!written.ok) return written;
    return completeWith(await runOnComplete(current.location, target));
  }

  async function checkJob({ site, path }) {
    const current = await page(site, path);
    const info = current.chain[0]?.info;
    const job = info?.job;
    if (!job?.jobId) return { site, path, state: 'none' };
    if (job.state === 'ready') return { site, path, state: 'ready' };
    const record = await providers.jobs.read(site, job.jobId);
    const target = { site, path };
    if (!record) {
      await providers.index.patch(current.location.id, jobPatch(current, target, null));
      return {
        site, path, state: 'failed', error: 'job-missing',
      };
    }
    const status = await services.translationConnectors.call('getStatus', { jobState: record.jobState });
    const lang = status?.langs?.[record.lang];
    const result = { site, path };
    if (lang) result.progress = { done: lang.done, total: lang.total };
    if (status?.jobState) {
      await providers.jobs.save(site, job.jobId, { ...record, jobState: status.jobState });
    }
    if (lang?.status === 'translated') {
      await providers.index.patch(current.location.id, jobPatch(current, target, { ...job, state: 'ready' }));
      return { ...result, state: 'ready' };
    }
    if (!lang || ['failed', 'cancelled'].includes(lang.status)) {
      await providers.index.patch(current.location.id, jobPatch(current, target, null));
      const error = lang?.error?.message ?? status?.error?.message;
      return error ? { ...result, state: 'failed', error } : { ...result, state: 'failed' };
    }
    return { ...result, state: 'translating' };
  }

  async function checkJobs(pages) {
    refresh();
    if (!services.translationConnectors?.call) return pages.map((ref) => ({ ...ref, state: 'none' }));
    const results = await Promise.all(pages.map((ref) => checkJob(ref)
      .catch((error) => ({ ...ref, state: 'error', error: error.message }))));
    refresh();
    return results;
  }

  async function reconnect(current, target, entry, option, progress) {
    if (!services.content?.remove) return { ok: false, error: 'content-unavailable' };
    const removed = await services.content.remove(target);
    if (!removed?.ok) return { ok: false, status: removed?.status, error: 'remove-failed' };
    Object.assign(progress, { wrote: true });
    const { id } = current.chain[0].info;
    const changes = { pending: { [target.path]: null } };
    if (id) changes.pages = { [id]: null };
    await providers.index.patch(current.location.id, changes);
    return completeWith(await runOnComplete(current.location, target));
  }

  async function link(current, target) {
    await providers.index.patch(current.location.id, {
      pending: { [target.path]: { linked: true, at: now() } },
    });
    const published = await services.publish.publish(target).catch((error) => ({
      ok: false, error: error.message,
    }));
    if (published?.ok) return { ok: true, publish: published };
    await providers.index.patch(current.location.id, { pending: { [target.path]: null } });
    return { ok: false, status: published?.status, error: published?.error ?? 'publish-failed' };
  }

  async function unlink(current, target, entry, option, progress) {
    let { id } = current.chain[0].info;
    if (entry.creates) {
      const copied = await copyFromSource(current, target, 'overwrite', progress);
      if (!copied.ok) return copied;
      id = copied.id;
    }
    const source = current.status.effectiveSource;
    const overrides = {
      ...(current.chain[0].info.overrides ?? {}),
      unlinked: true,
      unlinkedFrom: source ? pageKey(source) : null,
      unlinkedAt: now(),
    };
    await providers.index.patch(current.location.id, { pages: { [id]: { overrides } } });
    return { ok: true };
  }

  async function relink(current) {
    const { id, overrides = {} } = current.chain[0].info;
    const rest = Object.fromEntries(Object.entries(overrides ?? {})
      .filter(([field]) => !['unlinked', 'unlinkedFrom', 'unlinkedAt'].includes(field)));
    const patch = { overrides: Object.keys(rest).length ? rest : null };
    await providers.index.patch(current.location.id, { pages: { [id]: patch } });
    return { ok: true };
  }

  const HANDLERS = {
    rollout, reconnect, unlink, relink, link, translate, save,
  };

  async function execute({
    site, path, action, option,
  }) {
    refresh();
    const current = await page(site, path);
    const entry = current.actions.find((each) => each.action === action);
    if (!entry || !HANDLERS[action]) {
      return { ok: false, error: 'action-unavailable', reasons: entry?.reasons ?? [] };
    }
    if (!entry.enabled) return { ok: false, error: 'action-disabled', reasons: entry.reasons };
    const progress = { wrote: false };
    try {
      return await HANDLERS[action](current, { site, path }, entry, option, progress);
    } catch (error) {
      return { ok: false, error: error.message, partial: progress.wrote };
    } finally {
      refresh();
    }
  }

  async function inheritedTargets(model, ref, seen) {
    const targets = targetPages(model, ref.site, ref.path)
      .filter((target) => !seen.has(pageKey(target)));
    targets.forEach((target) => seen.add(pageKey(target)));
    const nested = await Promise.all(targets.map(async (target) => {
      const current = await page(target.site, target.path);
      if (current.status?.relationship !== 'inherited') return [];
      return [target, ...await inheritedTargets(model, target, seen)];
    }));
    return nested.flat();
  }

  async function publish({
    site, path, live = true, cascade = false,
  }) {
    refresh();
    const root = { site, path };
    const pages = [root];
    if (cascade) {
      const model = await orgModel();
      pages.push(...await inheritedTargets(model, root, new Set([pageKey(root)])));
    }
    const run = live ? services.publish.publish : services.publish.preview;
    const results = await pages.reduce(async (previous, target) => {
      const done = await previous;
      return [...done, { ...target, ...await run(target) }];
    }, Promise.resolve([]));
    return { ok: results.every((result) => result.ok), results };
  }

  return { execute, publish, checkJobs };
}
