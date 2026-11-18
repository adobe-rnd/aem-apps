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
/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { createChat } from './chat.js';
import { requestFrameless } from './frame.js';
import { createDaApi } from './da-api.js';
import { createDaSource } from './da-source.js';
import { createSchemaRepository } from './schemas.js';

export { loadScSdk } from './sc-sdk.js';

export const loadChat = () => DA_SDK.then(createChat, () => createChat());

export const loadFrameless = () => DA_SDK.then(requestFrameless, () => false);

// Requests wait for the shell's DA SDK handshake and go through its token-aware fetch.
export const repository = createSchemaRepository(createDaSource(createDaApi(DA_SDK)));
