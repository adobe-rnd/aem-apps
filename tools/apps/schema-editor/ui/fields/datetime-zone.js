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
export function localToUtc(local) {
  if (!local) { return ''; }
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) { return ''; }
  // Round to the minute so pre-1900 Local Mean Time offsets can't leak seconds into `…:00Z`.
  return new Date(Math.round(d.getTime() / 60000) * 60000).toISOString();
}

// Build from local getters, never slice toISOString() (that's UTC).
export function utcToLocal(iso) {
  if (!iso) { return ''; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return ''; }
  const pad = (n) => String(n).padStart(2, '0');
  // 4-digit year so the native input can parse it (getFullYear returns 1, not 0001).
  const year = String(d.getFullYear()).padStart(4, '0');
  return `${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
