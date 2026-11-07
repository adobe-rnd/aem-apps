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
const BATCH = 100;
const IDLE_RETRY = 750;

export default function createPublishLoader({
  localization, onChange, batch = BATCH, idle = () => true, idleRetry = IDLE_RETRY,
}) {
  const queue = [];
  const background = [];
  const queued = new Set();
  let running = false;
  let stopped = false;
  let timer = null;
  const supported = typeof localization?.loadPublishState === 'function';
  const keyOf = (page) => `${page.site}:${page.path}`;

  function take() {
    if (queue.length) return queue.splice(0, batch);
    if (background.length && idle()) return background.splice(0, batch);
    return [];
  }

  async function pump() {
    if (running || stopped) return;
    const pages = take();
    if (!pages.length) {
      if (!timer && background.length) {
        timer = setTimeout(() => {
          timer = null;
          pump();
        }, idleRetry);
      }
      return;
    }
    running = true;
    pages.forEach((page) => queued.delete(keyOf(page)));
    let changed = false;
    try {
      changed = await localization.loadPublishState(pages);
    } catch {
      changed = false;
    }
    running = false;
    if (changed && !stopped) onChange?.();
    pump();
  }

  function promote(pages) {
    const keys = new Set(pages.map(keyOf));
    const moved = background.filter((page) => keys.has(keyOf(page)));
    if (!moved.length) return;
    const rest = background.filter((page) => !keys.has(keyOf(page)));
    background.length = 0;
    background.push(...rest);
    queue.unshift(...moved);
  }

  function request(nodes, { priority = false } = {}) {
    if (!supported || stopped) return;
    const pages = nodes.map((node) => ({ site: node.site, path: node.path }));
    if (priority) promote(pages);
    const fresh = pages.filter((page) => !queued.has(keyOf(page)));
    fresh.forEach((page) => queued.add(keyOf(page)));
    if (priority) queue.unshift(...fresh);
    else background.push(...fresh);
    if (fresh.length || priority) pump();
  }

  function invalidate(nodes) {
    if (!supported) return;
    if (!nodes) localization.invalidatePublishState?.();
    else nodes.forEach((node) => localization.invalidatePublishState?.(node.site, node.path));
  }

  const stop = () => {
    stopped = true;
    queue.length = 0;
    background.length = 0;
    queued.clear();
    clearTimeout(timer);
  };

  return { request, invalidate, stop };
}
