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
import planPropagation from './domain/plan.js';

const BLOCKING = new Set(['failed', 'blocked', 'needs review', 'awaiting translation', 'skipped']);
const SKIPPED = ['unlinked', 'standalone', 'root'];
const REFRESH = ['rollout', 'translate'];

const newId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function summarize(items) {
  return items.reduce((summary, item) => ({
    ...summary,
    [item.state]: (summary[item.state] ?? 0) + 1,
  }), { total: items.length });
}

export default function createRunner({
  page, execute, orgModel, refresh, runs,
}) {
  const settle = (item, state, extra = {}) => Object.assign(item, {
    state, reasons: [], ...extra, at: new Date().toISOString(),
  });

  async function rollout(item, entry, option) {
    const chosen = option && entry.options?.includes(option) ? option : undefined;
    const result = await execute({
      site: item.site, path: item.path, action: 'rollout', option: chosen,
    });
    if (!result.ok) return settle(item, 'failed', { action: 'rollout', error: result.error ?? 'failed' });
    refresh();
    const after = await page(item.site, item.path);
    if (after.status?.sync.includes('needs review')) return settle(item, 'needs review', { action: 'rollout' });
    return settle(item, 'done', { action: 'rollout' });
  }

  async function processItem(run, item) {
    const parent = item.parent && run.items.find((each) => each.key === item.parent);
    if (parent && BLOCKING.has(parent.state)) {
      return settle(item, 'blocked', { reasons: [`parent:${parent.state}`] });
    }
    const current = await page(item.site, item.path);
    const { status } = current;
    if (!status) return settle(item, 'skipped', { reasons: ['no-page'] });
    if (status.relationship === 'inherited') return settle(item, 'inherited');
    if (SKIPPED.includes(status.relationship)) return settle(item, 'skipped', { reasons: [status.relationship] });
    if (status.sync.includes('translating') || status.sync.includes('ready to save')) {
      return settle(item, 'awaiting translation', { action: 'translate', reasons: ['translation-in-progress'] });
    }

    const refreshers = current.actions.filter((entry) => REFRESH.includes(entry.action));
    const chosen = refreshers.find((entry) => entry.default) ?? refreshers[0];
    if (!chosen) {
      const link = current.actions.find((entry) => entry.action === 'link' && entry.enabled);
      if (!link) return settle(item, 'skipped', { reasons: ['no-action'] });
      const linked = await execute({ site: item.site, path: item.path, action: 'link' });
      return settle(item, linked.ok ? 'done' : 'failed', { action: 'link', error: linked.error });
    }
    if (!chosen.enabled) return settle(item, 'blocked', { action: chosen.action, reasons: chosen.reasons });
    if (status.sync.includes('current')) return settle(item, 'up to date');
    if (chosen.action === 'translate') return settle(item, 'awaiting translation', { action: 'translate' });
    return rollout(item, chosen, run.option);
  }

  async function process(run, onProgress) {
    const depths = [...new Set(run.items.map((item) => item.depth))].sort((a, b) => a - b);
    await depths.reduce(async (previous, depth) => {
      await previous;
      refresh();
      const pending = run.items.filter((item) => item.depth === depth && item.state === 'pending');
      await Promise.all(pending.map(async (item) => {
        settle(item, 'running');
        try {
          await processItem(run, item);
        } catch (error) {
          settle(item, 'failed', { error: error.message });
        }
        run.summary = summarize(run.items);
        onProgress?.(run);
      }));
      run.summary = summarize(run.items);
      if (runs) await runs.save(run);
    }, Promise.resolve());
    run.summary = summarize(run.items);
    run.updatedAt = new Date().toISOString();
    if (runs) await runs.save(run);
    refresh();
    return run;
  }

  async function propagate({
    pages, targets, option, title, onProgress,
  }) {
    refresh();
    const model = await orgModel();
    const { items } = planPropagation(model, { pages, targets });
    const run = {
      id: newId(),
      title: title ?? null,
      createdAt: new Date().toISOString(),
      site: pages[0]?.site ?? null,
      pages,
      targets: targets ?? null,
      option: option ?? null,
      items,
      summary: summarize(items),
    };
    return process(run, onProgress);
  }

  async function retryRun(run, { onProgress } = {}) {
    run.items.forEach((item) => {
      if (item.state === 'failed' || item.state === 'blocked') {
        Object.assign(item, { state: 'pending', reasons: [], error: undefined });
      }
    });
    return process(run, onProgress);
  }

  return { propagate, retryRun };
}
