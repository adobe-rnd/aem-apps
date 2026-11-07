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

export default function createPool(limit = 8) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= limit || !queue.length) return;
    const { task, resolve, reject } = queue.shift();
    active += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  const run = (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });

  const clear = () => { queue.length = 0; };

  return {
    run,
    clear,
    get active() { return active; },
    get pending() { return queue.length; },
  };
}
