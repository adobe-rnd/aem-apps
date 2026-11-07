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
const BATCH = 4;

export default function createPublishLoader({ localization, onChange, batch = BATCH }) {
  const queue = [];
  const queued = new Set();
  let running = false;
  let stopped = false;
  const supported = typeof localization?.loadPublishState === 'function';
  const keyOf = (page) => `${page.site}:${page.path}`;

  async function pump() {
    if (running) return;
    running = true;
    const pages = queue.splice(0, batch);
    pages.forEach((page) => queued.delete(keyOf(page)));
    let changed = false;
    try {
      changed = await localization.loadPublishState(pages);
    } catch {
      changed = false;
    }
    running = false;
    if (changed && !stopped) onChange?.();
    if (queue.length && !stopped) pump();
  }

  function request(nodes, { priority = false } = {}) {
    if (!supported || stopped) return;
    const fresh = nodes
      .map((node) => ({ site: node.site, path: node.path }))
      .filter((page) => !queued.has(keyOf(page)));
    fresh.forEach((page) => queued.add(keyOf(page)));
    if (priority) queue.unshift(...fresh);
    else queue.push(...fresh);
    if (fresh.length) pump();
  }

  function invalidate(nodes) {
    if (!supported) return;
    if (!nodes) localization.invalidatePublishState?.();
    else nodes.forEach((node) => localization.invalidatePublishState?.(node.site, node.path));
  }

  const stop = () => { stopped = true; queue.length = 0; queued.clear(); };

  return { request, invalidate, stop };
}
