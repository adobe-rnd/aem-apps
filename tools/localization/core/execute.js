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

  const mergeChanges = (all, locationId, changes) => {
    const merged = all.get(locationId) ?? { pages: {}, pending: {} };
    Object.assign(merged.pages, changes.pages);
    Object.assign(merged.pending, changes.pending);
    all.set(locationId, merged);
  };

  const patchAll = (all) => [...all].reduce(async (previous, [locationId, changes]) => {
    await previous;
    await providers.index.patch(locationId, changes);
  }, Promise.resolve());

  const trackedEntries = (record) => record.entries ?? [{
    itemId: ITEM_ID,
    lang: record.lang,
    target: record.target,
    source: record.source,
    sourceId: record.sourceId,
    sourceVersion: record.sourceVersion,
    option: record.option ?? null,
  }];

  const trackedFor = (record, { site, path }) => trackedEntries(record)
    .find((each) => each.target.site === site && each.target.path === path);

  const jobSiteOf = (job, site) => job.jobSite ?? site;

  function prepareTranslate(current, target, entry, option) {
    const connectors = services.translationConnectors;
    if (!connectors?.call || !services.content?.read) return { ok: false, error: 'connector-unavailable' };
    if (option && !chooseOption(current, entry, option)) return { ok: false, error: 'option-not-allowed' };
    const source = current.status.effectiveSource;
    return {
      prepared: {
        current,
        target,
        option: option ?? null,
        source,
        sourceInfo: infoOf(current, source),
        lang: current.location.language,
      },
    };
  }

  const groupTitle = (sources, location) => (sources.length === 1
    ? `${LABEL} ${sources[0].path}`
    : `${LABEL} ${sources.length} pages from ${location.id}`);

  function chunkItems(items, { maxBatchItems, maxBatchBytes } = {}) {
    const chunks = [];
    let chunk = [];
    let bytes = 0;
    items.forEach((item) => {
      const size = item.content.length;
      const full = (maxBatchItems && chunk.length >= maxBatchItems)
        || (maxBatchBytes && bytes + size > maxBatchBytes);
      if (chunk.length && full) {
        chunks.push(chunk);
        chunk = [];
        bytes = 0;
      }
      chunk.push(item);
      bytes += size;
    });
    if (chunk.length) chunks.push(chunk);
    return chunks;
  }

  async function sendChunk(members, items, results) {
    const { source } = members[0];
    const keys = new Set(items.map((item) => item.key));
    const chunkMembers = members.filter((member) => keys.has(pageKey(member.source)));
    const job = {
      title: groupTitle(items.map((item) => item.source), source.location),
      org,
      site: source.site,
      src: source.location.language,
      dests: [...new Set(chunkMembers.map((member) => member.lang))],
    };
    const sent = await services.translationConnectors.call('send', {
      job,
      items: items.map(({
        id, path, format, content,
      }) => ({
        id, path, format, content,
      })),
    });
    if (sent?.error || !sent?.jobState) {
      const failure = { ok: false, error: sent?.error?.message ?? 'send-failed', code: sent?.error?.code };
      chunkMembers.forEach((member) => results.set(member, failure));
      return;
    }
    const idOf = new Map(items.map((item) => [item.key, item.id]));
    const jobId = newJobId();
    const sentAt = now();
    const jobSite = chunkMembers[0].target.site;
    let wrote = false;
    try {
      await providers.jobs.save(jobSite, jobId, {
        jobState: sent.jobState,
        entries: chunkMembers.map((member) => ({
          itemId: idOf.get(pageKey(member.source)),
          lang: member.lang,
          target: member.target,
          source: { site: member.source.site, path: member.source.path },
          sourceId: member.sourceInfo.id,
          sourceVersion: member.sourceInfo.version,
          option: member.option,
        })),
        sentAt,
      });
      wrote = true;
      const changes = new Map();
      chunkMembers.forEach((member) => {
        const entry = { state: 'translating', jobId, sentAt };
        if (jobSite !== member.target.site) entry.jobSite = jobSite;
        const patch = jobPatch(member.current, member.target, entry);
        mergeChanges(changes, member.current.location.id, patch);
      });
      await patchAll(changes);
      chunkMembers.forEach((member) => results.set(member, { ok: true, jobId }));
    } catch (error) {
      const failure = { ok: false, error: error.message, partial: wrote };
      chunkMembers.forEach((member) => results.set(member, failure));
    }
  }

  async function sendGroup(members, results) {
    const unique = new Map(members.map((member) => [pageKey(member.source), member.source]));
    const sources = [...unique.values()];
    const contents = await Promise.all(sources.map((source) => services.content.read(source)));
    const items = sources.flatMap((source, index) => {
      const content = contents[index];
      if (content === null || content === undefined) return [];
      return [{
        id: `item-${index + 1}`,
        key: pageKey(source),
        source,
        path: relativeTo(source),
        format: 'html',
        content,
      }];
    });
    const readable = new Set(items.map((item) => item.key));
    const readableMembers = members.filter((member) => readable.has(pageKey(member.source)));
    members.filter((member) => !readable.has(pageKey(member.source)))
      .forEach((member) => results.set(member, { ok: false, error: 'source-unreadable' }));
    if (!items.length) return;
    const limits = services.translationConnectors.describe?.capabilities;
    await chunkItems(items, limits).reduce(async (previous, chunk) => {
      await previous;
      await sendChunk(readableMembers, chunk, results);
    }, Promise.resolve());
  }

  async function sendGroups(prepared) {
    const results = new Map();
    const groups = new Map();
    prepared.forEach((member) => {
      const key = member.source.location.id;
      groups.set(key, [...(groups.get(key) ?? []), member]);
    });
    await Promise.all([...groups.values()].map((members) => sendGroup(members, results)));
    return results;
  }

  async function translate(current, target, entry, option) {
    const { prepared, ...failed } = prepareTranslate(current, target, entry, option);
    if (!prepared) return failed;
    return (await sendGroups([prepared])).get(prepared);
  }

  async function translateMany(targets) {
    refresh();
    try {
      const slots = await Promise.all(targets.map(async ({ site, path, option }) => {
        try {
          const current = await page(site, path);
          const entry = current.actions.find((each) => each.action === 'translate');
          if (!entry) return { ok: false, error: 'action-unavailable', reasons: [] };
          if (!entry.enabled) return { ok: false, error: 'action-disabled', reasons: entry.reasons };
          return prepareTranslate(current, { site, path }, entry, option);
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }));
      const prepared = slots.filter((slot) => slot.prepared).map((slot) => slot.prepared);
      const results = await sendGroups(prepared);
      return targets.map(({ site, path }, index) => ({
        site, path, ...(slots[index].prepared ? results.get(slots[index].prepared) : slots[index]),
      }));
    } finally {
      refresh();
    }
  }

  const resultCache = new Map();

  function loadResults(jobSite, jobId, record, lang) {
    const key = `${jobSite}:${jobId}:${lang}`;
    if (!resultCache.has(key)) {
      const left = new Set(trackedEntries(record)
        .filter((each) => each.lang === lang)
        .map((each) => pageKey(each.target)));
      const items = new Map();
      const readPages = async (cursor) => {
        const results = await services.translationConnectors.call('getResults', {
          jobState: record.jobState, lang, ...(cursor ? { cursor } : {}),
        });
        if (results?.error) return { error: results.error };
        (results?.items ?? []).forEach((item) => items.set(item.id, item));
        return results?.cursor ? readPages(results.cursor) : { items };
      };
      const load = readPages();
      resultCache.set(key, { load, left });
      const evict = () => resultCache.delete(key);
      load.then((loaded) => { if (loaded.error) evict(); }, evict);
    }
    return { key, ...resultCache.get(key) };
  }

  async function save(current, target, entry, option, progress) {
    const { job } = current.chain[0].info;
    const jobSite = job && jobSiteOf(job, target.site);
    const record = job?.jobId && await providers.jobs.read(jobSite, job.jobId);
    const tracked = record && trackedFor(record, target);
    if (!tracked) return { ok: false, error: 'job-missing' };
    const chosen = chooseOption(current, entry, option, tracked.option);
    if (!chosen) return { ok: false, error: 'option-not-allowed' };
    const cached = loadResults(jobSite, job.jobId, record, tracked.lang);
    const loaded = await cached.load;
    cached.left.delete(pageKey(target));
    if (!cached.left.size) resultCache.delete(cached.key);
    const item = loaded.items?.get(tracked.itemId);
    if (loaded.error || !item || item.error) {
      return { ok: false, error: (loaded.error ?? item?.error)?.message ?? 'results-missing' };
    }
    const written = await writeCopy(current, target, {
      option: chosen,
      progress,
      source: tracked.source,
      content: item.content,
      base: { sourceId: tracked.sourceId, sourceVersion: tracked.sourceVersion, via: 'translate' },
      extra: { job: null },
    });
    if (!written.ok) return written;
    return completeWith(await runOnComplete(current.location, target));
  }

  function applyStatus(current, target, job, lang, status, changes) {
    const langStatus = status?.langs?.[lang];
    const result = { ...target };
    if (langStatus) result.progress = { done: langStatus.done, total: langStatus.total };
    const locationId = current.location.id;
    if (langStatus?.status === 'translated') {
      mergeChanges(changes, locationId, jobPatch(current, target, { ...job, state: 'ready' }));
      return { ...result, state: 'ready' };
    }
    if (!langStatus || ['failed', 'cancelled'].includes(langStatus.status)) {
      mergeChanges(changes, locationId, jobPatch(current, target, null));
      const error = langStatus?.error?.message ?? status?.error?.message;
      return error ? { ...result, state: 'failed', error } : { ...result, state: 'failed' };
    }
    return { ...result, state: 'translating' };
  }

  async function checkGroup(jobSite, jobId, members, changes) {
    const record = await providers.jobs.read(jobSite, jobId);
    if (!record) {
      return members.map(({ target, current }) => {
        mergeChanges(changes, current.location.id, jobPatch(current, target, null));
        return {
          ...target, state: 'failed', error: 'job-missing',
        };
      });
    }
    const status = await services.translationConnectors.call('getStatus', { jobState: record.jobState });
    if (status?.jobState) {
      await providers.jobs.save(jobSite, jobId, { ...record, jobState: status.jobState });
    }
    const asked = new Set(members.map(({ target }) => pageKey(target)));
    const others = trackedEntries(record).filter((each) => !asked.has(pageKey(each.target)));
    await Promise.all(others.map(async (each) => {
      const current = await page(each.target.site, each.target.path);
      const job = current.chain[0]?.info?.job;
      if (job?.jobId === jobId && job.state === 'translating') {
        applyStatus(current, each.target, job, each.lang, status, changes);
      }
    }));
    return members.map(({ target, current, job }) => {
      const tracked = trackedFor(record, target);
      return applyStatus(current, target, job, tracked?.lang ?? record.lang, status, changes);
    });
  }

  async function checkJobs(pages) {
    refresh();
    if (!services.translationConnectors?.call) return pages.map((ref) => ({ ...ref, state: 'none' }));
    const results = new Map();
    const groups = new Map();
    await Promise.all(pages.map(async (ref) => {
      try {
        const current = await page(ref.site, ref.path);
        const job = current.chain[0]?.info?.job;
        if (!job?.jobId) {
          results.set(ref, { ...ref, state: 'none' });
        } else if (job.state === 'ready') {
          results.set(ref, { ...ref, state: 'ready' });
        } else {
          const jobSite = jobSiteOf(job, ref.site);
          const key = `${jobSite}\n${job.jobId}`;
          const group = groups.get(key) ?? { jobSite, jobId: job.jobId, members: [] };
          group.members.push({
            ref, target: { site: ref.site, path: ref.path }, current, job,
          });
          groups.set(key, group);
        }
      } catch (error) {
        results.set(ref, { ...ref, state: 'error', error: error.message });
      }
    }));
    const changes = new Map();
    await Promise.all([...groups.values()].map(async ({ jobSite, jobId, members }) => {
      try {
        const settled = await checkGroup(jobSite, jobId, members, changes);
        members.forEach(({ ref }, index) => results.set(ref, settled[index]));
      } catch (error) {
        members.forEach(({ ref }) => results.set(ref, { ...ref, state: 'error', error: error.message }));
      }
    }));
    try {
      await patchAll(changes);
    } catch (error) {
      pages.forEach((ref) => {
        if (['ready', 'failed', 'translating'].includes(results.get(ref)?.state)) {
          results.set(ref, { ...ref, state: 'error', error: error.message });
        }
      });
    }
    refresh();
    return pages.map((ref) => results.get(ref));
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

  return {
    execute, publish, checkJobs, translateMany,
  };
}
