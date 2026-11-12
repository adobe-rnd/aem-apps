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
import { describe, it } from 'node:test';
import { expect } from '../../expect.js';
import { createSchemaBus } from '../../../../../../tools/apps/schema-editor/core/session/bus.js';
import { BusController } from '../../../../../../tools/apps/schema-editor/ui/shared/bus-controller.js';

function setup() {
  const host = {
    store: { bus: createSchemaBus() },
    isConnected: false,
    seen: [],
    addController(controller) { this.controller = controller; },
    connect() { this.isConnected = true; this.controller.hostConnected(); },
    disconnect() { this.isConnected = false; this.controller.hostDisconnected(); },
  };
  // eslint-disable-next-line no-new
  new BusController(host, (bus) => [bus.pageState.subscribe(({ mode }) => host.seen.push(mode))]);
  return host;
}

describe('BusController', () => {
  it('follows the bus while connected, again after reconnecting', () => {
    const host = setup();
    host.store.bus.pageState.emit({ mode: 'build' });
    host.connect();
    host.store.bus.pageState.emit({ mode: 'components' });
    host.disconnect();
    host.store.bus.pageState.emit({ mode: 'build' });
    host.connect();
    expect(host.seen).to.deep.equal(['build', 'components', 'build']);
  });

  it('moves to a new store before rendering, leaving the old one', () => {
    const host = setup();
    host.connect();
    const old = host.store;
    host.store = { bus: createSchemaBus() };
    host.store.bus.pageState.emit({ mode: 'components' });
    host.controller.hostUpdate();
    old.bus.pageState.emit({ mode: 'build' });
    expect(host.seen).to.deep.equal(['components']);
  });

  it('does not subscribe while disconnected', () => {
    const host = setup();
    host.store.bus.pageState.emit({ mode: 'build' });
    host.controller.hostUpdate();
    expect(host.seen).to.deep.equal([]);
  });
});
