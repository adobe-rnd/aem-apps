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
export const SESSION_EXPIRED = 'Your DA session has expired. Reload this app to sign in again.';

const messageOf = (error) => {
  if (typeof error === 'string') return error;
  return error?.message ?? '';
};

const isSessionError = (error) => {
  if (error?.status === 401) return true;
  return /missing ims client id/i.test(messageOf(error));
};

export default function friendlyError(error) {
  if (isSessionError(error)) return SESSION_EXPIRED;
  return messageOf(error) || String(error);
}
