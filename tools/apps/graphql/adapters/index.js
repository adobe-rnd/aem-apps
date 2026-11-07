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
import { createGraphqlCore } from '../core/operations.js';
import { createDaApi } from './da-api.js';
import { loadEndpointPattern as loadPattern } from './da-config.js';
import { createDaStore } from './da-source.js';
import { loadValidator } from './sc-validator.js';

// Requests wait for the shell's DA SDK handshake and go through its token-aware fetch.
const api = createDaApi(DA_SDK);

export const core = createGraphqlCore({ store: createDaStore(api), loadValidator });

export const loadEndpointPattern = ({ org, site }) => loadPattern({ api, org, site });
