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

/**
 * Keeps a Lit host subscribed to the session bus of its `store` property
 * while connected, re-subscribing before render when the store changes.
 * `subscribe(bus)` returns the unsubscribe functions; replayed `*State`
 * channels hand the host the current state at once.
 */
export class BusController {
  #subscribe;

  #store = null;

  #offs = [];

  constructor(host, subscribe) {
    this.host = host;
    this.#subscribe = subscribe;
    host.addController(this);
  }

  hostConnected() {
    this.#attach();
  }

  hostUpdate() {
    if (this.host.isConnected && this.host.store !== this.#store) this.#attach();
  }

  hostDisconnected() {
    this.#detach();
  }

  #attach() {
    this.#detach();
    this.#store = this.host.store ?? null;
    if (this.#store) this.#offs = this.#subscribe(this.#store.bus);
  }

  #detach() {
    this.#offs.forEach((off) => off());
    this.#offs = [];
    this.#store = null;
  }
}
