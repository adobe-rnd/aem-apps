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
const now = () => new Date().toISOString();
const pageKey = ({ site, path }) => `${site}:${path}`;

export default function createExecutor({
  page, providers, services, refresh, orgModel,
}) {
  const infoOf = (current, ref) => current.chain.find((entry) => entry.ref === ref)?.info;

  async function runOnComplete(location, target) {
    if (location.onComplete === 'publish') return services.publish.publish(target);
    if (location.onComplete === 'preview') return services.publish.preview(target);
    return { ok: true };
  }

  async function copyFromSource(current, target, option) {
    const source = current.status.effectiveSource;
    const sourceInfo = infoOf(current, source);
    const copy = option === 'overwrite' ? services.content.overwrite : services.content.merge;
    const copied = await copy({ source, target, label: `${LABEL} rollout` });
    if (!copied?.ok) return { ok: false, status: copied?.status, error: copied?.error };
    const written = await providers.pageInfo.get(target.site, target.path);
    const changes = {
      pages: {
        [written.id]: {
          base: {
            sourceId: sourceInfo.id,
            sourceVersion: sourceInfo.version,
            via: 'rollout',
            targetVersion: written.version,
            at: now(),
          },
        },
      },
    };
    if (!current.chain[0].info.exists) changes.pending = { [target.path]: null };
    await providers.index.patch(current.location.id, changes);
    return { ok: true, id: written.id };
  }

  async function rollout(current, target, entry, option) {
    const chosen = option ?? entry.options?.[0] ?? current.location.conflictBehavior[0] ?? 'merge';
    if (entry.options && !entry.options.includes(chosen)) return { ok: false, error: 'option-not-allowed' };
    const copied = await copyFromSource(current, target, chosen);
    if (!copied.ok) return copied;
    const completed = await runOnComplete(current.location, target);
    return { ok: true, onComplete: completed };
  }

  async function reconnect(current, target) {
    const removed = await services.content.remove(target);
    if (!removed?.ok) return { ok: false, status: removed?.status, error: 'remove-failed' };
    const { id } = current.chain[0].info;
    if (id) await providers.index.patch(current.location.id, { pages: { [id]: null } });
    const completed = await runOnComplete(current.location, target);
    return { ok: true, onComplete: completed };
  }

  async function unlink(current, target, entry) {
    let { id } = current.chain[0].info;
    if (entry.creates) {
      const copied = await copyFromSource(current, target, 'overwrite');
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
    rollout, reconnect, unlink, relink,
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
    try {
      return await HANDLERS[action](current, { site, path }, entry, option);
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

  return { execute, publish };
}
