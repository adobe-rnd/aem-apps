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

export const SNAPSHOT_APP = 'https://da.live/apps/snapshots';

export function toSnapshotPath(path = '') {
  const clean = path.replace(/\.html$/, '');
  return clean.endsWith('/index') ? clean.slice(0, -'index'.length) : clean;
}

export function normalizeContext(context = {}) {
  const { org, path } = context;
  const site = context.site || context.repo;
  if (!org || !site || !path) return undefined;
  return { org, site, path: toSnapshotPath(path) };
}

export function sanitizeName(value = '') {
  return value.replaceAll(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
}

export function snapshotStatus(manifest = {}) {
  if (manifest.review === 'requested' && manifest.locked) return { label: 'Ready', tone: 'positive' };
  if (manifest.review === 'rejected') return { label: 'Rejected', tone: 'negative' };
  if (manifest.locked) return { label: 'Locked', tone: 'notice' };
  return { label: 'Open', tone: 'neutral' };
}

export function scheduledPublish(manifest = {}, now = Date.now()) {
  const value = manifest.metadata?.scheduledPublish;
  if (!value) return undefined;
  const date = new Date(value);
  return date.getTime() > now ? date : undefined;
}

export function snapshotAppHref({ org, site, name }) {
  const query = name ? `?snapshot=${encodeURIComponent(name)}` : '';
  return `${SNAPSHOT_APP}${query}#/${org}/${site}`;
}

/**
 * Splits the site's snapshots into those containing `path` (with the matching
 * resource and whether a .snapshots copy exists) and the rest.
 */
export async function loadPageSnapshots({ api, path }) {
  const listed = await api.list();
  if (listed.error) return { error: listed.error };

  const loaded = await Promise.all(listed.snapshots.map(async ({ name }) => {
    const manifest = await api.getManifest({ name });
    if (manifest.error) return { name, error: manifest.error };
    const resource = manifest.resources?.find((res) => toSnapshotPath(res.path) === path);
    if (!resource) return { name, manifest };
    const hasSource = await api.hasSnapshotSource({ name, path: resource.path });
    return {
      name, manifest, resource, hasSource,
    };
  }));

  return {
    containing: loaded.filter((snap) => snap.resource),
    others: loaded.filter((snap) => !snap.resource),
  };
}
