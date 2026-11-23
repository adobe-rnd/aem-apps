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
import { createChannel } from '../../../../../../tools/apps/schema-editor/core/session/channel.js';

describe('bus channel', () => {
  it('calls every subscriber on emit, until it unsubscribes', () => {
    const channel = createChannel();
    const a = [];
    const b = [];
    const unsubscribeA = channel.subscribe((value) => a.push(value));
    channel.subscribe((value) => b.push(value));
    channel.emit(1);
    unsubscribeA();
    channel.emit(2);
    expect(a).to.deep.equal([1]);
    expect(b).to.deep.equal([1, 2]);
  });

  it('gives a late subscriber the last value only when it replays', () => {
    const event = createChannel();
    const state = createChannel({ replay: true });
    [event, state].forEach((channel) => { channel.emit('old'); channel.emit('last'); });
    const seen = { event: [], state: [] };
    event.subscribe((value) => seen.event.push(value));
    state.subscribe((value) => seen.state.push(value));
    expect(seen).to.deep.equal({ event: [], state: ['last'] });
  });

  it('replays nothing before the first emit, but replays an emitted null', () => {
    const state = createChannel({ replay: true });
    const seen = [];
    state.subscribe((value) => seen.push(value));
    state.emit(null);
    state.subscribe((value) => seen.push(value));
    expect(seen).to.deep.equal([null, null]);
  });
});
